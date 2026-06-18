import type { LogRecord } from "./normalize.js";

export type RunStatus = "ok" | "error" | "abierta";

export type RunGroup = {
  executionId?: string;
  process: string;
  inferred: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: RunStatus;
  errorCount: number;
  errorEvents: LogRecord[];
  events: LogRecord[];
  rowsRead?: number;
  rowsInserted?: number;
  rowsUpdated?: number;
  rowsDeleted?: number;
  sources: string[];
  targets: string[];
  entities: string[];
  operations: string[];
  sinMedicion: boolean;
};

export type ProcessAggregation = {
  process: string;
  runCount: number;
  lastRunAt?: string;
  totalDurationMs?: number;
  avgDurationMs?: number;
  maxDurationMs?: number;
  lastDurationMs?: number;
  errorCount: number;
  firstRunAt?: string;
  activityBuckets: number[];
};

export type PeriodUnit = "month" | "semester" | "year";

export type PeriodAggregation = {
  period: string;
  unit: PeriodUnit;
  runCount: number;
  totalDurationMs?: number;
  avgDurationMs?: number;
  maxDurationMs?: number;
  lastDurationMs?: number;
  errorCount: number;
  activityBuckets: number[];
  processBreakdown: ProcessAggregation[];
};

function addFacetNumber(
  acc: number | undefined,
  val: number | undefined,
): number | undefined {
  if (val === undefined) return acc;
  return (acc ?? 0) + val;
}

function collectSet(
  acc: string[],
  val: string | undefined,
): string[] {
  if (!val || acc.includes(val)) return acc;
  return [...acc, val];
}

function buildRunStatus(hasEnd: boolean, errorCount: number): RunStatus {
  if (!hasEnd) return "abierta";
  return errorCount > 0 ? "error" : "ok";
}

function parseISODate(iso: string): Date {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

export function groupIntoRuns(
  records: LogRecord[],
  gapMinutes = 15,
): RunGroup[] {
  if (records.length === 0) return [];

  const sorted = [...records].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp),
  );

  const byExecutionId = new Map<string, LogRecord[]>();
  const noExecutionId: LogRecord[] = [];

  for (const r of sorted) {
    if (r.executionId) {
      const list = byExecutionId.get(r.executionId);
      if (list) {
        list.push(r);
      } else {
        byExecutionId.set(r.executionId, [r]);
      }
    } else {
      noExecutionId.push(r);
    }
  }

  const runs: RunGroup[] = [];

  for (const [, group] of byExecutionId) {
    runs.push(computeRun(group, false));
  }

  // Group remaining by process + time window
  if (noExecutionId.length > 0) {
    const sortedByProc = [...noExecutionId].sort((a, b) => {
      const pc = (a.process ?? "").localeCompare(b.process ?? "");
      if (pc !== 0) return pc;
      return a.timestamp.localeCompare(b.timestamp);
    });

    let current: LogRecord[] = [];
    let currentProcess = sortedByProc[0]!.process ?? "";

    for (const r of sortedByProc) {
      const proc = r.process ?? "";
      if (proc !== currentProcess) {
        if (current.length > 0) {
          runs.push(computeRun(current, true));
        }
        current = [r];
        currentProcess = proc;
      } else if (current.length > 0) {
        const last = current[current.length - 1]!;
        const gap =
          parseISODate(r.timestamp).getTime() -
          parseISODate(last.timestamp).getTime();
        if (gap > gapMinutes * 60 * 1000) {
          runs.push(computeRun(current, true));
          current = [r];
        } else {
          current.push(r);
        }
      } else {
        current.push(r);
      }
    }

    if (current.length > 0) {
      runs.push(computeRun(current, true));
    }
  }

  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return runs;
}

function findExplicitDurationMs(events: LogRecord[]): number | undefined {
  const endEvent = events.find((e) => e.event === "END");
  if (endEvent?.durationMs !== undefined && endEvent.durationMs >= 0) {
    return endEvent.durationMs;
  }
  for (const e of events) {
    if (e.durationMs !== undefined && e.durationMs >= 0) {
      return e.durationMs;
    }
  }
  return undefined;
}

