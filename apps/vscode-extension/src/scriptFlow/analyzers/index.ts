import { createHash } from "node:crypto";
import path from "node:path";

import type { ScriptFlowLanguage, ScriptFlowSnapshot } from "../types.js";
import { analyzePythonDocument } from "./python.js";
import { analyzeSqlDocument } from "./sql.js";
import { analyzeTypeScriptDocument } from "./typescript.js";

export type ScriptFlowAnalyzerInput = {
  documentPath: string;
  source: string;
};

const SCRIPT_FLOW_CACHE_MAX = 20;
const scriptFlowCache = new Map<string, ScriptFlowSnapshot>();

export function resolveScriptFlowLanguage(documentPath: string): ScriptFlowLanguage | undefined {
  switch (path.extname(documentPath).toLowerCase()) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return "typescript";
    case ".py":
      return "python";
    case ".sql":
      return "sql";
    default:
      return undefined;
  }
}

export async function analyzeScriptFlowDocument(input: ScriptFlowAnalyzerInput): Promise<ScriptFlowSnapshot | undefined> {
  const language = resolveScriptFlowLanguage(input.documentPath);
  if (!language) {
    return undefined;
  }

  const key = buildCacheKey(input);
  const cached = scriptFlowCache.get(key);
  if (cached) {
    scriptFlowCache.delete(key);
    scriptFlowCache.set(key, cached);
    return cached;
  }

  const snapshot = await runAnalyzer(language, input);
  if (!snapshot) {
    return undefined;
  }

  scriptFlowCache.set(key, snapshot);
  if (scriptFlowCache.size > SCRIPT_FLOW_CACHE_MAX) {
    const oldestKey = scriptFlowCache.keys().next().value;
    if (oldestKey !== undefined) {
      scriptFlowCache.delete(oldestKey);
    }
  }

  return snapshot;
}

export function clearScriptFlowCache(): void {
  scriptFlowCache.clear();
}

function buildCacheKey(input: ScriptFlowAnalyzerInput): string {
  const hash = createHash("sha1").update(input.source).digest("hex");
  return `${input.documentPath}|${hash}`;
}

async function runAnalyzer(language: ScriptFlowLanguage, input: ScriptFlowAnalyzerInput): Promise<ScriptFlowSnapshot | undefined> {
  switch (language) {
    case "typescript":
      return analyzeTypeScriptDocument(input);
    case "python":
      return analyzePythonDocument(input);
    case "sql":
      return analyzeSqlDocument(input);
    default:
      return undefined;
  }
}
