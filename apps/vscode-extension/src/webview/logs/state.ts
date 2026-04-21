import type { LogRecord } from "../../logs";

export function buildLogKey(entry: LogRecord) {
  return entry.id ?? `${entry.timestamp}:${entry.source}:${entry.level}:${entry.summary}`;
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
