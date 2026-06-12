import type { ScriptFlowEdge, ScriptFlowNode, ScriptFlowSnapshot } from "./types.js";

export function mergeSnapshots(
  baseAccum: { nodes: ScriptFlowNode[]; edges: ScriptFlowEdge[] },
  target: ScriptFlowSnapshot,
  fileIdx: number,
  sourceFile: string,
  callerNodeId: string
): { addedNodes: ScriptFlowNode[]; addedEdges: ScriptFlowEdge[] } {
  const prefix = `f${fileIdx}:`;
  const addedNodes: ScriptFlowNode[] = target.nodes.map((n) => ({
    ...n,
    id: prefix + n.id,
    meta: { ...(n.meta ?? {}), crossFile: true, sourceFile }
  }));
  const addedEdges: ScriptFlowEdge[] = target.edges.map((e) => ({
    ...e,
    from: prefix + e.from,
    to: prefix + e.to
  }));
  const targetEntry = target.analysis?.entryPoints[0];
  if (targetEntry) {
    addedEdges.push({
      from: callerNodeId,
      to: prefix + targetEntry,
      kind: "call",
      label: "imports"
    });
  }
  baseAccum.nodes.push(...addedNodes);
  baseAccum.edges.push(...addedEdges);
  return { addedNodes, addedEdges };
}
