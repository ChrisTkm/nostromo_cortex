export type LogDetail = {
  key: string;
  label: string;
  value: string;
};

export type CanonicalEvent = {
  timestamp: string;
  level: string;
  process: string;
  event: "BEGIN" | "STEP" | "INFO" | "WARN" | "ERROR" | "END" | string;
  message: string;
  execution_id?: string;
  duration_ms?: number;
  source?: string;
  target?: string;
  operation?: string;
  rows_read?: number;
  rows_inserted?: number;
  rows_updated?: number;
  rows_deleted?: number;
  entity?: string;
  host?: string;
  project?: string;
  script?: string;
  env?: string;
  inferred?: boolean;
};

export type LogRecord = {
  id?: string;
  className?: string;
  day: string;
  event?: string;
  executionId?: string;
  folder: string;
  methodName?: string;
  level: string;
  loggerName?: string;
  message: string;
  process?: string;
  source: string;
  summary: string;
  tag?: string;
  timestamp: string;
  title?: string;
  durationMs?: number;
  inferred?: boolean;
  facets?: {
    source?: string;
    target?: string;
    operation?: string;
    rowsRead?: number;
    rowsInserted?: number;
    rowsUpdated?: number;
    rowsDeleted?: number;
    entity?: string;
  };
  context?: {
    host?: string;
    project?: string;
    script?: string;
    env?: string;
  };
  details: LogDetail[];
};

const SYNONYM_MAP: Record<string, string> = {
  severity: "level",
  proc: "process",
  job: "process",
  msg: "message",
  created_at: "timestamp",
};

const CORE_KEYS = new Set([
  "_id",
  "timestamp",
  "level",
  "source",
  "logger_name",
  "process",
  "event",
  "message",
  "execution_id",
  "duration_ms",
  "tag",
  "class",
  "method",
  "title",
  "host",
  "project",
  "script",
  "env",
  "target",
  "operation",
  "rows_read",
  "rows_inserted",
  "rows_updated",
  "rows_deleted",
  "entity",
]);
const EVENT_SUMMARY_KEYS: Record<string, string[]> = {
  INSERT: ["rows", "table", "schema"],
  DELETE: ["rows", "table", "schema"],
  READ:   ["rows", "table", "schema"],
  QUERY:  ["rows", "table", "schema"],
  API:    ["endpoint", "status", "duration_ms"],
  MOVE_FILE_START:   ["file"],
  MOVE_FILE_SUCCESS: ["file"],
  BEGIN:  ["file", "nemo", "fondo"],
  END:    ["duration_ms", "filas"]
};

const MAX_SUMMARY_VALUE_LENGTH = 60;
const MAX_SUMMARY_KEYS = 3;

const PRIORITY_DETAIL_KEYS = ["file", "schema", "table", "periodo", "rows", "duration_ms", "endpoint", "status", "tipo", "test_run"];

function applySynonyms(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const canonical = SYNONYM_MAP[key.toLowerCase()] ?? key;
    if (canonical !== key && !(canonical in record)) {
      result[canonical] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

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
  const synced = applySynonyms(record);
  const className = optionalString(synced.class);
  const methodName = optionalString(synced.method);
  const classMethod = [className, methodName].filter(Boolean).join(".");
  const source = firstString(synced.source, synced.logger_name, classMethod, synced.process) ?? "unknown";
  const timestamp = normalizeTimestamp(synced.timestamp);
  const event = firstString(synced.event);
  const tag = firstString(synced.tag, event);
  const title = optionalString(synced.title);
  const message = firstString(synced.message, title, event) ?? "No message";
  const durationMsRaw = synced.duration_ms;
  const hasDuration = typeof durationMsRaw === "number" || (typeof durationMsRaw === "string" && /^\d+(\.\d+)?$/.test(durationMsRaw));
  const durationMs = hasDuration ? Number(durationMsRaw) : undefined;
  const inferred = synced.inferred === true;

  const facets: LogRecord["facets"] = {};
  for (const f of ["source", "target", "operation", "entity"] as const) {
    const val = optionalString(synced[f]);
    if (val) facets[f] = val;
  }
  for (const [f, key] of [["rowsRead", "rows_read"], ["rowsInserted", "rows_inserted"], ["rowsUpdated", "rows_updated"], ["rowsDeleted", "rows_deleted"]] as const) {
    const raw = synced[key];
    if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
      (facets as Record<string, unknown>)[f] = Number(raw);
    }
  }

  const context: LogRecord["context"] = {};
  for (const c of ["host", "project", "script", "env"] as const) {
    const val = optionalString(synced[c]);
    if (val) context[c] = val;
  }

  return {
    ...(stringifyUnknown(synced._id) ? { id: stringifyUnknown(synced._id) } : {}),
    ...(className ? { className } : {}),
    day: timestamp.slice(0, 10),
    ...(event ? { event } : {}),
    ...(optionalString(synced.execution_id) ? { executionId: optionalString(synced.execution_id) } : {}),
    folder: inferFolder(source),
    level: (firstString(synced.level) ?? "INFO").toUpperCase(),
    ...(optionalString(synced.logger_name) ? { loggerName: optionalString(synced.logger_name) } : {}),
    message,
    ...(methodName ? { methodName } : {}),
    ...(optionalString(synced.process) ? { process: optionalString(synced.process) } : {}),
    source,
    summary: buildSummary({ event, message, process: optionalString(synced.process), source, tag, title, record: synced }),
    ...(tag ? { tag } : {}),
    timestamp,
    ...(title ? { title } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(inferred ? { inferred: true } : {}),
    ...(Object.keys(facets).length > 0 ? { facets } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    details: buildDetails(synced)
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

function buildSummary(parts: { event?: string; message: string; process?: string; source: string; tag?: string; title?: string; record: Record<string, unknown> }) {
  const label = parts.title ?? parts.tag ?? parts.event;
  const extras = buildSummaryExtras(parts.event, parts.record);
  const baseLead = label && label !== parts.message ? `${label} - ${parts.message}` : parts.message;
  const lead = extras ? `${baseLead} ${extras}` : baseLead;
  return parts.process ? `${lead} (${parts.process})` : `${lead} (${parts.source})`;
}

function buildSummaryExtras(event: string | undefined, record: Record<string, unknown>): string | undefined {
  if (!event) return undefined;
  const keys = EVENT_SUMMARY_KEYS[event];
  if (!keys || keys.length === 0) return undefined;
  const pairs: string[] = [];
  for (const key of keys) {
    if (pairs.length >= MAX_SUMMARY_KEYS) break;
    const raw = record[key];
    const value = stringifyUnknown(raw);
    if (!value) continue;
    if (value.length > MAX_SUMMARY_VALUE_LENGTH) continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.length > 0 ? pairs.join(" ") : undefined;
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
