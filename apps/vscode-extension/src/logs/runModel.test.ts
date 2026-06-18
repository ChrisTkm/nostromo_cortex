import { describe, expect, it } from "vitest";
import {
  groupIntoRuns,
  aggregateByProcess,
  aggregateByPeriod,
  type RunGroup,
} from "./runModel.js";
import { normalizeLogDocument, type LogRecord } from "./normalize.js";

function makeRaw(overrides: Record<string, unknown>): LogRecord {
  return normalizeLogDocument(overrides);
}

describe("groupIntoRuns", () => {
  it("returns empty for no records", () => {
    expect(groupIntoRuns([])).toEqual([]);
  });

  it("groups by execution_id", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "cargas_sii", event: "BEGIN", execution_id: "exec-1", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:05:00Z", level: "INFO", process: "cargas_sii", event: "STEP", execution_id: "exec-1", message: "working" }),
      makeRaw({ timestamp: "2026-06-07T10:10:00Z", level: "INFO", process: "cargas_sii", event: "END", execution_id: "exec-1", duration_ms: 600000, message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.executionId).toBe("exec-1");
    expect(runs[0]!.inferred).toBe(false);
    expect(runs[0]!.durationMs).toBe(600000);
    expect(runs[0]!.status).toBe("ok");
  });

  it("different execution_ids become separate runs", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "cargas_sii", event: "BEGIN", execution_id: "exec-1", message: "a" }),
      makeRaw({ timestamp: "2026-06-07T11:00:00Z", level: "INFO", process: "cargas_sii", event: "END", execution_id: "exec-2", duration_ms: 30000, message: "b" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs).toHaveLength(2);
  });

  it("groups without execution_id by process + time window", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "sii_loader", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:05:00Z", level: "INFO", process: "sii_loader", event: "STEP", message: "working" }),
    ];
    const runs = groupIntoRuns(records, 15);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.inferred).toBe(true);
    expect(runs[0]!.process).toBe("sii_loader");
  });

  it("splits runs when gap exceeds window", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "sii_loader", event: "BEGIN", message: "first" }),
      makeRaw({ timestamp: "2026-06-07T12:00:00Z", level: "INFO", process: "sii_loader", event: "END", message: "second" }),
    ];
    const runs = groupIntoRuns(records, 15);
    expect(runs).toHaveLength(2);
  });

  it("different processes become separate runs", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "cargas_sii", event: "BEGIN", message: "a" }),
      makeRaw({ timestamp: "2026-06-07T10:01:00Z", level: "INFO", process: "sii_loader", event: "BEGIN", message: "b" }),
    ];
    const runs = groupIntoRuns(records, 15);
    expect(runs).toHaveLength(2);
  });

  it("returns runs sorted by startedAt desc", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "proc_a", event: "BEGIN", message: "early" }),
      makeRaw({ timestamp: "2026-06-08T10:00:00Z", level: "INFO", process: "proc_b", event: "BEGIN", message: "late" }),
    ];
    const runs = groupIntoRuns(records, 15);
    expect(runs[0]!.process).toBe("proc_b");
    expect(runs[1]!.process).toBe("proc_a");
  });
});

describe("run metrics", () => {
  it("status=ok when END present and no errors", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:10:00Z", level: "INFO", process: "p", event: "END", message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.status).toBe("ok");
    expect(runs[0]!.errorCount).toBe(0);
    expect(runs[0]!.sinMedicion).toBe(false);
  });

  it("status=error when END present with ERROR level events", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:05:00Z", level: "ERROR", process: "p", event: "ERROR", message: "fail" }),
      makeRaw({ timestamp: "2026-06-07T10:10:00Z", level: "INFO", process: "p", event: "END", message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.status).toBe("error");
    expect(runs[0]!.errorCount).toBe(1);
  });

  it("status=abierta when no END", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "sii_loader", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:05:00Z", level: "INFO", process: "sii_loader", event: "STEP", message: "working" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.status).toBe("abierta");
    expect(runs[0]!.sinMedicion).toBe(true);
  });

  it("duration_ms from END event takes precedence", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:30:00Z", level: "INFO", process: "p", event: "END", duration_ms: 600000, message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.durationMs).toBe(600000);
  });

  it("duration_ms from any event when no END event has it", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", duration_ms: 600000, message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:10:00Z", level: "INFO", process: "p", event: "END", message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.durationMs).toBe(600000);
  });

  it("duration from endedAt - startedAt when no explicit duration_ms", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:15:00Z", level: "INFO", process: "p", event: "END", message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.durationMs).toBe(900000);
  });

  it("sinMedicion when no duration_ms and no END", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", message: "start" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.sinMedicion).toBe(true);
    expect(runs[0]!.durationMs).toBeUndefined();
  });
});

