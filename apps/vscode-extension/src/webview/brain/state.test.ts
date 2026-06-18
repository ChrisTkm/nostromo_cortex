import { describe, expect, it } from "vitest";
import {
  type BrainSnapshot,
} from "../../brain/types.js";
import {
  isPersistedState,
  reconcileHiddenNodeIds,
  reconcileSelectedNodeId,
  reconcileVisibleEdges,
  reconcileVisibleKinds,
} from "./state.js";

function snapshot(nodes: string[]): BrainSnapshot {
  return {
    rootPath: "/fake",
    generatedAt: new Date().toISOString(),
    nodes: nodes.map((id) => ({ id, kind: "doc", label: id, route: id }) as any),
    edges: [],
    issues: [],
    stats: { fileCount: 0, tagCount: 0, accountCount: 0, orphanCount: 0, unresolvedCount: 0, elapsedMs: 0 },
  };
}

describe("reconcileSelectedNodeId", () => {
  it("returns null when current is null", () => {
    const result = reconcileSelectedNodeId(null, snapshot(["doc:a"]));
    expect(result).toBeNull();
  });

  it("preserves node id when it exists in snapshot", () => {
    const result = reconcileSelectedNodeId("doc:a", snapshot(["doc:a", "doc:b"]));
    expect(result).toBe("doc:a");
  });

  it("returns null when node id is absent from snapshot", () => {
    const result = reconcileSelectedNodeId("doc:gone", snapshot(["doc:a", "doc:b"]));
    expect(result).toBeNull();
  });
});

describe("reconcileHiddenNodeIds", () => {
  it("drops stale ids not present in snapshot", () => {
    const result = reconcileHiddenNodeIds(["doc:a", "doc:b", "doc:gone"], snapshot(["doc:a", "doc:b"]));
    expect(result).toEqual(["doc:a", "doc:b"]);
  });
});

describe("reconcileVisibleKinds", () => {
  it("preserves available kinds and drops kinds absent from the snapshot", () => {
    const snap: BrainSnapshot = {
      ...snapshot(["doc:a"]),
      nodes: [
        { id: "doc:a", kind: "doc", label: "A", route: "a" },
        { id: "tag:x", kind: "tag", label: "x" },
      ],
    };
    const result = reconcileVisibleKinds(["doc", "tag", "external"], snap);
    expect(result).toEqual(["doc", "tag"]);
  });

  it("falls back to docs when no selected kind exists in the snapshot", () => {
    const result = reconcileVisibleKinds(["external"], snapshot(["doc:a"]));
    expect(result).toEqual(["doc"]);
  });
});

describe("reconcileVisibleEdges", () => {
  it("drops edge filters that are no longer available in the toolbar", () => {
    const result = reconcileVisibleEdges(
      ["link", "account", "tag"],
      ["link", "tag"],
    );
    expect(result).toEqual(["link", "tag"]);
  });
});

describe("isPersistedState", () => {
  it("returns true for state with snapshot, hiddenNodeIds, and selectedNodeId", () => {
    const state = {
      snapshot: snapshot(["doc:a"]),
      hiddenNodeIds: ["doc:b"],
      selectedNodeId: "doc:a",
      visibleKinds: ["doc"],
      visibleEdges: ["link"],
    };
    expect(isPersistedState(state)).toBe(true);
  });

  it("returns false for legacy state (bare snapshot without snapshot wrapper)", () => {
    const state = snapshot(["doc:a"]);
    expect(isPersistedState(state)).toBe(false);
  });

  it("returns false for null, string, or array", () => {
    expect(isPersistedState(null)).toBe(false);
    expect(isPersistedState("foo")).toBe(false);
    expect(isPersistedState([1, 2, 3])).toBe(false);
  });
});
