export type LogDetail = {
  key: string;
  label: string;
  value: string;
};

export type LogRecord = {
  id?: string;
  day: string;
  event?: string;
  folder: string;
  level: string;
  loggerName?: string;
  message: string;
  process?: string;
  source: string;
  summary: string;
  timestamp: string;
  details: LogDetail[];
};

const CORE_KEYS = new Set(["_id", "timestamp", "level", "source", "logger_name", "process", "event", "message"]);
const PRIORITY_DETAIL_KEYS = ["file", "schema", "table", "periodo", "rows", "duration_ms", "endpoint", "status", "tipo", "test_run"];

export function normalizeLogCollection(items: unknown[]): LogRecord[] {
  const normalized: LogRecord[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    normalized.push(normalizeLogDocument(item as Record<string, unknown>));
  }

  return normalized.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function normalizeLogDocument(record: Record<string, unknown>): LogRecord {
  const source = firstString(record.source, record.logger_name, record.process) ?? "unknown";
  const timestamp = normalizeTimestamp(record.timestamp);
  const event = optionalString(record.event);
  const message = firstString(record.message, event) ?? "No message";

  return {
    ...(stringifyUnknown(record._id) ? { id: stringifyUnknown(record._id) } : {}),
    day: timestamp.slice(0, 10),
    ...(event ? { event } : {}),
    folder: inferFolder(source),
    level: (firstString(record.level) ?? "INFO").toUpperCase(),
    ...(optionalString(record.logger_name) ? { loggerName: optionalString(record.logger_name) } : {}),
    message,
    ...(optionalString(record.process) ? { process: optionalString(record.process) } : {}),
    source,
    summary: buildSummary({ event, message, process: optionalString(record.process), source }),
    timestamp,
    details: buildDetails(record)
  };
}

function buildDetails(record: Record<string, unknown>): LogDetail[] {
  const details: LogDetail[] = [];
  const usedKeys = new Set<string>();

  for (const key of PRIORITY_DETAIL_KEYS) {
    const raw = record[key];
    const value = stringifyUnknown(raw);
    if (!value) {
      continue;
    }
    usedKeys.add(key);
    details.push({
      key,
      label: formatLabel(key),
      value
    });
  }

  Object.keys(record)
    .filter((key) => !CORE_KEYS.has(key) && !usedKeys.has(key))
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      const value = stringifyUnknown(record[key]);
      if (!value) {
        return;
      }

      details.push({
        key,
        label: formatLabel(key),
        value
      });
    });

  return details;
}

function buildSummary(parts: { event?: string; message: string; process?: string; source: string }) {
  const lead = parts.event && parts.event !== parts.message ? `${parts.event} - ${parts.message}` : parts.message;
  return parts.process ? `${lead} (${parts.process})` : `${lead} (${parts.source})`;
}

function formatLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function inferFolder(source: string) {
  if (!source.trim()) {
    return "root";
  }

  if (source.includes("/") || source.includes("\\")) {
    const normalized = source.replace(/\\/g, "/").split("/").filter(Boolean);
    return normalized.length > 1 ? normalized[normalized.length - 2]! : normalized[0] ?? "root";
  }

  return source.split(".").filter(Boolean)[0] ?? "root";
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date(0).toISOString();
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyUnknown(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const joined = value.map((entry) => stringifyUnknown(entry)).filter(Boolean).join(", ");
    return joined || undefined;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return undefined;
}
