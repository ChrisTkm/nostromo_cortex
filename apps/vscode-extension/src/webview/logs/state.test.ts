import { describe, expect, it } from "vitest";
import { PROCESS_FALLBACK_THRESHOLD, buildExecutionGroups, buildLogJson, buildLogsCsvExport, buildLogsJsonExport, countLogsByLevel, detectRuns, getOldestLogTimestamp, LOGS_PYTHON_SNIPPET, mergeLogPages, shouldShowFilter, sortLogLevelKeys } from "./state";
import type { LogRecord } from "../../logs";

function mockLog(overrides: Partial<LogRecord>): LogRecord {
  return {
    day: "2026-06-07",
    folder: "root",
    level: "INFO",
    message: "msg",
    source: "src",
    summary: "sum",
    timestamp: "2026-06-07T10:00:00.000Z",
    details: [],
    ...overrides
  } as LogRecord;
}

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

describe("buildExecutionGroups", () => {
  it("3 ungrouped logs in 3 different days → 3 subgroups sorted desc", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", day: "2026-06-07" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", day: "2026-06-06" }),
      mockLog({ timestamp: "2026-06-05T10:00:00.000Z", day: "2026-06-05" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups).toHaveLength(3);
    groups.forEach((g) => expect(g.isUngrouped).toBe(true));
    expect(groups[0]!.label).toBe("ungrouped · 2026-06-07");
    expect(groups[1]!.label).toBe("ungrouped · 2026-06-06");
    expect(groups[2]!.label).toBe("ungrouped · 2026-06-05");
  });

  it("5 ungrouped logs across 2 days (3+2) → 2 groups, newest first", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T08:00:00.000Z", day: "2026-06-07" }),
      mockLog({ timestamp: "2026-06-07T09:00:00.000Z", day: "2026-06-07" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", day: "2026-06-07" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", day: "2026-06-06" }),
      mockLog({ timestamp: "2026-06-06T11:00:00.000Z", day: "2026-06-06" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.label).toBe("ungrouped · 2026-06-07");
    expect(groups[0]!.logs).toHaveLength(3);
    expect(groups[1]!.label).toBe("ungrouped · 2026-06-06");
    expect(groups[1]!.logs).toHaveLength(2);
  });

  it("mixed: executions + ungrouped subgroups interleaved by timestamp desc", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-08T10:00:00.000Z", day: "2026-06-08", executionId: "exec-late" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", day: "2026-06-07" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", day: "2026-06-06", executionId: "exec-early" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups).toHaveLength(3);
    expect(groups[0]!.id).toBe("exec-late");
    expect(groups[1]!.id).toBe("ungrouped:2026-06-07");
    expect(groups[2]!.id).toBe("exec-early");
  });

  it("only executions, no ungrouped → no isUngrouped groups", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-08T10:00:00.000Z", day: "2026-06-08", executionId: "a" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", day: "2026-06-07", executionId: "b" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups.every((g) => !g.isUngrouped)).toBe(true);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.id).toBe("a");
    expect(groups[1]!.id).toBe("b");
  });

  it("only ungrouped, all same day → 1 group", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-07T11:00:00.000Z" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.isUngrouped).toBe(true);
    expect(groups[0]!.label).toBe("ungrouped · 2026-06-07");
    expect(groups[0]!.logs).toHaveLength(2);
  });

  it("empty input → empty array", () => {
    expect(buildExecutionGroups([])).toEqual([]);
  });

  it("subgroup contains correct beginTimestamp and endTimestamp", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T08:00:00.000Z", day: "2026-06-07", tag: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T09:00:00.000Z", day: "2026-06-07", tag: "END" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.beginTimestamp).toBe("2026-06-07T08:00:00.000Z");
    expect(groups[0]!.endTimestamp).toBe("2026-06-07T09:00:00.000Z");
  });

  describe("buildLogsJsonExport", () => {
    it("produces a valid JSON array string from an array of logs", () => {
      const logs = [
        mockLog({ timestamp: "2026-06-07T10:00:00.000Z", level: "ERROR" }),
        mockLog({ timestamp: "2026-06-07T11:00:00.000Z", level: "INFO" })
      ];
      const result = buildLogsJsonExport(logs);
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it("prettifies with 2-space indent", () => {
      const logs = [mockLog({})];
      const result = buildLogsJsonExport(logs);
      expect(result).toContain("  ");
      expect(result.startsWith("[")).toBe(true);
      expect(result.endsWith("]")).toBe(true);
    });

    it("returns '[]' for empty array", () => {
      expect(buildLogsJsonExport([])).toBe("[]");
    });

    it("includes details array in each entry", () => {
      const logs = [
        mockLog({ details: [{ key: "k", label: "K", value: "v" }] })
      ];
      const result = buildLogsJsonExport(logs);
      expect(result).toContain("\"details\"");
    });
  });

  describe("buildLogsCsvExport", () => {
    it("produces CSV with header and one row per log", () => {
      const logs = [
        mockLog({ timestamp: "2026-06-07T10:00:00.000Z", level: "ERROR" }),
        mockLog({ timestamp: "2026-06-07T11:00:00.000Z", level: "INFO" })
      ];
      const result = buildLogsCsvExport(logs);
      const lines = result.split("\n");
      expect(lines[0]).toBe("timestamp,level,source,folder,executionId,tag,event,className,methodName,process,loggerName,title,summary,message,day,details");
      expect(lines[1]).toContain("2026-06-07T10:00:00.000Z");
      expect(lines[1]).toContain("ERROR");
      expect(lines).toHaveLength(3);
    });

    it("only returns header for empty array", () => {
      const result = buildLogsCsvExport([]);
      expect(result).toBe("timestamp,level,source,folder,executionId,tag,event,className,methodName,process,loggerName,title,summary,message,day,details");
    });

    it("escapes commas and quotes in field values", () => {
      const logs = [
        mockLog({ summary: "hello, world" }),
        mockLog({ message: 'say "hi"' })
      ];
      const result = buildLogsCsvExport(logs);
      const lines = result.split("\n");
      expect(lines[1]).toContain('"hello, world"');
      expect(lines[2]).toContain('"say ""hi"""');
    });

    it("serializes details as JSON string in CSV", () => {
      const logs = [
        mockLog({ details: [{ key: "host", label: "Host", value: "localhost" }] })
      ];
      const result = buildLogsCsvExport(logs);
      const rows = result.split("\n");
      expect(rows[1]).toContain("localhost");
    });
  });

  it("preserves dominantTag and classMethod from representative log", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", day: "2026-06-07", level: "ERROR", className: "MyClass", methodName: "run" })
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.dominantTag).toBe("ERROR");
    expect(groups[0]!.classMethod).toBe("MyClass.run");
  });

  it("coverage >= threshold keeps current execution grouping (no process groups)", () => {
    const logs = Array.from({ length: 4 }, (_, i) =>
      mockLog({
        timestamp: `2026-06-0${7 - i}T10:00:00.000Z`,
        day: `2026-06-0${7 - i}`,
        executionId: i < 2 ? `exec-${i}` : undefined,
        process: `process-${i}`,
      }),
    );
    const groups = buildExecutionGroups(logs);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const group of groups) {
      expect(group.kind).not.toBe("process");
    }
  });

  it("coverage < threshold groups by process when no executionId", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "sii_loader" }),
      mockLog({ timestamp: "2026-06-07T11:00:00.000Z", process: "cargas_sii" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", process: "sii_loader" }),
      mockLog({ timestamp: "2026-06-06T11:00:00.000Z", process: "previred_runner" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups).toHaveLength(3);
    const processGroups = groups.filter((g) => g.kind === "process");
    expect(processGroups).toHaveLength(3);
    expect(processGroups.map((g) => g.label).sort()).toEqual(["cargas_sii", "previred_runner", "sii_loader"]);
    for (const group of processGroups) {
      expect(group.isUngrouped).toBe(false);
    }
  });

  it("coverage < threshold with mix: execution groups + process groups", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-08T10:00:00.000Z", executionId: "exec-a" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "loader" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", process: "loader" }),
      mockLog({ timestamp: "2026-06-05T10:00:00.000Z", process: "transformer" }),
      mockLog({ timestamp: "2026-06-04T10:00:00.000Z", process: "transformer" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.kind === "execution")?.id).toBe("exec-a");
    expect(groups.find((g) => g.kind === "process")?.label).toBeDefined();
  });

  it("coverage 0 with no process nor loggerName falls to ungrouped by day", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: undefined, loggerName: undefined }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", process: undefined, loggerName: undefined }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups.every((g) => g.kind === "ungrouped")).toBe(true);
  });

  it("process groups sort by beginTimestamp desc like other groups", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "early_p" }),
      mockLog({ timestamp: "2026-06-08T10:00:00.000Z", process: "late_p" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.label).toBe("late_p");
    expect(groups[1]!.label).toBe("early_p");
  });

  it("process groups have kind process and process field set", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "my_loader" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.kind).toBe("process");
    expect(groups[0]!.process).toBe("my_loader");
    expect(groups[0]!.id).toBe("process:my_loader");
  });

  it("process groups have correct beginTimestamp and endTimestamp", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T08:00:00.000Z", process: "my_loader" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "my_loader" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.beginTimestamp).toBe("2026-06-07T08:00:00.000Z");
    expect(groups[0]!.endTimestamp).toBe("2026-06-07T10:00:00.000Z");
  });

  it("PROCESS_FALLBACK_THRESHOLD is exported as 0.25", () => {
    expect(PROCESS_FALLBACK_THRESHOLD).toBe(0.25);
  });

  it("detectRuns: 1 BEGIN/END pair → 1 closed run with durationMs", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z", event: "END" }),
    ];
    const runs = detectRuns(logs);
    expect(runs).toHaveLength(1);
    expect(runs![0]!.isLoose).toBe(false);
    expect(runs![0]!.label).toBe("run #1");
    expect(runs![0]!.durationMs).toBe(300_000);
    expect(runs![0]!.endTimestamp).toBe("2026-06-07T10:05:00.000Z");
  });

  it("detectRuns: BEGIN without END → 1 open run (no endTimestamp, no durationMs)", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z" }),
    ];
    const runs = detectRuns(logs);
    expect(runs).toHaveLength(1);
    expect(runs![0]!.isLoose).toBe(false);
    expect(runs![0]!.endTimestamp).toBeUndefined();
    expect(runs![0]!.durationMs).toBeUndefined();
  });

  it("detectRuns: logs before first BEGIN → loose run + normal run", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T09:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z", event: "END" }),
    ];
    const runs = detectRuns(logs);
    expect(runs).toHaveLength(2);
    expect(runs![0]!.isLoose).toBe(true);
    expect(runs![0]!.label).toBe("(loose)");
    expect(runs![1]!.isLoose).toBe(false);
    expect(runs![1]!.label).toBe("run #2");
  });

  it("detectRuns: no BEGIN → undefined", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z" }),
    ];
    expect(detectRuns(logs)).toBeUndefined();
  });

  it("detectRuns: 3 BEGIN/END pairs → 3 runs", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z", event: "END" }),
      mockLog({ timestamp: "2026-06-07T11:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T11:05:00.000Z", event: "END" }),
      mockLog({ timestamp: "2026-06-07T12:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T12:05:00.000Z", event: "END" }),
    ];
    const runs = detectRuns(logs);
    expect(runs).toHaveLength(3);
    expect(runs!.every((r) => !r.isLoose)).toBe(true);
    expect(runs![0]!.beginTimestamp).toBe("2026-06-07T10:00:00.000Z");
    expect(runs![2]!.beginTimestamp).toBe("2026-06-07T12:00:00.000Z");
  });

  it("detectRuns: loose + BEGIN/END + BEGIN/END → 3 runs", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T09:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z", event: "END" }),
      mockLog({ timestamp: "2026-06-07T11:00:00.000Z", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T11:05:00.000Z", event: "END" }),
    ];
    const runs = detectRuns(logs);
    expect(runs).toHaveLength(3);
    expect(runs![0]!.isLoose).toBe(true);
    expect(runs![1]!.isLoose).toBe(false);
    expect(runs![2]!.isLoose).toBe(false);
  });

  it("process group with BEGIN/END populates runs", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "my_loader", event: "BEGIN" }),
      mockLog({ timestamp: "2026-06-07T10:05:00.000Z", process: "my_loader", event: "END" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.runs).toBeDefined();
    expect(groups[0]!.runs).toHaveLength(1);
    expect(groups[0]!.runs![0]!.label).toBe("run #1");
  });

  it("process group without BEGIN has no runs", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", process: "my_loader" }),
    ];
    const groups = buildExecutionGroups(logs);
    expect(groups[0]!.runs).toBeUndefined();
  });
});

