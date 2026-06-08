import type { MdxGraphSnapshot } from "../../mdGraph/types.js";

export type PersistedMdxGraphState = {
  snapshot: MdxGraphSnapshot;
  hiddenNodeIds?: string[];
  selectedNodeId?: string | null;
};

export function isSnapshot(value: unknown): value is MdxGraphSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.nodes) &&
    Array.isArray(v.edges) &&
    typeof v.rootPath === "string"
  );
}

export function isPersistedState(value: unknown): value is PersistedMdxGraphState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isSnapshot(v.snapshot);
}

export function reconcileSelectedNodeId(
  current: string | null,
  snapshot: MdxGraphSnapshot
): string | null {
  if (current && snapshot.nodes.some((node) => node.id === current)) {
    return current;
  }
  return null;
}

export function reconcileHiddenNodeIds(
  current: ReadonlyArray<string>,
  snapshot: MdxGraphSnapshot
): string[] {
  const knownIds = new Set(snapshot.nodes.map((node) => node.id));
  return current.filter((id) => knownIds.has(id));
}