function computeTimestampDuration(events: LogRecord[]): number | undefined {
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) return undefined;
  if (last.timestamp !== first.timestamp) {
    const diff =
      parseISODate(last.timestamp).getTime() -
      parseISODate(first.timestamp).getTime();
    if (diff >= 0) return diff;
  }
  return undefined;
}

function computeRun(events: LogRecord[], inferred: boolean): RunGroup {
  const first = events[0]!;
  const last = events[events.length - 1]!;
  const startedAt = first.timestamp;
  const endedAt = last.timestamp;

  const hasEnd = events.some((e) => e.event === "END");
  const errorCount = events.filter(
    (e) => e.level === "ERROR" || e.event === "ERROR",
  ).length;
  const errorEvents = events.filter(
    (e) => e.level === "ERROR" || e.event === "ERROR",
  );
  const status = buildRunStatus(hasEnd, errorCount);

  const explicitDurationMs = findExplicitDurationMs(events);
  const durationMs = explicitDurationMs ?? computeTimestampDuration(events);
  const sinMedicion = explicitDurationMs === undefined && !hasEnd;

  let rowsRead: number | undefined;
  let rowsInserted: number | undefined;
  let rowsUpdated: number | undefined;
  let rowsDeleted: number | undefined;
  let sources: string[] = [];
  let targets: string[] = [];
  let entities: string[] = [];
  let operations: string[] = [];

  for (const e of events) {
    if (e.facets) {
      rowsRead = addFacetNumber(rowsRead, e.facets.rowsRead);
      rowsInserted = addFacetNumber(rowsInserted, e.facets.rowsInserted);
      rowsUpdated = addFacetNumber(rowsUpdated, e.facets.rowsUpdated);
      rowsDeleted = addFacetNumber(rowsDeleted, e.facets.rowsDeleted);
      sources = collectSet(sources, e.facets.source);
      targets = collectSet(targets, e.facets.target);
      entities = collectSet(entities, e.facets.entity);
      operations = collectSet(operations, e.facets.operation);
    }
  }

  return {
    ...(first.executionId ? { executionId: first.executionId } : {}),
    process: first.process ?? "",
    inferred,
    startedAt,
    ...(hasEnd || endedAt !== startedAt ? { endedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(rowsRead !== undefined ? { rowsRead } : {}),
    ...(rowsInserted !== undefined ? { rowsInserted } : {}),
    ...(rowsUpdated !== undefined ? { rowsUpdated } : {}),
    ...(rowsDeleted !== undefined ? { rowsDeleted } : {}),
    status,
    errorCount,
    errorEvents,
    events,
    sources,
    targets,
    entities,
    operations,
    sinMedicion,
  };
}

export function aggregateByProcess(
  runs: RunGroup[],
): ProcessAggregation[] {
  const map = new Map<string, RunGroup[]>();

  for (const run of runs) {
    const list = map.get(run.process);
    if (list) {
      list.push(run);
    } else {
      map.set(run.process, [run]);
    }
  }

  const result: ProcessAggregation[] = [];

  for (const [process, processRuns] of map) {
    const sorted = [...processRuns].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    const firstRunAt = sorted[0]!.startedAt;
    const lastRunAt = sorted[sorted.length - 1]!.startedAt;
    const runCount = sorted.length;
    const errorCount = sorted.filter((r) => r.status === "error").length;

    const durations = sorted
      .map((r) => r.durationMs)
      .filter((d): d is number => d !== undefined);

    const totalDurationMs =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0)
        : undefined;
    const avgDurationMs =
      durations.length > 0 ? Math.round(totalDurationMs! / durations.length) : undefined;
    const maxDurationMs =
      durations.length > 0 ? Math.max(...durations) : undefined;
    const lastDurationMs =
      durations.length > 0 ? durations[durations.length - 1] : undefined;

    result.push({
      process,
      runCount,
      errorCount,
      activityBuckets: computeActivityBuckets(sorted, 12),
      firstRunAt,
      lastRunAt,
      ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
      ...(avgDurationMs !== undefined ? { avgDurationMs } : {}),
      ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
      ...(lastDurationMs !== undefined ? { lastDurationMs } : {}),
    });
  }

  result.sort((a, b) => b.runCount - a.runCount);
  return result;
}

export function aggregateByPeriod(
  runs: RunGroup[],
  unit: PeriodUnit = "month",
): PeriodAggregation[] {
  const byPeriod = new Map<string, RunGroup[]>();

  for (const run of runs) {
    const key = periodKey(run.startedAt, unit);
    const list = byPeriod.get(key);
    if (list) {
      list.push(run);
    } else {
      byPeriod.set(key, [run]);
    }
  }

  const result: PeriodAggregation[] = [];

  for (const [period, periodRuns] of byPeriod) {
    const runCount = periodRuns.length;
    const errorCount = periodRuns.filter((r) => r.status === "error").length;

    const durations = periodRuns
      .map((r) => r.durationMs)
      .filter((d): d is number => d !== undefined);

    const totalDurationMs =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0)
        : undefined;
    const avgDurationMs =
      durations.length > 0
        ? Math.round(totalDurationMs! / durations.length)
        : undefined;
    const maxDurationMs =
      durations.length > 0 ? Math.max(...durations) : undefined;
    const lastDurationMs =
      durations.length > 0 ? durations[durations.length - 1] : undefined;

    const processBreakdown = aggregateByProcess(periodRuns);

    // For period aggregations, the sparkline uses sub-periods
    let buckets: number[];
    if (unit === "month") {
      buckets = dailyBuckets(periodRuns);
    } else if (unit === "semester") {
      buckets = monthlyBucketsForRange(periodRuns, 6);
    } else {
      buckets = monthlyBucketsForRange(periodRuns, 12);
    }

    result.push({
      period,
      unit,
      runCount,
      errorCount,
      activityBuckets: buckets,
      processBreakdown,
      ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
      ...(avgDurationMs !== undefined ? { avgDurationMs } : {}),
      ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
      ...(lastDurationMs !== undefined ? { lastDurationMs } : {}),
    });
  }

  result.sort((a, b) => b.period.localeCompare(a.period));
  return result;
}

