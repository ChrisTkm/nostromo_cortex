import { describe, expect, it } from "vitest";
import { resolveScriptFlowLanguage } from "./index.js";

describe("resolveScriptFlowLanguage", () => {
  it.each([
    ["foo.ts", "typescript"],
    ["foo.tsx", "typescript"],
    ["foo.js", "typescript"],
    ["foo.jsx", "typescript"],
    ["foo.JS", "typescript"],
    ["foo.JSX", "typescript"],
    ["/abs/path/Component.tsx", "typescript"],
    ["foo.py", "python"],
    ["foo.sql", "sql"],
    ["foo.mjs", undefined],
    ["foo.cjs", undefined],
    ["foo", undefined],
    ["README.md", undefined],
  ])("resolves %s → %s", (file, expected) => {
    expect(resolveScriptFlowLanguage(file)).toBe(expected);
  });
});
