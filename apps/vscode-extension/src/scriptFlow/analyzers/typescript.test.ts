import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeTypeScriptDocument } from "./typescript.js";

const FIXTURES = path.resolve(__dirname, "../../../fixtures/script-flow");
const SAMPLE_TS = readFileSync(path.join(FIXTURES, "sample.ts"), "utf8");
const COMPLEX_TS = readFileSync(path.join(FIXTURES, "sample-complex.ts"), "utf8");

describe("TypeScript analyzer", () => {
  it("analyzes a function with branching, loop, and return (happy path)", () => {
    const result = analyzeTypeScriptDocument({
      documentPath: "sample.ts",
      source: SAMPLE_TS,
    });

    expect(result.metadata.language).toBe("typescript");
    expect(result.nodes.filter((n) => n.kind === "entry")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "function")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "branch")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "loop")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "return")).toHaveLength(2);

    expect(result.analysis.entryPoints).toEqual(["fn:accumulate"]);
    expect(result.analysis.decisions).toHaveLength(1);
    expect(result.analysis.decisions[0].label).toBe("if limit <= 0");
    expect(result.analysis.loops).toHaveLength(1);
    expect(result.analysis.loops[0].label).toBe("for index < limit");

    const fnNode = result.nodes.find((n) => n.kind === "function");
    expect(fnNode?.label).toMatch(/accumulate/);
    expect(fnNode?.range).toBeDefined();

    expect(result.edges.length).toBeGreaterThan(0);
    const flowEdges = result.edges.filter((e) => e.kind === "flow");
    expect(flowEdges.length).toBeGreaterThan(0);
  });

  it("analyzes nested try/catch with multiple functions", () => {
    const result = analyzeTypeScriptDocument({
      documentPath: "sample-complex.ts",
      source: COMPLEX_TS,
    });

    expect(result.nodes.filter((n) => n.kind === "entry")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "function")).toHaveLength(2);
    expect(result.nodes.filter((n) => n.kind === "tryCatch")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "branch")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "loop")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "return")).toHaveLength(4);

    expect(result.analysis.entryPoints).toContain("fn:accumulatecomplex");
    expect(result.analysis.entryPoints).toContain("fn:normalizevalue");
  });

  it("analyzes a class with methods", () => {
    const result = analyzeTypeScriptDocument({
      documentPath: "calc.ts",
      source: `
class Calculator {
  add(a: number, b: number) {
    return a + b;
  }
  multiply(a: number, b: number) {
    return a * b;
  }
}
`.trim(),
    });

    const functions = result.nodes.filter((n) => n.kind === "function");
    expect(functions.length).toBeGreaterThanOrEqual(2);
    expect(functions.some((f) => f.label.includes("add"))).toBe(true);
    expect(functions.some((f) => f.label.includes("multiply"))).toBe(true);
    expect(result.analysis.entryPoints).toHaveLength(0);
  });

  it("handles empty source without throwing", () => {
    const result = analyzeTypeScriptDocument({
      documentPath: "empty.ts",
      source: "",
    });

    expect(result.metadata.language).toBe("typescript");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe("entry");
    expect(result.edges).toHaveLength(0);
  });

  it("handles invalid source without throwing", () => {
    const result = analyzeTypeScriptDocument({
      documentPath: "garbage.ts",
      source: "@@@ ??? {{} }{ invalid .",
    });

    expect(result.metadata.language).toBe("typescript");
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.metadata.hash).toBe("string");
  });
});
