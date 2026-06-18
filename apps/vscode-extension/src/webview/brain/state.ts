import type { BrainNode, BrainSnapshot } from "../../brain/types.js";

export type PersistedBrainState = {
  snapshot: BrainSnapshot;
  hiddenNodeIds?: string[];
  selectedNodeId?: string | null;
  visibleKinds?: Array<BrainNode["kind"]>;
  visibleEdges?: string[];
  showMiniMap?: boolean;
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

export function reconcileVisibleKinds(
  current: ReadonlyArray<BrainNode["kind"]>,
  snapshot: BrainSnapshot,
  fallback: ReadonlyArray<BrainNode["kind"]> = ["doc"]
): Array<BrainNode["kind"]> {
  const availableKinds = new Set(snapshot.nodes.map((node) => node.kind));
  const reconciled = current.filter((kind) => availableKinds.has(kind));
  return reconciled.length > 0 ? reconciled : [...fallback];
}

export function reconcileVisibleEdges<T extends string>(
  current: ReadonlyArray<T>,
  available: ReadonlyArray<T>
): T[] {
  const allowed = new Set(available);
  return current.filter((edge) => allowed.has(edge));
}
