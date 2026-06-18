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
