import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseScriptFlowTraceJsonl } from "../runtimeTraceParser.js";
import { createScriptFlowTracer } from "./typescriptTrace.js";

describe("createScriptFlowTracer", () => {
  it("emits parser-compatible run, span, error, and loop JSONL", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "scriptflow-trace-"));
    const tracePath = join(tempDir, "sample.ts.scriptflow.trace.jsonl");

    try {
      const tracer = createScriptFlowTracer({
        scriptPath: join(tempDir, "sample.ts"),
        tracePath,
        runId: "helper-run",
        scriptHash: "fixture",
        machineId: "vitest",
        processId: "test",
        now: fixedClock(),
      });

      tracer.startRun();
      await tracer.span(
        {
          nodeId: "sf1:fn:main:l1c1",
          entityId: "sample.ts#main",
          spanId: "span-main",
        },
        async () => "ok",
      );

      const loop = tracer.createLoopAggregator({
        nodeId: "sf1:loop:for-item:l4c3",
        entityId: "sample.ts#main",
        spanId: "span-loop",
        flushEveryIterations: 3,
      });
      loop.sample(2, 1);
      loop.sample(3, 2);

      await expect(
        tracer.span(
          {
            nodeId: "sf1:try:catch:l8c3",
            entityId: "sample.ts#main",
            spanId: "span-error",
          },
          () => {
            throw new TypeError("boom");
          },
        ),
      ).rejects.toThrow("boom");

      tracer.endRun("error", { errors: 1 });

      const result = parseScriptFlowTraceJsonl(readFileSync(tracePath, "utf8"));
      expect(result.warnings).toEqual([]);
      expect(result.selectedRun).toMatchObject({
        runId: "helper-run",
        status: "error",
        machineIds: ["vitest"],
        processIds: ["test"],
      });
      expect(result.selectedRun?.nodes["sf1:fn:main:l1c1"]).toMatchObject({
        entityIds: ["sample.ts#main"],
        count: 1,
        lastStatus: "ok",
      });
      expect(result.selectedRun?.entityIds).toEqual(["sample.ts#main"]);
      expect(result.selectedRun?.nodesByEntityId["sample.ts#main"]).toEqual([
        "sf1:fn:main:l1c1",
        "sf1:loop:for-item:l4c3",
        "sf1:try:catch:l8c3",
      ]);
      expect(result.selectedRun?.nodes["sf1:loop:for-item:l4c3"]?.loop).toMatchObject({
        iterations: 3,
        sampleCount: 2,
        totalMs: 5,
      });
      expect(result.selectedRun?.nodes["sf1:try:catch:l8c3"]?.errors[0]).toMatchObject({
        type: "TypeError",
        message: "boom",
      });
      expect(result.selectedRun?.events.map((event) => event.event)).toEqual([
        "span_start",
        "span_end",
        "span_start",
        "span_error",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function fixedClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(`2026-06-19T18:50:00.${String(tick).padStart(3, "0")}Z`);
  };
}
