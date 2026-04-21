import { describe, expect, it } from "vitest";

import { buildLogKey, coerceLogFilterValue, getLogsEmptyState, reconcileSelectedLogKey } from "./state";

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
});
