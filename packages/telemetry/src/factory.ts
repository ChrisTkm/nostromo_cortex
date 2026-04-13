import type { TelemetryStore } from "./types.js";

export interface TelemetryStoreFactoryOptions {
  backend: "sqlite" | "jsonl";
  sqlitePath: string;
  jsonlPath: string;
}

export async function createTelemetryStore(options: TelemetryStoreFactoryOptions): Promise<TelemetryStore> {
  if (options.backend === "jsonl") {
    const { JsonlTelemetryStore } = await import("./jsonl-store.js");
    return new JsonlTelemetryStore(options.jsonlPath);
  }
  const { SqliteTelemetryStore } = await import("./sqlite-store.js");
  return new SqliteTelemetryStore(options.sqlitePath);
}