describe("shouldShowFilter", () => {
  it('["all"] → false', () => {
    expect(shouldShowFilter(["all"])).toBe(false);
  });

  it('["all", "INFO"] → false (1 real)', () => {
    expect(shouldShowFilter(["all", "INFO"])).toBe(false);
  });

  it('["all", "INFO", "WARNING"] → true (2 reales)', () => {
    expect(shouldShowFilter(["all", "INFO", "WARNING"])).toBe(true);
  });

  it('["all", "", "WARNING"] → false (empty descarta)', () => {
    expect(shouldShowFilter(["all", "", "WARNING"])).toBe(false);
  });

  it("[] → false (defensivo)", () => {
    expect(shouldShowFilter([])).toBe(false);
  });
});

describe("getOldestLogTimestamp", () => {
  it("returns null for empty array", () => {
    expect(getOldestLogTimestamp([])).toBeNull();
  });

  it("returns the timestamp of a single log", () => {
    const log = mockLog({ timestamp: "2026-06-07T10:00:00.000Z" });
    expect(getOldestLogTimestamp([log])).toBe("2026-06-07T10:00:00.000Z");
  });

  it("returns oldest among mixed timestamps", () => {
    const logs = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-05T10:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z" }),
      mockLog({ timestamp: "2026-06-04T10:00:00.000Z" })
    ];
    expect(getOldestLogTimestamp(logs)).toBe("2026-06-04T10:00:00.000Z");
  });
});

