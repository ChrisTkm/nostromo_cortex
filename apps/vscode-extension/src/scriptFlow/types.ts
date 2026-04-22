export const SCRIPT_FLOW_LANGUAGES = ["typescript", "python", "sql"] as const;
export type ScriptFlowLanguage = (typeof SCRIPT_FLOW_LANGUAGES)[number];

export const SCRIPT_FLOW_NODE_KINDS = [
  "entry",
  "function",
  "branch",
  "loop",
  "tryCatch",
  "return",
  "call",
  "cte",
  "select",
  "join",
  "subquery"
] as const;
export type ScriptFlowNodeKind = (typeof SCRIPT_FLOW_NODE_KINDS)[number];

export const SCRIPT_FLOW_EDGE_KINDS = ["flow", "call", "dataflow"] as const;
export type ScriptFlowEdgeKind = (typeof SCRIPT_FLOW_EDGE_KINDS)[number];

export interface ScriptFlowMetadata {
  path: string;
  language: ScriptFlowLanguage;
  hash: string;
  parsedAt: string;
}

export interface ScriptFlowNode {
  id: string;
  kind: ScriptFlowNodeKind;
  label: string;
  range?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  meta?: Record<string, unknown>;
}

export interface ScriptFlowEdge {
  from: string;
  to: string;
  kind: ScriptFlowEdgeKind;
  label?: string;
}

export interface ScriptFlowAnalysis {
  entryPoints: string[];
  summary: string;
  decisions: Array<{ nodeId: string; label: string; branches: number }>;
  loops: Array<{ nodeId: string; label: string; kind: string }>;
  observations: string[];
}

export interface ScriptFlowSnapshot {
  metadata: ScriptFlowMetadata;
  nodes: ScriptFlowNode[];
  edges: ScriptFlowEdge[];
  analysis: ScriptFlowAnalysis;
}

export function isScriptFlowLanguage(value: unknown): value is ScriptFlowLanguage {
  return typeof value === "string" && SCRIPT_FLOW_LANGUAGES.includes(value as ScriptFlowLanguage);
}

export function isScriptFlowNodeKind(value: unknown): value is ScriptFlowNodeKind {
  return typeof value === "string" && SCRIPT_FLOW_NODE_KINDS.includes(value as ScriptFlowNodeKind);
}

export function isScriptFlowEdgeKind(value: unknown): value is ScriptFlowEdgeKind {
  return typeof value === "string" && SCRIPT_FLOW_EDGE_KINDS.includes(value as ScriptFlowEdgeKind);
}

export function isScriptFlowSnapshot(value: unknown): value is ScriptFlowSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScriptFlowSnapshot>;
  return (
    Boolean(candidate.metadata) &&
    typeof candidate.metadata?.path === "string" &&
    isScriptFlowLanguage(candidate.metadata?.language) &&
    typeof candidate.metadata?.hash === "string" &&
    typeof candidate.metadata?.parsedAt === "string" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every((node) => typeof node?.id === "string" && isScriptFlowNodeKind(node?.kind) && typeof node?.label === "string") &&
    Array.isArray(candidate.edges) &&
    candidate.edges.every(
      (edge) =>
        typeof edge?.from === "string" &&
        typeof edge?.to === "string" &&
        isScriptFlowEdgeKind(edge?.kind) &&
        (edge.label === undefined || typeof edge.label === "string")
    ) &&
    Array.isArray(candidate.analysis?.entryPoints) &&
    typeof candidate.analysis?.summary === "string" &&
    Array.isArray(candidate.analysis?.decisions) &&
    Array.isArray(candidate.analysis?.loops) &&
    Array.isArray(candidate.analysis?.observations)
  );
}