function periodKey(iso: string, unit: PeriodUnit): string {
  const d = parseISODate(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (unit === "month") return `${y}-${m}`;
  if (unit === "semester") {
    const half = d.getUTCMonth() < 6 ? "H1" : "H2";
    return `${y}-${half}`;
  }
  return `${y}`;
}

function computeActivityBuckets(
  runs: RunGroup[],
  bucketCount: number,
): number[] {
  if (runs.length === 0) return [];
  const first = runs[0]!;
  const last = runs[runs.length - 1]!;
  const start = parseISODate(first.startedAt);
  const end = parseISODate(last.startedAt);
  const range = end.getTime() - start.getTime();
  if (range <= 0) return [runs.length];

  const buckets = new Array(bucketCount).fill(0);
  for (const run of runs) {
    const t = parseISODate(run.startedAt).getTime();
    const idx = Math.min(
      Math.floor(((t - start.getTime()) / range) * bucketCount),
      bucketCount - 1,
    );
    buckets[idx]++;
  }
  return buckets;
}

function dailyBuckets(runs: RunGroup[]): number[] {
  // For a month, bucket by day (up to 31)
  return computeActivityBuckets(runs, 31);
}

function monthlyBucketsForRange(
  runs: RunGroup[],
  maxMonths: number,
): number[] {
  if (runs.length === 0) return [];
  const first = runs[0]!;
  const last = runs[runs.length - 1]!;
  const start = parseISODate(first.startedAt);
  const end = parseISODate(last.startedAt);
  const monthDiff =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth() +
    1;
  const bucketCount = Math.min(monthDiff, maxMonths);
  return computeActivityBuckets(runs, bucketCount);
}