describe("facet aggregation", () => {
  it("sums rows across events in a run", () => {
    const records = [
      makeRaw({
        timestamp: "2026-06-07T10:00:00Z",
        level: "INFO",
        process: "cargas_sii",
        event: "BEGIN",
        message: "start",
        source: "sap",
        target: "mongo",
        rows_read: 100,
        rows_inserted: 50,
        entity: "impuesto_2cat",
        operation: "extract",
      }),
      makeRaw({
        timestamp: "2026-06-07T10:05:00Z",
        level: "INFO",
        process: "cargas_sii",
        event: "STEP",
        message: "more",
        rows_read: 20,
        rows_inserted: 10,
        entity: "impuesto_2cat",
        operation: "transform",
      }),
      makeRaw({
        timestamp: "2026-06-07T10:10:00Z",
        level: "INFO",
        process: "cargas_sii",
        event: "END",
        message: "done",
        duration_ms: 600000,
      }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.rowsRead).toBe(120);
    expect(runs[0]!.rowsInserted).toBe(60);
    expect(runs[0]!.sources).toEqual(["sap"]);
    expect(runs[0]!.targets).toEqual(["mongo"]);
    expect(runs[0]!.entities).toEqual(["impuesto_2cat"]);
    expect(runs[0]!.operations).toEqual(["extract", "transform"]);
  });

  it("no facets produces undefined aggregates", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "p", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:10:00Z", level: "INFO", process: "p", event: "END", message: "done" }),
    ];
    const runs = groupIntoRuns(records);
    expect(runs[0]!.rowsRead).toBeUndefined();
    expect(runs[0]!.rowsInserted).toBeUndefined();
    expect(runs[0]!.sources).toEqual([]);
  });
});

describe("real-world scenarios", () => {
  it("cargas_sii: complete runs with BEGIN/END+duration", () => {
    // Simulate 3 complete runs like cargas_sii pattern
    const records: LogRecord[] = [];
    for (let i = 0; i < 3; i++) {
      const base = new Date(`2026-06-0${7 + i}T10:00:00Z`).getTime();
      records.push(
        makeRaw({
          timestamp: new Date(base).toISOString(),
          level: "INFO",
          process: "cargas_sii",
          event: "BEGIN",
          message: `Run ${i + 1} start`,
          execution_id: `cargas-${i + 1}`,
          source: "sap",
          target: "mongo",
          rows_read: 100,
          rows_inserted: 50,
          entity: "impuesto_2cat",
          operation: "extract",
        }),
      );
      records.push(
        makeRaw({
          timestamp: new Date(base + 300000).toISOString(),
          level: "INFO",
          process: "cargas_sii",
          event: "STEP",
          message: `Run ${i + 1} working`,
          execution_id: `cargas-${i + 1}`,
        }),
      );
      records.push(
        makeRaw({
          timestamp: new Date(base + 600000).toISOString(),
          level: "INFO",
          process: "cargas_sii",
          event: "END",
          message: `Run ${i + 1} done`,
          duration_ms: 600000,
          execution_id: `cargas-${i + 1}`,
        }),
      );
    }

    const runs = groupIntoRuns(records);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.status).toBe("ok");
      expect(run.durationMs).toBe(600000);
      expect(run.inferred).toBe(false);
      expect(run.sinMedicion).toBe(false);
      expect(run.rowsRead).toBe(100);
      expect(run.rowsInserted).toBe(50);
      expect(run.entities).toEqual(["impuesto_2cat"]);
    }
  });

  it("sii_loader: BEGIN without END is open run", () => {
    const records = [
      makeRaw({ timestamp: "2026-06-07T10:00:00Z", level: "INFO", process: "sii_loader", event: "BEGIN", message: "start" }),
      makeRaw({ timestamp: "2026-06-07T10:05:00Z", level: "INFO", process: "sii_loader", event: "STEP", message: "processing" }),
    ];
    const runs = groupIntoRuns(records, 15);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("abierta");
    expect(runs[0]!.sinMedicion).toBe(true);
    expect(runs[0]!.durationMs).toBe(300000); // computed from timestamps
    expect(runs[0]!.inferred).toBe(true);
  });
});

