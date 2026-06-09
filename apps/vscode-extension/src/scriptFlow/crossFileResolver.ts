import path from "node:path";
import * as vscode from "vscode";

import { analyzeScriptFlowDocument, resolveScriptFlowLanguage } from "./analyzers/index.js";
import type { ScriptFlowEdge, ScriptFlowNode, ScriptFlowSnapshot } from "./types.js";
import { mergeSnapshots } from "./crossFileMerge.js";

const CROSS_FILE_CACHE_MAX = 20;
const CALLS_PER_FILE_CAP = 50;
const crossFileCache = new Map<string, ScriptFlowSnapshot>();

export interface ExpandCrossFileOptions {
  maxDepth: number;
  signal?: AbortSignal;
}

export async function expandCrossFileImports(
  baseSnapshot: ScriptFlowSnapshot,
  baseUri: vscode.Uri,
  options: ExpandCrossFileOptions
): Promise<ScriptFlowSnapshot> {
  if (options.maxDepth <= 0) return baseSnapshot;

  const fileIndexMap = new Map<string, number>();
  fileIndexMap.set(baseUri.fsPath, 0);

  const visited = new Set<string>([baseUri.fsPath]);
  const accumNodes: ScriptFlowNode[] = [...baseSnapshot.nodes];
  const accumEdges: ScriptFlowEdge[] = [...baseSnapshot.edges];

  const callNodes = baseSnapshot.nodes
    .filter((n) => n.kind === "call" && n.range)
    .slice(0, CALLS_PER_FILE_CAP);

  for (const callNode of callNodes) {
    if (options.signal?.aborted) break;
    await expandOne(callNode, baseUri, callNode.id, 0, options, fileIndexMap, visited, accumNodes, accumEdges);
  }

  return {
    ...baseSnapshot,
    nodes: accumNodes,
    edges: accumEdges
  };
}

async function expandOne(
  callNode: ScriptFlowNode,
  callerUri: vscode.Uri,
  callerNodePrefixedId: string,
  currentDepth: number,
  options: ExpandCrossFileOptions,
  fileIndexMap: Map<string, number>,
  visited: Set<string>,
  accumNodes: ScriptFlowNode[],
  accumEdges: ScriptFlowEdge[]
): Promise<void> {
  if (currentDepth >= options.maxDepth) return;
  if (options.signal?.aborted) return;
  if (!callNode.range) return;

  const position = new vscode.Position(callNode.range.startLine - 1, callNode.range.startCol - 1);

  let locations: Array<vscode.Location | vscode.LocationLink> | undefined;
  try {
    locations = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDefinitionProvider",
      callerUri,
      position
    );
  } catch {
    return;
  }
  if (!locations || locations.length === 0) return;

  const target = normalizeLocation(locations[0]);
  if (!target) return;

  const targetPath = target.uri.fsPath;
  if (/[\\/]node_modules[\\/]/.test(targetPath)) return;
  if (targetPath === callerUri.fsPath) return;
  if (!resolveScriptFlowLanguage(targetPath)) return;

  if (visited.has(targetPath)) {
    return;
  }
  visited.add(targetPath);

  let targetSnap = crossFileCache.get(targetPath);
  if (!targetSnap) {
    let source: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(target.uri);
      source = Buffer.from(bytes).toString("utf8");
    } catch {
      return;
    }
    const analyzed = await analyzeScriptFlowDocument({ documentPath: targetPath, source });
    if (!analyzed) return;
    targetSnap = analyzed;
    crossFileCache.set(targetPath, targetSnap);
    if (crossFileCache.size > CROSS_FILE_CACHE_MAX) {
      const oldest = crossFileCache.keys().next().value;
      if (oldest !== undefined) crossFileCache.delete(oldest);
    }
  }

  let fileIdx = fileIndexMap.get(targetPath);
  if (fileIdx === undefined) {
    fileIdx = fileIndexMap.size;
    fileIndexMap.set(targetPath, fileIdx);
  }

  mergeSnapshots(
    { nodes: accumNodes, edges: accumEdges },
    targetSnap,
    fileIdx,
    path.basename(targetPath),
    callerNodePrefixedId
  );

  const prefix = `f${fileIdx}:`;
  const targetCallNodes = targetSnap.nodes
    .filter((n) => n.kind === "call" && n.range)
    .slice(0, CALLS_PER_FILE_CAP);
  for (const inner of targetCallNodes) {
    if (options.signal?.aborted) break;
    await expandOne(inner, target.uri, prefix + inner.id, currentDepth + 1, options, fileIndexMap, visited, accumNodes, accumEdges);
  }
}

function normalizeLocation(loc: vscode.Location | vscode.LocationLink): vscode.Location | undefined {
  if ("uri" in loc && loc.uri instanceof vscode.Uri) return loc as vscode.Location;
  if ("targetUri" in loc && loc.targetUri instanceof vscode.Uri) {
    return { uri: loc.targetUri, range: loc.targetRange } as vscode.Location;
  }
  return undefined;
}

export function clearCrossFileCache(): void {
  crossFileCache.clear();
}
