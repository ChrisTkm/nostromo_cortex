import * as vscode from "vscode";

import {
  analyzeScriptFlowDocument,
  resolveScriptFlowLanguage,
} from "../scriptFlow/analyzers/index.js";
import type { ScriptFlowSnapshot } from "../scriptFlow/types.js";
import type { ExtensionTaskService } from "../service.js";

export type ScriptFlowScope = "file" | "selection";
export type ScriptFlowRequest = {
  scope: ScriptFlowScope;
  documentUri?: vscode.Uri;
  selection?: vscode.Range;
};
export type ScriptFlowDelivery =
  | {
      type: "snapshot";
      snapshot: ScriptFlowSnapshot;
      parseMs: number;
      documentUri: vscode.Uri;
    }
  | { type: "error"; error: string }
  | { type: "unsupported"; language?: string };

export async function buildScriptFlowDelivery(
  request: ScriptFlowRequest,
): Promise<ScriptFlowDelivery> {
  const document = await resolveScriptFlowDocument(request);
  if (!document) {
    return { type: "unsupported" };
  }

  const documentPath = document.uri.fsPath;
  const language = resolveScriptFlowLanguage(documentPath);

  if (
    request.scope === "selection" &&
    (!request.selection || request.selection.isEmpty)
  ) {
    return {
      type: "error",
      error:
        "Select a code range before opening Script Flow for the current selection.",
    };
  }

  if (!language) {
    return {
      type: "unsupported",
      language: document.languageId,
    };
  }

  try {
    const source =
      request.scope === "selection" && request.selection
        ? document.getText(request.selection)
        : document.getText();
    const startedAt = Date.now();
    const snapshot = await analyzeScriptFlowDocument({
      documentPath,
      source,
    });
    if (!snapshot) {
      return {
        type: "unsupported",
        language,
      };
    }
    return {
      type: "snapshot",
      snapshot,
      parseMs: Date.now() - startedAt,
      documentUri: document.uri,
    };
  } catch (error) {
    return {
      type: "error",
      error: String(error),
    };
  }
}

async function resolveScriptFlowDocument(
  request: ScriptFlowRequest,
): Promise<vscode.TextDocument | undefined> {
  if (request.documentUri) {
    try {
      return await vscode.workspace.openTextDocument(request.documentUri);
    } catch {
      // fall through to active editor
    }
  }
  const editor = vscode.window.activeTextEditor;
  return editor?.document;
}
