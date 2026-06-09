import { describe, expect, it } from "vitest";
import { analyzeTypeScriptDocument } from "./typescript.js";

const run = (source: string) =>
  analyzeTypeScriptDocument({ documentPath: "fixture.ts", source });

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

  it("flags async class methods", () => {
    const snap = run("class S { async load() { return 1; } }");
    const fn = snap.nodes.find((n) => n.kind === "function" && /load/.test(n.label));
    expect(fn?.meta?.async).toBe(true);
  });
});
