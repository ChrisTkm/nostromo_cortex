import { beforeEach, describe, expect, it } from "vitest";
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

import { analyzeScriptFlowDocument, clearScriptFlowCache } from "./index.js";

describe("script-flow cache", () => {
  beforeEach(() => {
    clearScriptFlowCache();
  });

  it("returns the same snapshot reference on identical input (cache hit)", async () => {
    const input = { documentPath: "foo.ts", source: "const x = 1;" };
    const first = await analyzeScriptFlowDocument(input);
    const second = await analyzeScriptFlowDocument(input);
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("invalidates when source changes (different hash)", async () => {
    const first = await analyzeScriptFlowDocument({ documentPath: "foo.ts", source: "const x = 1;" });
    const second = await analyzeScriptFlowDocument({ documentPath: "foo.ts", source: "const x = 2;" });
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("caches per documentPath even when source is identical", async () => {
    const source = "const x = 1;";
    const a = await analyzeScriptFlowDocument({ documentPath: "a.ts", source });
    const b = await analyzeScriptFlowDocument({ documentPath: "b.ts", source });
    expect(a).not.toBe(b);
    const aAgain = await analyzeScriptFlowDocument({ documentPath: "a.ts", source });
    expect(aAgain).toBe(a);
  });

  it("evicts the oldest entry when capacity exceeds 20", async () => {
    const snapshots: Array<unknown> = [];
    for (let i = 0; i < 20; i += 1) {
      snapshots.push(await analyzeScriptFlowDocument({ documentPath: `file${i}.ts`, source: `const x = ${i};` }));
    }
    await analyzeScriptFlowDocument({ documentPath: "file20.ts", source: "const x = 20;" });
    const reborn = await analyzeScriptFlowDocument({ documentPath: "file0.ts", source: "const x = 0;" });
    expect(reborn).not.toBe(snapshots[0]);
  });

  it("clearScriptFlowCache forces re-analyze on next call", async () => {
    const input = { documentPath: "foo.ts", source: "const x = 1;" };
    const first = await analyzeScriptFlowDocument(input);
    clearScriptFlowCache();
    const second = await analyzeScriptFlowDocument(input);
    expect(second).not.toBe(first);
  });
});
