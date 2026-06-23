import { fileURLToPath } from "node:url";

import { createScriptFlowTracer } from "../../src/scriptFlow/instrumentation/typescriptTrace.js";

const scriptPath = fileURLToPath(import.meta.url);
const tracer = createScriptFlowTracer({
  scriptPath,
  machineId: "local-dev",
  processId: process.pid,
});

// Copy these from the Script Flow node IDs for the final instrumented script.
const NODE_ACCUMULATE = "sf1:fn:accumulate:l12c1";
const NODE_GUARD = "sf1:branch:if-limit-0:l28c11";
const NODE_LOOP = "sf1:loop:for-index-limit:l45c7";
const ENTITY_ACCUMULATE = "apps/vscode-extension/fixtures/script-flow/instrumented-sample.ts#accumulate";

export async function accumulate(limit: number) {
  return tracer.span(
    {
      nodeId: NODE_ACCUMULATE,
      entityId: ENTITY_ACCUMULATE,
      spanId: "span-accumulate",
    },
    async () => {
      let total = 0;

      await tracer.span(
        {
          nodeId: NODE_GUARD,
          entityId: ENTITY_ACCUMULATE,
          spanId: "span-guard",
          parentSpanId: "span-accumulate",
        },
        async () => {
          if (limit <= 0) {
            total = 0;
          }
        },
      );

      if (limit <= 0) {
        return total;
      }

      const loop = tracer.createLoopAggregator({
        nodeId: NODE_LOOP,
        entityId: ENTITY_ACCUMULATE,
        spanId: "span-loop",
        parentSpanId: "span-accumulate",
        flushEveryIterations: 1000,
      });

      for (let index = 0; index < limit; index += 1) {
        loop.measure(() => {
          total += index;
        });
      }
      loop.flush("loop_exit");

      return total;
    },
  );
}

async function main() {
  tracer.startRun({ invocation: "tsx instrumented-sample.ts" });
  let status: "ok" | "error" = "ok";
  try {
    await accumulate(2500);
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    tracer.endRun(status);
  }
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
