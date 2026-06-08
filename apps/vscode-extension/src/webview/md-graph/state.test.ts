import { describe, expect, it } from "vitest";
import {
  type MdxGraphSnapshot,
} from "../../mdGraph/types.js";
import {
  isPersistedState,
  reconcileHiddenNodeIds,
  reconcileSelectedNodeId,
} from "./state.js";

function snapshot(nodes: string[]): MdxGraphSnapshot {
  return {
    rootPath: "/fake",
    generatedAt: new Date().toISOString(),
    nodes: nodes.map((id) => ({ id, kind: "doc", label: id, route: id }) as any),
    edges: [],
    issues: [],
    stats: { fileCount: 0, tagCount: 0, accountCount: 0, orphanCount: 0, unresolvedCount: 0, elapsedMs: 0, workspaceMode: "flat" },
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

describe("isPersistedState", () => {
  it("returns true for state with snapshot, hiddenNodeIds, and selectedNodeId", () => {
    const state = {
      snapshot: snapshot(["doc:a"]),
      hiddenNodeIds: ["doc:b"],
      selectedNodeId: "doc:a",
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
