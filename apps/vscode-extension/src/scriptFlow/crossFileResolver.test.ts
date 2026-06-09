import { describe, expect, it } from "vitest";
import { mergeSnapshots } from "./crossFileMerge.js";
import type { ScriptFlowSnapshot } from "./types.js";

const makeSnapshot = (
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>> = [],
  entryPoints: string[] = []
): ScriptFlowSnapshot => ({
  metadata: { path: "target.ts", language: "typescript", hash: "h", parsedAt: "2026-06-08T00:00:00Z" },
  nodes: nodes as ScriptFlowSnapshot["nodes"],
  edges: edges as ScriptFlowSnapshot["edges"],
  analysis: { entryPoints, summary: "", decisions: [], loops: [], observations: [] }
});

describe("mergeSnapshots", () => {
  it("prefixes node ids with f<idx>:", () => {
    const target = makeSnapshot([{ id: "fn:foo", kind: "function", label: "foo" }], [], ["fn:foo"]);
    const accum = { nodes: <ScriptFlowSnapshot["nodes"]>[], edges: <ScriptFlowSnapshot["edges"]>[] };
    const result = mergeSnapshots(accum, target, 1, "target.ts", "call:bar");
    expect(result.addedNodes[0]?.id).toBe("f1:fn:foo");
  });

  it("marks added nodes with crossFile and sourceFile meta", () => {
    const target = makeSnapshot([{ id: "fn:foo", kind: "function", label: "foo" }], [], ["fn:foo"]);
    const accum = { nodes: [], edges: [] };
    const result = mergeSnapshots(accum, target, 2, "utils.ts", "call:bar");
    expect(result.addedNodes[0]?.meta?.crossFile).toBe(true);
    expect(result.addedNodes[0]?.meta?.sourceFile).toBe("utils.ts");
  });

  it("adds an imports edge from caller to first entry point", () => {
    const target = makeSnapshot([{ id: "fn:foo", kind: "function", label: "foo" }], [], ["fn:foo"]);
    const accum = { nodes: [], edges: [] };
    const result = mergeSnapshots(accum, target, 0, "a.ts", "call:caller");
    const edge = result.addedEdges.find((e) => e.from === "call:caller");
    expect(edge?.to).toBe("f0:fn:foo");
    expect(edge?.label).toBe("imports");
    expect(edge?.kind).toBe("call");
  });

  it("skips imports edge when target has no entry points", () => {
    const target = makeSnapshot([{ id: "x", kind: "function", label: "x" }], []);
    const accum = { nodes: [], edges: [] };
    const result = mergeSnapshots(accum, target, 0, "a.ts", "call:c");
    expect(result.addedEdges.some((e) => e.from === "call:c")).toBe(false);
  });

  it("prefixes existing edges to keep internal references intact", () => {
    const target = makeSnapshot(
      [
        { id: "fn:foo", kind: "function", label: "foo" },
        { id: "call:bar", kind: "call", label: "bar()" }
      ],
      [{ from: "fn:foo", to: "call:bar", kind: "flow" }],
      ["fn:foo"]
    );
    const accum = { nodes: [], edges: [] };
    const result = mergeSnapshots(accum, target, 3, "a.ts", "call:c");
    const internal = result.addedEdges.find((e) => e.label !== "imports");
    expect(internal?.from).toBe("f3:fn:foo");
    expect(internal?.to).toBe("f3:call:bar");
  });

  it("appends to baseAccum mutably", () => {
    const target = makeSnapshot([{ id: "fn:foo", kind: "function", label: "foo" }], [], ["fn:foo"]);
    const accum = { nodes: [{ id: "existing", kind: "function" as const, label: "e" }], edges: [] };
    mergeSnapshots(accum, target, 1, "a.ts", "c");
    expect(accum.nodes.length).toBe(2);
    expect(accum.nodes[0]?.id).toBe("existing");
  });
});