describe("aggregateByProcess", () => {
  it("aggregates runs by process", () => {
    const runs: RunGroup[] = [
      {
        process: "cargas_sii", inferred: false, startedAt: "2026-06-07T10:00:00Z",
        events: [], errorEvents: [],
        durationMs: 600000, status: "ok", errorCount: 0, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
      {
        process: "cargas_sii", inferred: false, startedAt: "2026-06-08T10:00:00Z",
        events: [], errorEvents: [],
        durationMs: 300000, status: "error", errorCount: 1, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
      {
        process: "sii_loader", inferred: true, startedAt: "2026-06-07T11:00:00Z",
        events: [], errorEvents: [],
        status: "abierta", errorCount: 0, sinMedicion: true,
        sources: [], targets: [], entities: [], operations: [],
      },
    ];

    const agg = aggregateByProcess(runs);
    expect(agg).toHaveLength(2);

    const cargas = agg.find((a) => a.process === "cargas_sii")!;
    expect(cargas.runCount).toBe(2);
    expect(cargas.errorCount).toBe(1);
    expect(cargas.totalDurationMs).toBe(900000);
    expect(cargas.avgDurationMs).toBe(450000);
    expect(cargas.maxDurationMs).toBe(600000);
    expect(cargas.lastDurationMs).toBe(300000);
    expect(cargas.firstRunAt).toBe("2026-06-07T10:00:00Z");
    expect(cargas.lastRunAt).toBe("2026-06-08T10:00:00Z");

    const sii = agg.find((a) => a.process === "sii_loader")!;
    expect(sii.runCount).toBe(1);
    expect(sii.totalDurationMs).toBeUndefined();
  });

  it("sorts by runCount desc", () => {
    const runs: RunGroup[] = [
      {
        process: "a", inferred: false, startedAt: "2026-06-07T10:00:00Z",
        events: [], errorEvents: [],
        durationMs: 100, status: "ok", errorCount: 0, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
      {
        process: "b", inferred: false, startedAt: "2026-06-07T11:00:00Z",
        events: [], errorEvents: [],
        durationMs: 100, status: "ok", errorCount: 0, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
      {
        process: "b", inferred: false, startedAt: "2026-06-07T12:00:00Z",
        events: [], errorEvents: [],
        durationMs: 100, status: "ok", errorCount: 0, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
    ];
    const agg = aggregateByProcess(runs);
    expect(agg[0]!.process).toBe("b");
    expect(agg[1]!.process).toBe("a");
  });
});

describe("aggregateByPeriod", () => {
  it("groups runs by month", () => {
    const runs: RunGroup[] = [
      {
        process: "p", inferred: false, startedAt: "2026-06-01T10:00:00Z",
        events: [], errorEvents: [],
        durationMs: 100000, status: "ok", errorCount: 0, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
      {
        process: "p", inferred: false, startedAt: "2026-06-15T10:00:00Z",
        events: [], errorEvents: [],
        durationMs: 200000, status: "ok", errorCount: 0, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
      {
        process: "p", inferred: false, startedAt: "2026-07-01T10:00:00Z",
        events: [], errorEvents: [],
        durationMs: 300000, status: "error", errorCount: 1, sinMedicion: false,
        sources: [], targets: [], entities: [], operations: [],
      },
    ];

    const agg = aggregateByPeriod(runs, "month");
    expect(agg).toHaveLength(2);

    const june = agg.find((a) => a.period === "2026-06")!;
    expect(june.runCount).toBe(2);
    expect(june.totalDurationMs).toBe(300000);
    expect(june.errorCount).toBe(0);

    const july = agg.find((a) => a.period === "2026-07")!;
    expect(july.runCount).toBe(1);
    expect(july.errorCount).toBe(1);
  });
});
