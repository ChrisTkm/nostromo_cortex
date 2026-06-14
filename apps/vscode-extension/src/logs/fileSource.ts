import { promises as fs, type Stats } from "node:fs";
import * as path from "node:path";
import { normalizeLogDocument, type LogRecord } from "./normalize.js";
import type { LogsQuery, LogsSource } from "./source.js";

const LOG_EXTENSIONS = new Set([".jsonl", ".json", ".log", ".txt"]);

export type FileLogsSourceLogger = (event: {
  type: "warn" | "info";
  message: string;
  meta?: Record<string, unknown>;
}) => void;

export type FileLogsSourceOptions = {
  sources: string[];
  log?: FileLogsSourceLogger;
};

export class FileLogsSource implements LogsSource {
  private cache: { signature: string; logs: LogRecord[] } | null = null;

  constructor(private readonly options: FileLogsSourceOptions) {}

  async list({ limit, beforeTimestamp }: LogsQuery): Promise<LogRecord[]> {
    const logs = await this.readAndCache();
    let filtered = logs;
    if (typeof beforeTimestamp === "string" && beforeTimestamp.length > 0) {
      filtered = logs.filter((entry) => entry.timestamp < beforeTimestamp);
    }
    return filtered.slice(0, limit);
  }

  async ensureIndexes(): Promise<void> {
    // No-op para file source.
  }

  async dispose(): Promise<void> {
    this.cache = null;
  }

  private async readAndCache(): Promise<LogRecord[]> {
    const files = await this.discoverFiles();
    const signature = await this.signatureOf(files);
    if (this.cache && this.cache.signature === signature) {
      return this.cache.logs;
    }
    const logs: LogRecord[] = [];
    for (const file of files) {
      let mtimeMs: number | undefined;
      try {
        const stat = await fs.stat(file);
        mtimeMs = stat.mtimeMs;
      } catch {
        // skip
      }
      const content = await this.readFileSafe(file);
      if (!content) continue;
      const parsed = this.parseContent(content, file, mtimeMs);
      logs.push(...parsed);
    }
    logs.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    this.cache = { signature, logs };
    return logs;
  }

  private async discoverFiles(): Promise<string[]> {
    const fileSet = new Set<string>();
    for (const sourcePath of this.options.sources) {
      try {
        const stat = await fs.stat(sourcePath);
        if (stat.isFile()) {
          fileSet.add(sourcePath);
        } else if (stat.isDirectory()) {
          await this.walkDir(sourcePath, fileSet);
        }
      } catch {
        this.options.log?.({
          type: "warn",
          message: "fileLogsSource.source_unavailable",
          meta: { path: sourcePath },
        });
      }
    }
    return [...fileSet].sort();
  }

  private async walkDir(dirPath: string, results: Set<string>): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await this.walkDir(fullPath, results);
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (LOG_EXTENSIONS.has(ext)) {
            results.add(fullPath);
          }
        }
      } catch {
        // skip
      }
    }
  }

  private async signatureOf(files: string[]): Promise<string> {
    const stats: Stats[] = [];
    for (const file of files) {
      try {
        stats.push(await fs.stat(file));
      } catch {
        // skip
      }
    }
    return stats.map((stat) => `${stat.size}:${stat.mtimeMs}`).join("|");
  }

  private async readFileSafe(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      this.options.log?.({
        type: "warn",
        message: "fileLogsSource.read_failed",
        meta: {
          file,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  private parseContent(content: string, file: string, mtimeMs?: number): LogRecord[] {
    const results: LogRecord[] = [];
    const trimmed = content.trim();
    if (!trimmed) return results;

    const ext = path.extname(file).toLowerCase();

    if (ext === ".json") {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const doc = this.jsonToRecord(item, mtimeMs);
            if (doc) results.push(doc);
          }
        } else if (parsed && typeof parsed === "object") {
          const doc = this.jsonToRecord(parsed, mtimeMs);
          if (doc) results.push(doc);
        }
        return results;
      } catch {
        // not valid JSON, fall through to line-based
      }
    }

    if (ext === ".jsonl") {
      for (const line of trimmed.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          const doc = this.recordWithMtimeFallback(raw, mtimeMs);
          results.push(doc);
        } catch {
          // skip malformed JSON line silently
        }
      }
      return results;
    }

    // .log / .txt: line-based best-effort
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const doc = this.lineToRecord(line, mtimeMs);
      if (doc) results.push(doc);
    }

    return results;
  }

  private lineToRecord(line: string, mtimeMs?: number): LogRecord | null {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      return this.recordWithMtimeFallback(raw, mtimeMs);
    } catch {
      // line-based best-effort for .log/.txt: wrap as message
      if (line.trim()) {
        return normalizeLogDocument({
          message: line.trim(),
          timestamp: mtimeMs ? new Date(mtimeMs).toISOString() : undefined,
          inferred: true,
        });
      }
      return null;
    }
  }

  private jsonToRecord(raw: unknown, mtimeMs?: number): LogRecord | null {
    if (typeof raw !== "object" || raw === null) return null;
    return this.recordWithMtimeFallback(raw as Record<string, unknown>, mtimeMs);
  }

  private recordWithMtimeFallback(record: Record<string, unknown>, mtimeMs?: number): LogRecord {
    const doc = normalizeLogDocument(record);
    if (mtimeMs !== undefined && (!doc.timestamp || doc.timestamp === new Date(0).toISOString())) {
      doc.timestamp = new Date(mtimeMs).toISOString();
      doc.inferred = true;
      doc.day = doc.timestamp.slice(0, 10);
    }
    return doc;
  }
}
