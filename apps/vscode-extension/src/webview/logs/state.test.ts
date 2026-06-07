import { describe, expect, it } from "vitest";
import { buildLogJson, countLogsByLevel, LOGS_PYTHON_SNIPPET, sortLogLevelKeys } from "./state";

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

describe("buildLogJson", () => {
  it("produces valid indented JSON with all keys", () => {
    const log = {
      id: "abc123",
      timestamp: "2026-06-07T12:00:00.000Z",
      day: "2026-06-07",
      level: "INFO",
      source: "nostromo.test",
      folder: "nostromo",
      message: "hello",
      summary: "hello (nostromo.test)",
      details: [
        { key: "count", label: "Count", value: "42" }
      ]
    };
    const json = buildLogJson(log as any);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(log);
    expect(json).toContain("\n  ");
  });
});

describe("LOGS_PYTHON_SNIPPET", () => {
  it("is a non-empty string", () => {
    expect(LOGS_PYTHON_SNIPPET).toBeTruthy();
    expect(LOGS_PYTHON_SNIPPET.length).toBeGreaterThan(0);
  });

  it("uses pymongo not a ficticious cortex_logs package", () => {
    expect(LOGS_PYTHON_SNIPPET).toContain("from pymongo import MongoClient");
  });

  it("includes execution_id, tag, and level in insert_one", () => {
    expect(LOGS_PYTHON_SNIPPET).toContain('"execution_id"');
    expect(LOGS_PYTHON_SNIPPET).toContain('"tag"');
    expect(LOGS_PYTHON_SNIPPET).toContain('"level"');
  });
});
