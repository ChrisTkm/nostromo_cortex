import type { ScriptFlowNode, ScriptFlowNodeKind } from "./types.js";

export const SCRIPT_FLOW_NODE_ID_VERSION = "sf1" as const;

export type ScriptFlowNodeIdRange = NonNullable<ScriptFlowNode["range"]>;

export interface ScriptFlowNodeIdInput {
  kind: ScriptFlowNodeKind;
  seed: string;
  range?: ScriptFlowNode["range"];
}

export interface ScriptFlowNodeIdStrategy {
  create(input: ScriptFlowNodeIdInput): string;
}

export function createScriptFlowNodeIdStrategy(): ScriptFlowNodeIdStrategy {
  const localCounters = new Map<string, number>();

  return {
    create(input) {
      const prefix = normalizeKindPrefix(input.kind);
      const seed = slugify(input.seed || input.kind);
      const location = input.range ? formatRangeStart(input.range) : "unknown";
      const base = `${SCRIPT_FLOW_NODE_ID_VERSION}:${prefix}:${seed}:${location}`;
      const nextCount = (localCounters.get(base) ?? 0) + 1;
      localCounters.set(base, nextCount);
      return nextCount === 1 ? base : `${base}:n${nextCount}`;
    }
  };
}

export function normalizeKindPrefix(kind: ScriptFlowNodeKind) {
  if (kind === "function") {
    return "fn";
  }
  if (kind === "tryCatch") {
    return "try";
  }
  return kind;
}

function formatRangeStart(range: ScriptFlowNodeIdRange) {
  return `l${range.startLine}c${range.startCol}`;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "node"
  );
}
