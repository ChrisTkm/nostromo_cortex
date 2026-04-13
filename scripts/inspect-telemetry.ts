import { loadConfig } from "@cortex/core";
import { createTelemetryStore } from "@cortex/telemetry";

async function main() {
  const mode = process.argv[2] ?? "recent";
  const config = loadConfig();
  const store = await createTelemetryStore({
    backend: config.telemetryBackend,
    sqlitePath: config.telemetrySqlitePath,
    jsonlPath: config.telemetryJsonlPath
  });
  await store.initialize();

  if (mode === "recent") {
    console.log(JSON.stringify(await store.recentRuns(10), null, 2));
    return;
  }
  if (mode === "failures") {
    console.log(JSON.stringify(await store.recentFailures(10), null, 2));
    return;
  }
  if (mode === "cost") {
    console.log(JSON.stringify(await store.costSummary(), null, 2));
    return;
  }
  throw new Error(`Unsupported inspect mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
