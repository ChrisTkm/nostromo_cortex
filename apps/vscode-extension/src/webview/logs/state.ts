import type { LogRecord } from "../../logs";

export const TIME_RANGE_MS: Record<"1h" | "24h" | "7d", number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000
};

export const LOGS_PYTHON_SNIPPET = `from datetime import datetime, timezone
from uuid import uuid4
from pymongo import MongoClient

logs = MongoClient("mongodb://127.0.0.1:27017").cortex.logs
exec_id = str(uuid4())

logs.insert_one({
    "execution_id": exec_id,
    "timestamp": datetime.now(timezone.utc),
    "tag": "BEGIN",
    "class": "MyLoader",
    "method": "run",
    "title": "Started run",
    "message": "Processing records",
    "level": "INFO",
})

logs.insert_one({
    "execution_id": exec_id,
    "timestamp": datetime.now(timezone.utc),
    "tag": "END",
    "class": "MyLoader",
    "method": "run",
    "title": "Run finished",
    "message": "All records processed",
    "level": "INFO",
})
`;

export type LogExecutionGroup = {
  id: string;
  label: string;
  logs: LogRecord[];
  beginTimestamp: string;
  endTimestamp?: string;
  durationMs?: number;
  classMethod: string;
  dominantTag: string;
  isUngrouped: boolean;
};

export const LOG_LEVEL_ORDER = ["ERROR", "WARNING", "WARN", "INFO", "DEBUG", "TRACE"] as const;

export function countLogsByLevel(logs: LogRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of logs) {
    const key = entry.level.toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function sortLogLevelKeys(keys: string[]): string[] {
  const known = LOG_LEVEL_ORDER.map((value) => value as string);
  return [...keys].sort((left, right) => {
    const leftIndex = known.indexOf(left);
    const rightIndex = known.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

export function filterLogsByTime(logs: LogRecord[], timeRange: "all" | "1h" | "24h" | "7d"): LogRecord[] {
  if (timeRange === "all") return logs;
  const cutoff = Date.now() - TIME_RANGE_MS[timeRange];
  return logs.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
}

export function buildLogKey(entry: LogRecord) {
  return entry.id ?? `${entry.timestamp}:${entry.source}:${entry.level}:${entry.summary}`;
}

export function buildExecutionGroups(logs: LogRecord[]): LogExecutionGroup[] {
  const byExecution = new Map<string, LogRecord[]>();
  const ungroupedByDay = new Map<string, LogRecord[]>();

  for (const entry of logs) {
    if (entry.executionId) {
      const current = byExecution.get(entry.executionId) ?? [];
      current.push(entry);
      byExecution.set(entry.executionId, current);
    } else {
      const day = entry.day || entry.timestamp.slice(0, 10);
      const current = ungroupedByDay.get(day) ?? [];
      current.push(entry);
      ungroupedByDay.set(day, current);
    }
  }

  const groups: LogExecutionGroup[] = [];

  for (const [executionId, entries] of byExecution) {
    groups.push(buildExecutionGroup(executionId, entries));
  }

  for (const [day, entries] of ungroupedByDay) {
    groups.push(buildExecutionGroup(`ungrouped:${day}`, entries, true, `ungrouped · ${day}`));
  }

  return groups.sort((left, right) => right.beginTimestamp.localeCompare(left.beginTimestamp));
}

export function coerceLogFilterValue(current: string, availableValues: string[]) {
  if (current === "all") {
    return current;
  }
  return availableValues.includes(current) ? current : "all";
}

export function reconcileSelectedLogKey(current: string | null, logs: LogRecord[]) {
  if (current && logs.some((entry) => buildLogKey(entry) === current)) {
    return current;
  }
  return logs[0] ? buildLogKey(logs[0]) : null;
}

export function getLogsEmptyState(logCount: number, filteredCount: number, hasActiveFilters: boolean) {
  if (logCount === 0) {
    return "empty";
  }
  if (filteredCount === 0 && hasActiveFilters) {
    return "filtered";
  }
  return "ready";
}

export function buildLogJson(log: LogRecord): string {
  return JSON.stringify(log, null, 2);
}

function buildExecutionGroup(executionId: string, entries: LogRecord[], isUngrouped = false, labelOverride?: string): LogExecutionGroup {
  const ordered = [...entries].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const begin = ordered.find((entry) => matchesTag(entry, "BEGIN")) ?? ordered[0]!;
  const end = [...ordered].reverse().find((entry) => matchesTag(entry, "END"));
  const newestFirst = [...ordered].reverse();
  const representative = newestFirst.find((entry) => entry.className || entry.methodName || entry.source) ?? newestFirst[0]!;
  const classMethod = [representative.className, representative.methodName].filter(Boolean).join(".") || representative.source;
  const dominantTag = getDominantTag(ordered);
  const durationMs = getDurationMs(begin.timestamp, end?.timestamp, end);

  return {
    id: executionId,
    label: labelOverride ?? (isUngrouped ? "ungrouped" : executionId),
    logs: newestFirst,
    beginTimestamp: begin.timestamp,
    ...(end ? { endTimestamp: end.timestamp } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    classMethod,
    dominantTag,
    isUngrouped
  };
}

function getDominantTag(logs: LogRecord[]) {
  if (logs.some((entry) => entry.level === "ERROR" || matchesTag(entry, "ERROR"))) {
    return "ERROR";
  }
  if (logs.some((entry) => entry.level === "WARNING" || matchesTag(entry, "WARNING"))) {
    return "WARNING";
  }
  return logs.find((entry) => entry.tag)?.tag ?? logs.find((entry) => entry.event)?.event ?? "INFO";
}

function getDurationMs(beginTimestamp: string, endTimestamp: string | undefined, endLog: LogRecord | undefined) {
  const explicit = endLog?.details.find((detail) => detail.key === "duration_ms")?.value;
  if (explicit && Number.isFinite(Number(explicit))) {
    return Number(explicit);
  }
  if (!endTimestamp) {
    return undefined;
  }
  const begin = new Date(beginTimestamp).getTime();
  const end = new Date(endTimestamp).getTime();
  return Number.isFinite(begin) && Number.isFinite(end) && end >= begin ? end - begin : undefined;
}

function matchesTag(entry: LogRecord, tag: string) {
  return entry.tag === tag || entry.event === tag;
}
