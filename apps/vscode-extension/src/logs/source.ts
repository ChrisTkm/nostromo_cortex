import type { Document } from "mongodb";
import type { LogRecord } from "./normalize.js";

export type LogsQuery = { limit: number; beforeTimestamp?: string };

export type LogsAppendCallback = (logs: LogRecord[]) => void;

export interface LogsSource {
  list(query: LogsQuery): Promise<LogRecord[]>;
  ensureIndexes(): Promise<void>;
  dispose(): Promise<void>;
  subscribe?(
    onAppend: LogsAppendCallback,
  ): Promise<(() => Promise<void>) | null>;
}

export const LOGS_INDEX_DEFINITIONS: ReadonlyArray<Document> = [
  { key: { source: 1, timestamp: -1 }, name: "logs_source_timestamp" },
  { key: { level: 1, timestamp: -1 }, name: "logs_level_timestamp" },
  {
    key: { process: 1, timestamp: -1 },
    name: "logs_process_timestamp",
    partialFilterExpression: { process: { $type: "string" } },
  },
  {
    key: { execution_id: 1, timestamp: -1 },
    name: "logs_execution_timestamp",
    partialFilterExpression: { execution_id: { $type: "string" } },
  },
  {
    key: { tag: 1, timestamp: -1 },
    name: "logs_tag_timestamp",
    partialFilterExpression: { tag: { $type: "string" } },
  },
];
