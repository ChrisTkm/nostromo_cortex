import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseScriptFlowTraceJsonl } from "./runtimeTraceParser.js";

const fixturesDir = path.join(__dirname, "runtimeTrace", "__fixtures__");
const loadFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("parseScriptFlowTraceJsonl", () => {
  it("aggregates the latest run by node_id for overlay consumption", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("runtime-trace-basic.jsonl"));
    expect(result.warnings).toEqual([]);
    expect(result.acceptedLines).toBe(10);
    expect(result.latestRunId).toBe("run-new");
    expect(result.selectedRun?.runId).toBe("run-new");

    const callNode = result.selectedRun?.nodes["sf1:call:fetch-orders:l3c3"];
    expect(callNode).toMatchObject({
      entityIds: ["sample.ts#fetchOrders"],
      count: 2,
      totalMs: 150,
      avgMs: 75,
      maxMs: 100,
      lastStatus: "ok",
      errorCount: 0
    });
    expect(callNode?.externalCalls).toMatchObject({
      count: 1,
      totalMs: 50,
      maxMs: 50,
      slowest: expect.objectContaining({
        targetKind: "http",
        target: "GET https://api.example.test/orders"
      })
    });

    const loopNode = result.selectedRun?.nodes["sf1:loop:for-order-of-orders:l4c3"];
    expect(loopNode?.loop).toMatchObject({
      iterations: 1000,
      sampleCount: 10,
      totalMs: 220,
      avgMs: 0.22,
      maxMs: 9
    });
    expect(loopNode?.entityIds).toEqual(["sample.ts#processOrders"]);
    expect(result.selectedRun?.entityIds).toEqual(["sample.ts#fetchOrders", "sample.ts#processOrders"]);
    expect(result.selectedRun?.nodesByEntityId).toMatchObject({
      "sample.ts#fetchOrders": ["sf1:call:fetch-orders:l3c3"],
      "sample.ts#processOrders": ["sf1:loop:for-order-of-orders:l4c3"],
    });

    const errorNode = result.selectedRun?.nodes["sf1:try:except:l8c3"];
    expect(errorNode?.errorCount).toBe(1);
    expect(errorNode?.errors[0]).toMatchObject({
      type: "TimeoutError",
      message: "request timed out",
      handled: true
    });

    expect(result.selectedRun?.activeSpans).toEqual([
      expect.objectContaining({
        spanId: "still-running",
        nodeId: "sf1:fn:background:l12c1",
        status: "running"
      })
    ]);

    expect(result.selectedRun?.events.map((event) => event.event)).toEqual([
      "span_start",
      "span_end",
      "span_error",
      "span_start"
    ]);
    expect(result.selectedRun?.events[0]).toMatchObject({
      entityId: "sample.ts#fetchOrders",
      nodeId: "sf1:call:fetch-orders:l3c3",
      spanId: "span-call",
      runId: "run-new"
    });
    expect(result.selectedRun?.events[2]).toMatchObject({
      event: "span_error",
      nodeId: "sf1:try:except:l8c3",
      errorType: "TimeoutError",
      errorMessage: "request timed out"
    });
  });

  it("selects a requested run when runId is provided", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("runtime-trace-basic.jsonl"), { runId: "run-old" });
    expect(result.latestRunId).toBe("run-new");
    expect(result.selectedRun?.runId).toBe("run-old");
    expect(result.selectedRun?.status).toBe("ok");
    expect(result.selectedRun?.durationMs).toBe(10);
    expect(result.selectedRun?.events).toEqual([]);
  });

  it("keeps parsing valid lines while reporting invalid JSONL warnings", () => {
    const result = parseScriptFlowTraceJsonl(loadFixture("runtime-trace-invalid.jsonl"));
    expect(result.acceptedLines).toBe(2);
    expect(result.skippedLines).toBe(4);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "invalid_json",
      "unsupported_version",
      "invalid_event",
      "missing_field"
    ]);
    expect(result.selectedRun?.runId).toBe("valid-run");
    expect(result.selectedRun?.nodes["sf1:fn:main:l1c1"]).toMatchObject({
      count: 1,
      totalMs: 42,
      lastStatus: "ok"
    });
    expect(result.selectedRun?.events).toHaveLength(1);
  });
});
