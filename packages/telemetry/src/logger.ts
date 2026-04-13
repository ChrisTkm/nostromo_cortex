import type { LogFormat, LogLevel } from "./types.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  context?: Record<string, unknown>;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly format: LogFormat;
  private readonly context: Record<string, unknown>;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.format = options.format ?? "pretty";
    this.context = options.context ?? {};
  }

  child(context: Record<string, unknown>): Logger {
    return new Logger({
      level: this.level,
      format: this.format,
      context: {
        ...this.context,
        ...context
      }
    });
  }

  debug(message: string, fields?: Record<string, unknown>) {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>) {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>) {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>) {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }

    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...fields
    };

    if (this.format === "json") {
      console.log(JSON.stringify(payload));
      return;
    }

    const extra = Object.entries(payload)
      .filter(([key]) => !["level", "message", "timestamp"].includes(key))
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" ");
    console.log(`[${payload.timestamp}] ${level.toUpperCase()} ${message}${extra ? ` ${extra}` : ""}`);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

