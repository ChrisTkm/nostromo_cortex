import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseScriptFlowTraceJsonl } from "./runtimeTraceParser.js";

const fixturesDir = path.join(__dirname, "runtimeTrace", "__fixtures__");
const loadFixture = (name: string) =>
  readFileSync(path.join(fixturesDir, name), "utf8");

describe("Script Flow Live E2E runtime fixtures", () => {
  it("parses a small trace ready for overlay and replay", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("e2e-small.jsonl"));

    expect(result.warnings).toEqual([]);
    expect(result.selectedRun).toMatchObject({
      runId: "e2e-small",
      status: "ok",
      durationMs: 60,
      nodeCount: 1,
    });
    expect(result.selectedRun?.nodes["sf1:fn:accumulate:l1c1"]).toMatchObject({
      entityIds: ["apps/vscode-extension/fixtures/script-flow/sample.ts#accumulate"],
      count: 1,
      totalMs: 42,
      lastStatus: "ok",
    });
    expect(result.selectedRun?.nodesByEntityId).toMatchObject({
      "apps/vscode-extension/fixtures/script-flow/sample.ts#accumulate": ["sf1:fn:accumulate:l1c1"],
    });
    expect(result.selectedRun?.events.map((event) => event.event)).toEqual([
      "span_start",
      "span_end",
    ]);
  });

  it("keeps large loop telemetry aggregated instead of per-iteration", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("e2e-large-loop.jsonl"));
    const loop = result.selectedRun?.nodes["sf1:loop:for-index-limit:l8c3"];

    expect(result.warnings).toEqual([]);
    expect(result.selectedRun?.status).toBe("ok");
    expect(loop?.loop).toMatchObject({
      iterations: 100000,
      sampleCount: 100,
      totalMs: 1370,
      maxMs: 25,
    });
    expect(result.selectedRun?.eventCount).toBe(6);
  });

  it("distinguishes runtime errors from static analyzer warnings", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("e2e-error.jsonl"));
    const errorNode = result.selectedRun?.nodes["sf1:except:except-valueerror:l8c9"];

    expect(result.warnings).toEqual([]);
    expect(result.selectedRun?.status).toBe("error");
    expect(errorNode?.errorCount).toBe(1);
    expect(errorNode?.errors[0]).toMatchObject({
      type: "ValueError",
      message: "invalid score",
      handled: true,
    });
    expect(result.selectedRun?.events.map((event) => event.event)).toEqual([
      "span_start",
      "span_error",
      "span_end",
    ]);
  });

  it("parses external script evidence without requiring local execution", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("e2e-external-script.jsonl"));
    const dbNode = result.selectedRun?.nodes["sf1:call:postgres-reindex:l14c5"];

    expect(result.warnings).toEqual([]);
    expect(result.selectedRun).toMatchObject({
      runId: "e2e-external-script",
      scriptPath: "container://etl-worker/app/jobs/rebuild_indexes.py",
      machineIds: ["etl-worker-03"],
      processIds: ["k8s-job-8841"],
    });
    expect(dbNode?.externalCalls).toMatchObject({
      count: 1,
      totalMs: 830,
      maxMs: 830,
      slowest: expect.objectContaining({
        targetKind: "db",
        target: "postgres://analytics/reindex",
      }),
    });
  });
});
