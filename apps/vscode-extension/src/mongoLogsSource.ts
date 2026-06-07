import type { Collection, Document } from "mongodb";
import { normalizeLogCollection, type LogRecord } from "./logs.js";
import type { LogsAppendCallback, LogsQuery, LogsSource } from "./logsSource.js";

type LogEvent = { type: "warn" | "error" | "info"; message: string; meta?: Record<string, unknown> };

export class MongoLogsSource implements LogsSource {
  private changeStreamEnabled: boolean;
  private log?: (event: LogEvent) => void;

  constructor(
    private readonly getCollection: () => Promise<Collection<Record<string, unknown>>>,
    private readonly indexDefinitions: ReadonlyArray<Document>,
    options?: { changeStreamsEnabled?: boolean; log?: (event: LogEvent) => void },
  ) {
    this.changeStreamEnabled = options?.changeStreamsEnabled ?? false;
    this.log = options?.log;
  }

  async list({ limit, beforeTimestamp }: LogsQuery): Promise<LogRecord[]> {
    const collection = await this.getCollection();
    const filter: Record<string, unknown> = {};
    if (typeof beforeTimestamp === "string" && beforeTimestamp.length > 0) {
      filter.timestamp = { $lt: beforeTimestamp };
    }
    const items = await collection.find(filter).sort({ timestamp: -1 }).limit(limit).toArray();
    return normalizeLogCollection(items);
  }

  async ensureIndexes(): Promise<void> {
    const collection = await this.getCollection();
    await collection.createIndexes([...this.indexDefinitions]);
  }

  async dispose(): Promise<void> {
    // El client es singleton del service, no se cierra aquí.
  }

  async subscribe(onAppend: LogsAppendCallback): Promise<(() => Promise<void>) | null> {
    if (!this.changeStreamEnabled) return null;
    const collection = await this.getCollection();
    try {
      const stream = collection.watch(
        [{ $match: { operationType: "insert" } }],
        { fullDocument: "updateLookup" },
      );
      stream.on("change", (event: any) => {
        if (event.operationType !== "insert" || !event.fullDocument) return;
        const normalized = normalizeLogCollection([event.fullDocument]);
        if (normalized.length > 0) onAppend(normalized);
      });
      stream.on("error", (err: unknown) => {
        this.log?.({ type: "warn", message: "mongoLogsSource.changeStream.error", meta: { error: err instanceof Error ? err.message : String(err) } });
      });
      return async () => { try { await stream.close(); } catch { /* noop */ } };
    } catch (err) {
      this.log?.({ type: "warn", message: "mongoLogsSource.changeStream.unavailable", meta: { error: err instanceof Error ? err.message : String(err) } });
      return null;
    }
  }
}
