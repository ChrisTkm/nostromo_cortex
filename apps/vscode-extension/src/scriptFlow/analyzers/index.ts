import path from "node:path";

import type { ScriptFlowLanguage, ScriptFlowSnapshot } from "../types.js";
import { analyzePythonDocument } from "./python.js";
import { analyzeSqlDocument } from "./sql.js";
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

export async function analyzeScriptFlowDocument(input: ScriptFlowAnalyzerInput): Promise<ScriptFlowSnapshot | undefined> {
  const language = resolveScriptFlowLanguage(input.documentPath);

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