describe("mergeLogPages", () => {
  it("merges disjoint pages sorted desc by timestamp", () => {
    const existing = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", id: "a" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", id: "b" })
    ];
    const incoming = [
      mockLog({ timestamp: "2026-06-05T10:00:00.000Z", id: "c" }),
      mockLog({ timestamp: "2026-06-04T10:00:00.000Z", id: "d" })
    ];
    const result = mergeLogPages(existing, incoming);
    expect(result).toHaveLength(4);
    expect(result[0]!.id).toBe("a");
    expect(result[3]!.id).toBe("d");
  });

  it("deduplicates by id when incoming has overlap", () => {
    const existing = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", id: "a" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", id: "b" })
    ];
    const incoming = [
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", id: "b" }),
      mockLog({ timestamp: "2026-06-05T10:00:00.000Z", id: "c" })
    ];
    const result = mergeLogPages(existing, incoming);
    expect(result).toHaveLength(3);
    expect(result.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("merges into empty existing array", () => {
    const incoming = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", id: "a" }),
      mockLog({ timestamp: "2026-06-06T10:00:00.000Z", id: "b" })
    ];
    const result = mergeLogPages([], incoming);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("a");
  });

  it("returns existing unchanged when incoming is empty", () => {
    const existing = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", id: "a" })
    ];
    const result = mergeLogPages(existing, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
  });

  it("deduplicates by fallback key when id is absent", () => {
    const existing = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", level: "INFO", source: "src", summary: "msg" })
    ];
    const incoming = [
      mockLog({ timestamp: "2026-06-07T10:00:00.000Z", level: "INFO", source: "src", summary: "msg" })
    ];
    const result = mergeLogPages(existing, incoming);
    expect(result).toHaveLength(1);
  });
});
