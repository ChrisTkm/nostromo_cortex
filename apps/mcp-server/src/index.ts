import { randomUUID } from "node:crypto";

import { createMongoTaskStore, loadConfig, stableStringify, type TaskFilter, TASK_SEVERITIES, TASK_STATUSES } from "@cortex/core";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CortexApplicationService } from "./service.js";

const filterSchema = {
  status: z.array(z.enum(TASK_STATUSES)).optional(),
  agent: z.array(z.string()).optional(),
  severity: z.array(z.enum(TASK_SEVERITIES)).optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  readyOnly: z.boolean().optional(),
  blockedOnly: z.boolean().optional()
};

function jsonContent(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: stableStringify(data)
      }
    ]
  };
}

function resourceContents(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: stableStringify(data)
      }
    ]
  };
}

async function main() {
  const config = loadConfig();
  const taskStore = createMongoTaskStore({
    mongoUrl: config.mongoUrl,
    dbName: config.mongoDbName,
    collectionName: config.mongoTasksCollection
  });
  const app = new CortexApplicationService(config, taskStore);
  await app.initialize();

  const server = new McpServer({
    name: "cortex",
    version: "0.1.0"
  });

  const defaultContext = {
    sessionId: randomUUID(),
    actor: "agent" as const
  };

  server.tool("task_list", filterSchema, async (filter) =>
    jsonContent(
      await app.withTelemetry(defaultContext, "task_list", filter, [], async () => app.taskList(filter as TaskFilter), {
        mongo_query_count: 1
      })
    )
  );

  server.tool("task_get", { code_or_id: z.string() }, async ({ code_or_id }) =>
    jsonContent(
      await app.withTelemetry(defaultContext, "task_get", { code_or_id }, [code_or_id], async () => app.taskGet(code_or_id), {
        mongo_query_count: 2
      })
    )
  );

  server.tool("task_ready_list", {}, async () =>
    jsonContent(
      await app.withTelemetry(defaultContext, "task_ready_list", {}, [], async () => app.taskReadyList(), {
        mongo_query_count: 1
      })
    )
  );

  server.tool("task_blockers", { code: z.string() }, async ({ code }) =>
    jsonContent(
      await app.withTelemetry(defaultContext, "task_blockers", { code }, [code], async () => app.taskBlockers(code), {
        mongo_query_count: 1
      })
    )
  );

  server.tool("task_downstream", { code: z.string() }, async ({ code }) =>
    jsonContent(
      await app.withTelemetry(defaultContext, "task_downstream", { code }, [code], async () => app.taskDownstream(code), {
        mongo_query_count: 1
      })
    )
  );

  server.tool("graph_snapshot", filterSchema, async (filter) => {
    const snapshot = await app.withTelemetry(defaultContext, "graph_snapshot", filter, [], async () => app.graphSnapshot(filter as TaskFilter), {
      mongo_query_count: 1
    });
    return jsonContent(snapshot);
  });

  server.tool("critical_path_estimate", {}, async () =>
    jsonContent(
      await app.withTelemetry(defaultContext, "critical_path_estimate", {}, [], async () => app.criticalPathEstimate(), {
        mongo_query_count: 1
      })
    )
  );

  server.tool("telemetry_recent_runs", { limit: z.number().int().positive().max(100).default(10) }, async ({ limit }) =>
    jsonContent(
      await app.withTelemetry(defaultContext, "telemetry_recent_runs", { limit }, [], async () => app.telemetryRecentRuns(limit), {
        mongo_query_count: 0
      })
    )
  );

  server.tool(
    "telemetry_cost_summary",
    {
      from: z.string().optional(),
      to: z.string().optional()
    },
    async ({ from, to }) =>
      jsonContent(
        await app.withTelemetry(
          defaultContext,
          "telemetry_cost_summary",
          { ...(from ? { from } : {}), ...(to ? { to } : {}) },
          [],
          async () => app.telemetryCostSummary({ ...(from ? { from } : {}), ...(to ? { to } : {}) }),
          {
          mongo_query_count: 0
          }
        )
      )
  );

  server.tool("task_cycles", {}, async () =>
    jsonContent(
      await app.withTelemetry(defaultContext, "task_cycles", {}, [], async () => app.cycles(), {
        mongo_query_count: 1
      })
    )
  );

  server.resource("tasks", "cortex://tasks", async (uri) => resourceContents(uri.href, await app.taskList({})));
  server.resource("task", new ResourceTemplate("cortex://tasks/{code}", { list: undefined }), async (uri, { code }) =>
    resourceContents(uri.href, await app.taskGet(String(code)))
  );
  server.resource("graph-snapshot", "cortex://graph/snapshot", async (uri) => resourceContents(uri.href, await app.graphSnapshot({})));
  server.resource("graph-ready", "cortex://graph/ready", async (uri) => resourceContents(uri.href, await app.taskReadyList()));
  server.resource("telemetry-recent", "cortex://telemetry/recent", async (uri) =>
    resourceContents(uri.href, await app.telemetryRecentRuns(10))
  );
  server.resource("telemetry-summary", "cortex://telemetry/summary", async (uri) =>
    resourceContents(uri.href, await app.telemetryCostSummary())
  );

  server.prompt("plan_execution_from_ready_tasks", {}, async () => {
    const ready = await app.taskReadyList();
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Planifica la ejecución de estas tareas listas, priorizando severidad y desbloqueo downstream:\n${stableStringify(ready)}`
          }
        }
      ]
    };
  });

  server.prompt("summarize_blockers", { code: z.string().optional() }, async ({ code }) => {
    const payload = code ? await app.taskBlockers(code) : await app.taskList({ blockedOnly: true });
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Resume los bloqueantes críticos y propone siguientes acciones:\n${stableStringify(payload)}`
          }
        }
      ]
    };
  });

  server.prompt("review_task_dependencies", { code: z.string().optional() }, async ({ code }) => {
    const payload = code ? await app.taskGet(code) : await app.graphSnapshot({});
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Revisa la calidad de dependencias, detecta ciclos, cuellos de botella y dependencias sospechosas:\n${stableStringify(payload)}`
          }
        }
      ]
    };
  });

  server.prompt("suggest_parallel_work", {}, async () => {
    const ready = await app.taskReadyList();
    const snapshot = await app.graphSnapshot({});
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Sugiere trabajo paralelo seguro a partir de las ready tasks y el snapshot del grafo:\n${stableStringify({ ready, snapshot })}`
          }
        }
      ]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  app.logger.info("Cortex MCP server started", { transport: "stdio" });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
