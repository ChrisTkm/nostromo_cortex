import { describe, expect, it } from "vitest";
import { countLogsByLevel, sortLogLevelKeys } from "./state";

describe("countLogsByLevel", () => {
  it("returns counts by uppercased level for a mixed list", () => {
    const logs = [
      { level: "ERROR" },
      { level: "error" },
      { level: "INFO" },
      { level: "WARNING" },
      { level: "ERROR" }
    ] as any;
    expect(countLogsByLevel(logs)).toEqual({ ERROR: 3, INFO: 1, WARNING: 1 });
  });

  it("returns empty object for an empty array", () => {
    expect(countLogsByLevel([])).toEqual({});
  });
});

describe("sortLogLevelKeys", () => {
  it("places ERROR before WARNING before INFO before DEBUG; unknown goes last", () => {
    const result = sortLogLevelKeys(["INFO", "CUSTOM", "DEBUG", "ERROR", "WARNING"]);
    expect(result).toEqual(["ERROR", "WARNING", "INFO", "DEBUG", "CUSTOM"]);
  });
});
