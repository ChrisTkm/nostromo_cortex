import { isScriptFlowSnapshot, type ScriptFlowSnapshot } from "./types.js";

export type ScriptFlowHostMessage =
  | { type: "scriptFlow:snapshot"; snapshot: ScriptFlowSnapshot }
  | { type: "scriptFlow:error"; error: string }
  | { type: "scriptFlow:unsupported"; language?: string };

export type ScriptFlowWebviewMessage =
  | { type: "ready" }
  | { type: "scriptFlow:selectNode"; nodeId: string }
  | { type: "scriptFlow:drawerClick"; section: string }
  | { type: "scriptFlow:refresh" };

type MessageTarget = {
  postMessage(message: unknown): unknown;
};

export function sendSnapshot(target: MessageTarget, snapshot: ScriptFlowSnapshot) {
  return target.postMessage({
    type: "scriptFlow:snapshot",
    snapshot
  } satisfies ScriptFlowHostMessage);
}

export function sendError(target: MessageTarget, error: string) {
  return target.postMessage({
    type: "scriptFlow:error",
    error
  } satisfies ScriptFlowHostMessage);
}

export function sendUnsupported(target: MessageTarget, language?: string) {
  return target.postMessage({
    type: "scriptFlow:unsupported",
    ...(language ? { language } : {})
  } satisfies ScriptFlowHostMessage);
}

export function sendReady(target: MessageTarget) {
  return target.postMessage({
    type: "ready"
  } satisfies ScriptFlowWebviewMessage);
}

export function sendSelectNode(target: MessageTarget, nodeId: string) {
  return target.postMessage({
    type: "scriptFlow:selectNode",
    nodeId
  } satisfies ScriptFlowWebviewMessage);
}

export function sendDrawerClick(target: MessageTarget, section: string) {
  return target.postMessage({
    type: "scriptFlow:drawerClick",
    section
  } satisfies ScriptFlowWebviewMessage);
}

export function sendRefresh(target: MessageTarget) {
  return target.postMessage({
    type: "scriptFlow:refresh"
  } satisfies ScriptFlowWebviewMessage);
}

export function isScriptFlowHostMessage(value: unknown): value is ScriptFlowHostMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScriptFlowHostMessage>;
  return (
    (candidate.type === "scriptFlow:snapshot" && isScriptFlowSnapshot(candidate.snapshot)) ||
    (candidate.type === "scriptFlow:error" && typeof candidate.error === "string") ||
    (candidate.type === "scriptFlow:unsupported" &&
      (candidate.language === undefined || typeof candidate.language === "string"))
  );
}

export function isScriptFlowWebviewMessage(value: unknown): value is ScriptFlowWebviewMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScriptFlowWebviewMessage>;
  return (
    candidate.type === "ready" ||
    (candidate.type === "scriptFlow:selectNode" && typeof candidate.nodeId === "string") ||
    (candidate.type === "scriptFlow:drawerClick" && typeof candidate.section === "string") ||
    candidate.type === "scriptFlow:refresh"
  );
}
