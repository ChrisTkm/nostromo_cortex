import { promises as fs, type Stats } from "node:fs";
import * as path from "node:path";
import { normalizeLogDocument, type LogRecord } from "./logs.js";
import type { LogsQuery, LogsSource } from "./logsSource.js";

export type FileLogsSourceLogger = (event: { type: "warn" | "info"; message: string; meta?: Record<string, unknown> }) => void;

export type FileLogsSourceOptions = {
  filePath: string;
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
    const files = await this.discoverRotatedFiles();
    const signature = await this.signatureOf(files);
    if (this.cache && this.cache.signature === signature) {
      return this.cache.logs;
    }
    const logs: LogRecord[] = [];
    for (const file of files) {
      const content = await this.readFileSafe(file);
      if (!content) continue;
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const record = this.parseLine(line);
        if (record) logs.push(record);
      }
    }
    logs.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    this.cache = { signature, logs };
    return logs;
  }

  private async discoverRotatedFiles(): Promise<string[]> {
    const baseDir = path.dirname(this.options.filePath);
    const baseName = path.basename(this.options.filePath);
    let entries: string[];
    try {
      entries = await fs.readdir(baseDir);
    } catch {
      return [];
    }
    return entries
      .filter((name) => name === baseName || name.startsWith(`${baseName}.`))
      .map((name) => path.join(baseDir, name));
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
    return stats
      .map((stat) => `${stat.size}:${stat.mtimeMs}`)
      .join("|");
  }

  private async readFileSafe(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      this.options.log?.({
        type: "warn",
        message: "fileLogsSource.read_failed",
        meta: { file, error: error instanceof Error ? error.message : String(error) },
      });
      return null;
    }
  }

  private parseLine(line: string): LogRecord | null {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      return normalizeLogDocument(raw);
    } catch {
      return null;
    }
  }
}
