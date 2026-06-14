import { vi, describe, it, expect, beforeEach } from "vitest";
import { analyzePythonDocument } from "./python.js";

type MockNode = ReturnType<typeof makeNode>;

const mockParse = vi.hoisted(() => vi.fn());

vi.mock("web-tree-sitter", () => {
  const MockParser = vi.fn(() => ({
    setLanguage: vi.fn(),
    parse: mockParse,
  }));
  MockParser.init = vi.fn().mockResolvedValue(undefined);
  return {
    Parser: MockParser,
    Language: { load: vi.fn().mockResolvedValue({}) },
  };
});

function makeNode(
  type: string,
  overrides?: {
    text?: string;
    children?: MockNode[];
    fields?: Record<string, MockNode | null>;
    startRow?: number;
    startCol?: number;
    endRow?: number;
    endCol?: number;
  },
) {
  const children: MockNode[] = overrides?.children ?? [];
  return {
    type,
    text: overrides?.text ?? type,
    namedChildren: children,
    childForFieldName: (name: string) => overrides?.fields?.[name] ?? null,
    startPosition: {
      row: overrides?.startRow ?? 0,
      column: overrides?.startCol ?? 0,
    },
    endPosition: {
      row: overrides?.endRow ?? children.length,
      column: overrides?.endCol ?? 0,
    },
  };
}

function makeTree(root: MockNode) {
  return { rootNode: root, delete: () => {} };
}

beforeEach(() => {
  mockParse.mockReset();
});

describe("Python analyzer", () => {
  it("analyzes a function with if/for/try/return (happy path)", async () => {
    const root = makeNode("module", {
      children: [
        makeNode("function_definition", {
          text: "def summarize_scores(scores):",
          startRow: 0,
          endRow: 8,
          fields: {
            name: makeNode("identifier", { text: "summarize_scores", startRow: 0, startCol: 4, endRow: 0, endCol: 20 }),
            parameters: makeNode("parameters", { text: "scores", startRow: 0, startCol: 21, endRow: 0, endCol: 28 }),
          },
          children: [
            makeNode("block", {
              children: [
                makeNode("expression_statement", { text: "total = 0", startRow: 1, startCol: 4, endRow: 1, endCol: 12 }),
                makeNode("if_statement", {
                  text: "if not scores:",
                  startRow: 2, endRow: 3,
                  children: [
                    makeNode("identifier", { text: "scores" }),
                    makeNode("block", {
                      children: [
                        makeNode("return_statement", { text: "return total", startRow: 3, endCol: 12 }),
                      ],
                    }),
                  ],
                }),
                makeNode("for_statement", {
                  text: "for score in scores:",
                  startRow: 4, endRow: 7,
                  children: [
                    makeNode("identifier", { text: "score" }),
                    makeNode("identifier", { text: "scores" }),
                    makeNode("block", {
                      children: [
                        makeNode("try_statement", {
                          text: "try:",
                          startRow: 5, endRow: 6,
                          children: [
                            makeNode("block", {
                              children: [
                                makeNode("expression_statement", {
                                  text: "normalize_score(score)",
                                  children: [
                                    makeNode("call", { text: "normalize_score(score)" }),
                                  ],
                                }),
                              ],
                            }),
                            makeNode("except_clause", {
                              text: "except ValueError:",
                              children: [
                                makeNode("identifier", { text: "ValueError" }),
                                makeNode("block", {
                                  children: [
                                    makeNode("expression_statement", {
                                      text: "log_invalid(score)",
                                      children: [
                                        makeNode("call", { text: "log_invalid(score)" }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                makeNode("return_statement", { text: "return total", startRow: 8, endCol: 12 }),
              ],
            }),
          ],
        }),
      ],
    });

    mockParse.mockReturnValue(makeTree(root));

    const result = await analyzePythonDocument({
      documentPath: "sample.py",
      source: "def summarize_scores(scores):",
    });

    expect(result.metadata.language).toBe("python");
    expect(result.nodes.filter((n) => n.kind === "entry")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "function")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "branch")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "loop")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "tryCatch")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "return")).toHaveLength(2);

    const fnNode = result.nodes.find((n) => n.kind === "function");
    expect(fnNode?.label).toMatch(/summarize_scores/);
    expect(result.analysis.entryPoints).toHaveLength(1);
    expect(result.analysis.decisions).toHaveLength(1);
    expect(result.analysis.loops).toHaveLength(1);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("analyzes a class with methods", async () => {
    const root = makeNode("module", {
      children: [
        makeNode("class_definition", {
          text: "class Calculator:",
          startRow: 0, endRow: 4,
          fields: {
            name: makeNode("identifier", { text: "Calculator" }),
          },
          children: [
            makeNode("block", {
              children: [
                makeNode("function_definition", {
                  text: "def add(a, b):",
                  startRow: 1, endRow: 2,
                  fields: {
                    name: makeNode("identifier", { text: "add" }),
                    parameters: makeNode("parameters", { text: "a, b" }),
                  },
                  children: [
                    makeNode("block", {
                      children: [
                        makeNode("return_statement", { text: "return a + b" }),
                      ],
                    }),
                  ],
                }),
                makeNode("function_definition", {
                  text: "def multiply(a, b):",
                  startRow: 3, endRow: 4,
                  fields: {
                    name: makeNode("identifier", { text: "multiply" }),
                    parameters: makeNode("parameters", { text: "a, b" }),
                  },
                  children: [
                    makeNode("block", {
                      children: [
                        makeNode("return_statement", { text: "return a * b" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    mockParse.mockReturnValue(makeTree(root));

    const result = await analyzePythonDocument({
      documentPath: "calc.py",
      source: "class Calculator:",
    });

    const functions = result.nodes.filter((n) => n.kind === "function");
    expect(functions.length).toBeGreaterThanOrEqual(2);
    expect(functions.some((f) => f.label.includes("add"))).toBe(true);
    expect(functions.some((f) => f.label.includes("multiply"))).toBe(true);
    expect(result.analysis.entryPoints).toHaveLength(0);
  });

  it("handles empty source without throwing", async () => {
    const root = makeNode("module", { children: [] });
    mockParse.mockReturnValue(makeTree(root));

    const result = await analyzePythonDocument({
      documentPath: "empty.py",
      source: "",
    });

    expect(result.metadata.language).toBe("python");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe("entry");
    expect(result.edges).toHaveLength(0);
  });

  it("handles source with only comments without throwing", async () => {
    const root = makeNode("module", {
      children: [
        makeNode("comment", { text: "# this is a comment" }),
      ],
    });
    mockParse.mockReturnValue(makeTree(root));

    const result = await analyzePythonDocument({
      documentPath: "comments.py",
      source: "# this is a comment",
    });

    expect(result.metadata.language).toBe("python");
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });
});
