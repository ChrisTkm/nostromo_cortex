import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExecutionGroups, buildLogKey, coerceLogFilterValue, countLogsByLevel, filterLogsByTime, getLogsEmptyState, LOGS_PYTHON_SNIPPET, reconcileSelectedLogKey, sortLogLevelKeys } from "./state";

const sampleLogs = [
  {
    timestamp: "2026-04-20T10:00:00.000Z",
    day: "2026-04-20",
    level: "INFO",
    source: "nostromo.bootstrap",
    folder: "nostromo",
    message: "Mongo ready",
    summary: "Mongo ready (nostromo.bootstrap)",
    details: []
  },
  {
    timestamp: "2026-04-20T09:00:00.000Z",
    day: "2026-04-20",
    level: "ERROR",
    source: "nostromo.loader",
    folder: "nostromo",
    message: "Load failed",
    summary: "Load failed (nostromo.loader)",
    details: []
  }
];

describe("LogsApp helpers", () => {
  it("resets orphaned select filters back to all when a new logs:list arrives", () => {
    expect(coerceLogFilterValue("legacy-source", sampleLogs.map((entry) => entry.source))).toBe("all");
    expect(coerceLogFilterValue("ERROR", sampleLogs.map((entry) => entry.level))).toBe("ERROR");
    expect(coerceLogFilterValue("all", sampleLogs.map((entry) => entry.folder))).toBe("all");
  });

  it("falls back to the first available log when the selected entry disappears", () => {
    const selectedKey = buildLogKey(sampleLogs[1]!);
    expect(reconcileSelectedLogKey(selectedKey, sampleLogs)).toBe(selectedKey);
    expect(reconcileSelectedLogKey("missing-key", sampleLogs)).toBe(buildLogKey(sampleLogs[0]!));
    expect(reconcileSelectedLogKey(selectedKey, [])).toBeNull();
  });

  it("distinguishes an empty collection from filters that hide existing logs", () => {
    expect(getLogsEmptyState(0, 0, false)).toBe("empty");
    expect(getLogsEmptyState(2, 0, true)).toBe("filtered");
    expect(getLogsEmptyState(2, 2, false)).toBe("ready");
  });

  it("groups logs by execution id and keeps legacy logs ungrouped at the end", () => {
    const groups = buildExecutionGroups([
      {
        ...sampleLogs[0]!,
        timestamp: "2026-04-20T10:00:00.000Z",
        executionId: "exec-1",
        tag: "BEGIN",
        className: "Loader",
        methodName: "run"
      },
      {
        ...sampleLogs[0]!,
        timestamp: "2026-04-20T10:00:03.000Z",
        executionId: "exec-1",
        tag: "END",
        className: "Loader",
        methodName: "run"
      },
      sampleLogs[1]!
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: "exec-1",
      classMethod: "Loader.run",
      durationMs: 3000,
      isUngrouped: false
    });
    expect(groups[0]?.logs.map((entry) => entry.tag)).toEqual(["END", "BEGIN"]);
    expect(groups[1]).toMatchObject({ isUngrouped: true });
  });

  describe("filterLogsByTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("with timeRange='1h' excludes entries older than 1 hour", () => {
      const recent = { ...sampleLogs[0]!, timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString() };
      const old = { ...sampleLogs[1]!, timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() };
      expect(filterLogsByTime([recent, old], "1h")).toEqual([recent]);
    });

    it("with timeRange='all' returns all logs unchanged", () => {
      expect(filterLogsByTime(sampleLogs, "all")).toEqual(sampleLogs);
    });

    it("with timeRange='24h' combined with level filter works", () => {
      const recent = { ...sampleLogs[0]!, level: "INFO", timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
      const recentError = { ...sampleLogs[1]!, level: "ERROR", timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
      const old = { ...sampleLogs[0]!, level: "ERROR", timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() };
      const timeFiltered = filterLogsByTime([recent, recentError, old], "24h");
      expect(timeFiltered).toEqual([recent, recentError]);
    });
  });

  describe("level counters", () => {
    it("countLogsByLevel yields {ERROR: 2, INFO: 1} for [ERROR, ERROR, INFO]", () => {
      const logs = [
        { level: "ERROR" },
        { level: "ERROR" },
        { level: "INFO" }
      ] as any;
      expect(countLogsByLevel(logs)).toEqual({ ERROR: 2, INFO: 1 });
    });

    it("countLogsByLevel reflects only logs passed after source filter", () => {
      const logs = [
        { level: "ERROR", source: "A" },
        { level: "ERROR", source: "B" },
        { level: "INFO", source: "A" }
      ] as any;
      const filteredBySource = logs.filter((entry: any) => entry.source === "B");
      expect(countLogsByLevel(filteredBySource)).toEqual({ ERROR: 1 });
    });

    it("sortLogLevelKeys orders ERROR, WARNING, INFO, DEBUG, custom at end", () => {
      expect(sortLogLevelKeys(["INFO", "CUSTOM", "DEBUG", "ERROR", "WARNING"])).toEqual([
        "ERROR", "WARNING", "INFO", "DEBUG", "CUSTOM"
      ]);
    });
  });

  describe("onboarding", () => {
    it('getLogsEmptyState returns "empty" for zero logs', () => {
      expect(getLogsEmptyState(0, 0, false)).toBe("empty");
    });

    it('getLogsEmptyState returns "filtered" when filters hide all results', () => {
      expect(getLogsEmptyState(5, 0, true)).toBe("filtered");
    });

    it("LOGS_PYTHON_SNIPPET is a non-empty string with pymongo", () => {
      expect(LOGS_PYTHON_SNIPPET.length).toBeGreaterThan(0);
      expect(LOGS_PYTHON_SNIPPET).toContain("from pymongo import MongoClient");
    });
  });
});
