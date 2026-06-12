import type { BrainSnapshot } from "../../brain/types.js";

export type PersistedBrainState = {
  snapshot: BrainSnapshot;
  hiddenNodeIds?: string[];
  selectedNodeId?: string | null;
};

export function isSnapshot(value: unknown): value is BrainSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.nodes) &&
    Array.isArray(v.edges) &&
    typeof v.rootPath === "string"
  );
}

export function isPersistedState(value: unknown): value is PersistedBrainState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isSnapshot(v.snapshot);
}

export function reconcileSelectedNodeId(
  current: string | null,
  snapshot: BrainSnapshot
): string | null {
  if (current && snapshot.nodes.some((node) => node.id === current)) {
    return current;
  }
  return null;
}

export function reconcileHiddenNodeIds(
  current: ReadonlyArray<string>,
  snapshot: BrainSnapshot
): string[] {
  const knownIds = new Set(snapshot.nodes.map((node) => node.id));
  return current.filter((id) => knownIds.has(id));
}
