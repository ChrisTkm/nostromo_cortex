import type { LogRecord } from "../../logs";

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

export function buildLogKey(entry: LogRecord) {
  return entry.id ?? `${entry.timestamp}:${entry.source}:${entry.level}:${entry.summary}`;
}

export function buildExecutionGroups(logs: LogRecord[]): LogExecutionGroup[] {
  const byExecution = new Map<string, LogRecord[]>();
  const ungrouped: LogRecord[] = [];

  for (const entry of logs) {
    if (!entry.executionId) {
      ungrouped.push(entry);
      continue;
    }

    const current = byExecution.get(entry.executionId) ?? [];
    current.push(entry);
    byExecution.set(entry.executionId, current);
  }

  const groups = [...byExecution.entries()]
    .map(([executionId, entries]) => buildExecutionGroup(executionId, entries))
    .sort((left, right) => right.beginTimestamp.localeCompare(left.beginTimestamp));

  if (ungrouped.length > 0) {
    groups.push(buildExecutionGroup("ungrouped", ungrouped, true));
  }

  return groups;
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

function buildExecutionGroup(executionId: string, entries: LogRecord[], isUngrouped = false): LogExecutionGroup {
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
    label: isUngrouped ? "ungrouped" : executionId,
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
