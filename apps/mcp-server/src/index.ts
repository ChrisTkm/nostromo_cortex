import { randomUUID } from "node:crypto";

import { createMongoActionPlanStore, createMongoTaskStore, ensureAiAgentRuns, insertRun, loadConfig, queryAgentStats, queryRuns, stableStringify, updateRun, type ActionPlanDocument, type AgentRunDocument, type AgentRunQuery, type TaskFilter, TASK_SEVERITIES, TASK_STATUSES } from "@cortex/core";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MongoClient } from "mongodb";
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

function dedupe(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
}

function stringArrayField(record: Record<string, unknown> | null | undefined, field: string): string[] {
  const value = record?.[field];
  return Array.isArray(value) ? value.map(String) : [];
}

function parseDateInput(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }
  return parsed;
}

function durationMs(startedAt: Date, endedAt: Date | null): number | undefined {
  if (!endedAt) return undefined;
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

async function main() {
  const config = loadConfig();
  const taskStore = createMongoTaskStore({
    mongoUrl: config.mongoUrl,
    dbName: config.mongoDbName,
    collectionName: config.mongoTasksCollection
  });
  const planStore = createMongoActionPlanStore({
    mongoUrl: config.mongoUrl,
    dbName: config.mongoDbName,
    collectionName: "action_plans"
  });
  const app = new CortexApplicationService(config, taskStore);
  await app.initialize();

  const mongoClient = new MongoClient(config.mongoUrl);
  await mongoClient.connect();
  const db = mongoClient.db(config.mongoDbName);
  await ensureAiAgentRuns(db);

  const server = new McpServer({
    name: "cortex",
    version: "0.1.0"
  });

  const defaultContext = {
    sessionId: randomUUID(),
    actor: "agent" as const
  };

  async function validateAgentSlug(agentSlug: string): Promise<void> {
    const agents = db.collection("ai_agents");
    const knownAgentCount = await agents.countDocuments({});
    if (knownAgentCount === 0) return;
    const agent = await agents.findOne({ slug: agentSlug, active: { $ne: false } });
    if (!agent) {
      throw new Error(`Unknown or inactive agent_slug: ${agentSlug}`);
    }
  }

  async function resolveRunTaskContext(taskCodes: string[], explicitPlanCodes: string[] = []) {
    const tasks = await Promise.all(taskCodes.map((code) => taskStore.getTask(code)));
    const startedTimes = tasks
      .map((task) => (task?.startedAt ? new Date(task.startedAt).getTime() : Number.NaN))
      .filter((time) => Number.isFinite(time));
    return {
      planCodes: dedupe([
        ...explicitPlanCodes,
        ...tasks.map((task) => task?.planCode)
      ]),
      earliestStartedAt:
        startedTimes.length > 0
          ? new Date(Math.min(...startedTimes)).toISOString()
          : undefined
    };
  }

  async function recalcPlanProgress(planCode: string) {
    const [plan, tasks] = await Promise.all([
      planStore.getPlan(planCode),
      taskStore.listTasks({ planCode })
    ]);
    const progress = {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === "PENDING").length,
      in_progress: tasks.filter((task) => task.status === "IN_PROGRESS").length,
      blocked: tasks.filter((task) => task.status === "BLOCKED").length,
      done: tasks.filter((task) => task.status === "DONE").length,
      failed: tasks.filter((task) => task.status === "FAILED").length
    };
    const now = new Date().toISOString();
    const patch: Partial<ActionPlanDocument> = {
      progress,
      updated_at: now
    };
    if (progress.total > 0 && progress.done === progress.total) {
      patch.status = "DONE";
      patch.current_task_code = null;
      patch.completed_at = plan?.completedAt ?? now;
    } else if (progress.in_progress > 0 && plan?.status !== "DONE") {
      patch.status = "IN_PROGRESS";
      patch.current_task_code = tasks.find((task) => task.status === "IN_PROGRESS")?.code ?? null;
      patch.completed_at = null;
    }
    return planStore.updatePlan(planCode, patch);
  }

  async function writeAgentRun(input: {
    id?: string;
    agentSlug: string;
    modelId?: string;
    startedAt?: string;
    endedAt?: string;
    taskCodes?: string[];
    planCodes?: string[];
    files?: string[];
    commits?: string[];
    tokensIn?: number;
    tokensOut?: number;
    status: "running" | "completed" | "failed";
    notes?: string;
  }) {
    await validateAgentSlug(input.agentSlug);
    const now = new Date();
    const existing = input.id
      ? await db.collection("agent_runs").findOne({ id: input.id })
      : input.taskCodes?.length
      ? await db.collection("agent_runs").findOne({ task_codes: { $in: input.taskCodes } })
      : null;
    const taskCodes = dedupe([...stringArrayField(existing, "task_codes"), ...(input.taskCodes ?? [])]);
    const taskContext = await resolveRunTaskContext(
      taskCodes,
      dedupe([...stringArrayField(existing, "plan_codes"), ...(input.planCodes ?? [])])
    );
    const runId = input.id ?? (typeof existing?.id === "string" && existing.id.trim() ? existing.id : `run-${randomUUID()}`);
    const startedAt = parseDateInput(
      input.startedAt ??
        (existing?.started_at ? new Date(existing.started_at as string | Date).toISOString() : undefined) ??
        taskContext.earliestStartedAt,
      now
    );
    const endedAt =
      input.status === "running"
        ? input.endedAt
          ? parseDateInput(input.endedAt, now)
          : null
        : parseDateInput(input.endedAt, now);
    const patch: AgentRunDocument = {
      id: runId,
      agent_slug: input.agentSlug,
      ...(input.modelId ? { model_id: input.modelId } : existing?.model_id ? { model_id: existing.model_id as string } : {}),
      started_at: startedAt.toISOString(),
      ended_at: endedAt ? endedAt.toISOString() : null,
      ...(typeof durationMs(startedAt, endedAt) === "number" ? { duration_ms: durationMs(startedAt, endedAt) } : {}),
      task_codes: taskCodes,
      plan_codes: taskContext.planCodes,
      files_touched: dedupe([
        ...stringArrayField(existing, "files_touched"),
        ...stringArrayField(existing, "files"),
        ...(input.files ?? [])
      ]),
      commits: dedupe([...stringArrayField(existing, "commits"), ...(input.commits ?? [])]),
      ...(typeof input.tokensIn === "number" ? { tokens_in: input.tokensIn } : {}),
      ...(typeof input.tokensOut === "number" ? { tokens_out: input.tokensOut } : {}),
      status: input.status,
      ...(input.notes ? { notes: input.notes } : existing?.notes ? { notes: existing.notes as string } : {})
    };

    if (existing) {
      const { id: _patchId, ...update } = patch;
      if (typeof existing.id === "string" && existing.id.trim()) {
        await updateRun(db, existing.id, update);
      } else {
        await db.collection("agent_runs").updateOne(
          { _id: existing._id },
          {
            $set: {
              id: runId,
              ...update,
              updated_at: new Date().toISOString()
            },
            $unset: { files: "" }
          }
        );
      }
    } else {
      await insertRun(db, patch);
    }

    return {
      id: patch.id,
      agent_slug: patch.agent_slug,
      status: patch.status,
      started_at: patch.started_at,
      ended_at: patch.ended_at ?? null,
      duration_ms: patch.duration_ms ?? null,
      task_codes: patch.task_codes,
      plan_codes: patch.plan_codes ?? []
    };
  }

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

  server.tool(
    "record_run",
    {
      id: z.string().min(1).optional(),
      agent_slug: z.string().min(1),
      model_id: z.string().optional(),
      started_at: z.string().optional(),
      ended_at: z.string().optional(),
      task_codes: z.array(z.string()).default([]),
      plan_codes: z.array(z.string()).default([]),
      tokens_in: z.number().nonnegative().optional(),
      tokens_out: z.number().nonnegative().optional(),
      files: z.array(z.string()).default([]),
      commits: z.array(z.string()).default([]),
      notes: z.string().optional(),
      status: z.enum(["running", "completed", "failed"]).default("running")
    },
    async ({ id, agent_slug, model_id, started_at, ended_at, task_codes, plan_codes, tokens_in, tokens_out, files, commits, notes, status }) =>
      jsonContent(
        await writeAgentRun({
          ...(id ? { id } : {}),
          agentSlug: agent_slug,
          ...(model_id ? { modelId: model_id } : {}),
          ...(started_at ? { startedAt: started_at } : {}),
          ...(ended_at ? { endedAt: ended_at } : {}),
          taskCodes: task_codes,
          planCodes: plan_codes,
          files,
          commits,
          ...(typeof tokens_in === "number" ? { tokensIn: tokens_in } : {}),
          ...(typeof tokens_out === "number" ? { tokensOut: tokens_out } : {}),
          status,
          ...(notes ? { notes } : {})
        })
      )
  );

  server.tool(
    "task_start",
    {
      code: z.string().min(1),
      agent_slug: z.string().min(1),
      run_id: z.string().min(1).optional(),
      model_id: z.string().optional(),
      started_at: z.string().optional(),
      notes: z.string().optional()
    },
    async ({ code, agent_slug, run_id, model_id, started_at, notes }) => {
      await validateAgentSlug(agent_slug);
      const task = await taskStore.getTask(code);
      if (!task) throw new Error(`Task not found: ${code}`);
      const startedAt = parseDateInput(started_at, new Date()).toISOString();
      await taskStore.bulkUpdateTasks([task.code], {
        status: "IN_PROGRESS",
        agent: agent_slug,
        started_at: startedAt,
        completed_at: null
      });
      if (task.planCode) await recalcPlanProgress(task.planCode);
      const run = await writeAgentRun({
        ...(run_id ? { id: run_id } : {}),
        agentSlug: agent_slug,
        ...(model_id ? { modelId: model_id } : {}),
        startedAt,
        taskCodes: [task.code],
        planCodes: task.planCode ? [task.planCode] : [],
        status: "running",
        ...(notes ? { notes } : {})
      });
      return jsonContent({
        task_code: task.code,
        plan_code: task.planCode ?? null,
        run
      });
    }
  );

  server.tool(
    "task_complete",
    {
      code: z.string().min(1),
      agent_slug: z.string().min(1),
      run_id: z.string().min(1).optional(),
      model_id: z.string().optional(),
      started_at: z.string().optional(),
      ended_at: z.string().optional(),
      files: z.array(z.string()).default([]),
      commits: z.array(z.string()).default([]),
      tokens_in: z.number().nonnegative().optional(),
      tokens_out: z.number().nonnegative().optional(),
      status: z.enum(["completed", "failed"]).default("completed"),
      notes: z.string().optional()
    },
    async ({ code, agent_slug, run_id, model_id, started_at, ended_at, files, commits, tokens_in, tokens_out, status, notes }) => {
      await validateAgentSlug(agent_slug);
      const task = await taskStore.getTask(code);
      if (!task) throw new Error(`Task not found: ${code}`);
      const endedAt = parseDateInput(ended_at, new Date()).toISOString();
      const startedAt = parseDateInput(started_at ?? task.startedAt ?? undefined, new Date(endedAt)).toISOString();
      const taskStatus = status === "completed" ? "DONE" : "FAILED";
      await taskStore.bulkUpdateTasks([task.code], {
        status: taskStatus,
        agent: agent_slug,
        ...(task.startedAt ? {} : { started_at: startedAt }),
        completed_at: endedAt
      });
      if (task.planCode) await recalcPlanProgress(task.planCode);
      const run = await writeAgentRun({
        ...(run_id ? { id: run_id } : {}),
        agentSlug: agent_slug,
        ...(model_id ? { modelId: model_id } : {}),
        startedAt,
        endedAt,
        taskCodes: [task.code],
        planCodes: task.planCode ? [task.planCode] : [],
        files,
        commits,
        ...(typeof tokens_in === "number" ? { tokensIn: tokens_in } : {}),
        ...(typeof tokens_out === "number" ? { tokensOut: tokens_out } : {}),
        status,
        ...(notes ? { notes } : {})
      });
      return jsonContent({
        task_code: task.code,
        task_status: taskStatus,
        plan_code: task.planCode ?? null,
        run
      });
    }
  );

  server.tool(
    "query_runs",
    {
      agent_slug: z.string().optional(),
      status: z.enum(["running", "completed", "failed"]).optional(),
      limit: z.number().int().positive().max(200).default(50),
      before_timestamp: z.string().optional()
    },
    async ({ agent_slug, status, limit, before_timestamp }) => {
      const query: AgentRunQuery = { limit };
      if (agent_slug) query.agentSlug = agent_slug;
      if (status) query.status = status;
      if (before_timestamp) query.beforeTimestamp = before_timestamp;
      const runs = await queryRuns(db, query);
      return jsonContent(runs);
    }
  );

  server.tool(
    "agent_stats",
    {
      agent_slug: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional()
    },
    async ({ agent_slug, from, to }) => {
      const stats = await queryAgentStats(db, {
        ...(agent_slug ? { agentSlug: agent_slug } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      });
      return jsonContent(stats);
    }
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
