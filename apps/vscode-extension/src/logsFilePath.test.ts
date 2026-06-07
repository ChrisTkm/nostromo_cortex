import { describe, expect, it } from "vitest";
import { resolveLogsFilePath } from "./logsFilePath.js";

describe("resolveLogsFilePath", () => {
  it("returns absolute path as-is", () => {
    const result = resolveLogsFilePath({
      configured: "C:\\data\\logs\\cortex.jsonl",
      workspaceRoot: "C:\\workspace",
    });
    expect(result).toBe("C:\\data\\logs\\cortex.jsonl");
  });

  it("resolves relative path against workspace root", () => {
    const result = resolveLogsFilePath({
      configured: "custom\\logs\\app.jsonl",
      workspaceRoot: "C:\\workspace",
    });
    expect(result).toBe("C:\\workspace\\custom\\logs\\app.jsonl");
  });

  it("uses default logs/cortex.jsonl when configured is empty", () => {
    const result = resolveLogsFilePath({
      configured: "",
      workspaceRoot: "C:\\workspace",
    });
    expect(result).toBe("C:\\workspace\\logs\\cortex.jsonl");
  });

  it("uses default when configured is whitespace", () => {
    const result = resolveLogsFilePath({
      configured: "   ",
      workspaceRoot: "C:\\workspace",
    });
    expect(result).toBe("C:\\workspace\\logs\\cortex.jsonl");
  });

  it("returns null when workspaceRoot is undefined and path is relative", () => {
    const result = resolveLogsFilePath({
      configured: "relative\\path.jsonl",
      workspaceRoot: undefined,
    });
    expect(result).toBeNull();
  });

  it("returns null when configured is empty and workspaceRoot is undefined", () => {
    const result = resolveLogsFilePath({
      configured: "",
      workspaceRoot: undefined,
    });
    expect(result).toBeNull();
  });
});
