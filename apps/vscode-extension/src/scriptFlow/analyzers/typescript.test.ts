import { describe, expect, it } from "vitest";
import { analyzeScriptFlowDocument } from "./index.js";
import { analyzeTypeScriptDocument } from "./typescript.js";
import { loadFixture } from "./__fixtures__/helpers.js";

const run = (source: string) =>
  analyzeTypeScriptDocument({ documentPath: "fixture.ts", source });
const runPipeline = (source: string) =>
  analyzeScriptFlowDocument({ documentPath: "fixture.ts", source });

describe("analyzeTypeScriptDocument", () => {
  it("splits try/catch/finally into 3 separate nodes", () => {
    const snap = run(`
      function f() {
        try { a(); } catch (e) { b(); } finally { c(); }
      }
    `);
    const tryNodes = snap.nodes.filter((n) => n.kind === "tryCatch");
    expect(tryNodes).toHaveLength(3);
    const subKinds = tryNodes.map((n) => n.meta?.subKind);
    expect(subKinds).toEqual(expect.arrayContaining(["try", "catch", "finally"]));
  });

  it("emits 2 nodes when only try + catch (no finally)", () => {
    const snap = run("function f() { try { a(); } catch (e) { b(); } }");
    const tryNodes = snap.nodes.filter((n) => n.kind === "tryCatch");
    expect(tryNodes).toHaveLength(2);
  });

  it("emits 2 nodes when only try + finally", () => {
    const snap = run("function f() { try { a(); } finally { c(); } }");
    const tryNodes = snap.nodes.filter((n) => n.kind === "tryCatch");
    expect(tryNodes).toHaveLength(2);
  });

  it("connects try → catch with throws edge and catch → finally", () => {
    const snap = run("function f() { try { a(); } catch (e) { b(); } finally { c(); } }");
    const labels = snap.edges.map((e) => e.label).filter(Boolean);
    expect(labels).toContain("throws");
    expect(labels).toContain("after");
  });

  it("flags async function declarations", () => {
    const snap = run("async function fetchUser() { return await fetch('/x'); }");
    const fn = snap.nodes.find((n) => n.kind === "function");
    expect(fn?.meta?.async).toBe(true);
  });

  it("flags async arrow functions assigned to const", () => {
    const snap = run("const fetchUser = async () => { return 1; };");
    const fn = snap.nodes.find((n) => n.kind === "function");
    expect(fn?.meta?.async).toBe(true);
  });

  it("does NOT flag sync functions as async", () => {
    const snap = run("function plain() { return 1; }");
    const fn = snap.nodes.find((n) => n.kind === "function");
    expect(fn?.meta?.async).toBeUndefined();
  });

  it("anchors inline tags and flow gaps to nodes", async () => {
    const snap = await runPipeline(`
      function inspect(value: number) {
        // TODO revisar umbral
        if (value > 10) log(value);
        log(value);
      }
    `);
    expect(snap).toBeDefined();
    const fn = snap.nodes.find((n) => n.kind === "function");
    const branch = snap.nodes.find((n) => n.kind === "branch");
    expect(fn?.meta?.autoObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inline", message: expect.stringContaining("TODO") }),
        expect.objectContaining({ kind: "flow-gap", message: expect.stringContaining("no explicit return") }),
      ]),
    );
    expect(branch?.meta?.autoObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "flow-gap", message: expect.stringContaining("no explicit else") }),
      ]),
    );
  });

  it("flags async class methods", () => {
    const snap = run("class S { async load() { return 1; } }");
    const fn = snap.nodes.find((n) => n.kind === "function" && /load/.test(n.label));
    expect(fn?.meta?.async).toBe(true);
  });

  it("flags empty loop bodies as flow gaps", () => {
    const snap = run(loadFixture("typescript-empty-loop.ts"));
    const allObs = snap.analysis.observations.join(" ");
    expect(allObs).toMatch(/loop body is empty/i);
    const loopNodes = snap.nodes.filter((n) => n.kind === "loop");
    expect(loopNodes.length).toBeGreaterThan(0);
    expect(loopNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({
            autoObservations: expect.arrayContaining([
              expect.objectContaining({
                kind: "flow-gap",
                message: expect.stringMatching(/loop body is empty/i),
              }),
            ]),
          }),
        }),
      ]),
    );
  });

  describe("fixture-based", () => {
    it("produces switch → branch nodes from switch-case.ts", () => {
      const snap = run(loadFixture("switch-case.ts"));
      const branches = snap.nodes.filter((n) => n.kind === "branch");
      expect(branches.length).toBeGreaterThanOrEqual(1);
      expect(branches[0]?.meta?.branches).toBe(4);
    });

    it("analyzes for-of, while, and do-while from loops.ts", () => {
      const snap = run(loadFixture("loops.ts"));
      expect(snap.analysis.loops.length).toBeGreaterThanOrEqual(3);
    });

    it("emits observations for async I/O and heavy loops", () => {
      const snap = run(loadFixture("observations.ts"));
      expect(snap.analysis.observations.length).toBeGreaterThan(0);
    });

    it("parses class-methods.tsx as TypeScript (via resolveScriptKind)", () => {
      const snap = run(loadFixture("class-methods.tsx"));
      const nodes = snap.nodes;
      expect(nodes.some((n) => n.kind === "function")).toBe(true);
    });
  });
});
