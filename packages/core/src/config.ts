export interface CortexConfig {
  mongoUrl: string;
  mongoDbName: string;
  mongoTasksCollection: string;
  telemetryBackend: "sqlite" | "jsonl";
  telemetrySqlitePath: string;
  telemetryJsonlPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  logFormat: "pretty" | "json";
  snapshotMaxTasks: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CortexConfig {
  return {
    mongoUrl: env.MONGO_URL ?? "mongodb://localhost:27017",
    mongoDbName: env.MONGO_DB_NAME ?? "cortex",
    mongoTasksCollection: env.MONGO_TASKS_COLLECTION ?? "tasks",
    telemetryBackend: env.TELEMETRY_BACKEND === "jsonl" ? "jsonl" : "sqlite",
    telemetrySqlitePath: env.TELEMETRY_SQLITE_PATH ?? "./data/telemetry/cortex-telemetry.db",
    telemetryJsonlPath: env.TELEMETRY_JSONL_PATH ?? "./data/telemetry/cortex-telemetry.jsonl",
    logLevel: (env.LOG_LEVEL as CortexConfig["logLevel"]) ?? "info",
    logFormat: env.LOG_FORMAT === "json" ? "json" : "pretty",
    snapshotMaxTasks: Number(env.SNAPSHOT_MAX_TASKS ?? "500")
  };
}

