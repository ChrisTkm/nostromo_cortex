import path from "node:path";

import type { ScriptFlowLanguage, ScriptFlowSnapshot } from "../types.js";
import { analyzeTypeScriptDocument } from "./typescript.js";

export type ScriptFlowAnalyzerInput = {
  documentPath: string;
  source: string;
};

export function resolveScriptFlowLanguage(documentPath: string): ScriptFlowLanguage | undefined {
  switch (path.extname(documentPath).toLowerCase()) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".py":
      return "python";
    case ".sql":
      return "sql";
    default:
      return undefined;
  }
}

export function analyzeScriptFlowDocument(input: ScriptFlowAnalyzerInput): ScriptFlowSnapshot | undefined {
  const language = resolveScriptFlowLanguage(input.documentPath);
  if (language !== "typescript") {
    return undefined;
  }

  return analyzeTypeScriptDocument(input);
}
