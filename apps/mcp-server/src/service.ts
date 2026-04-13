import {
  buildGraphSnapshot,
  buildTaskGraph,
  criticalPathEstimate,
  getReadyTasks,
  getTaskBlockers,
  getTaskDownstream,
  stableStringify,
  type GraphSnapshot,
  type TaskFilter,
  type TaskRecord,
  type TaskStore
} from "@cortex/core";
import { createLogger, createTelemetryStore, TelemetryRecorder } from "@cortex/telemetry";
import type { CortexConfig } from "@cortex/core";

export interface CortexToolContext {
  sessionId: string;
  actor: "agent" | "skill" | "human";
}

export class CortexApplicationService {
  telemetry!: TelemetryRecorder;
  readonly logger;

  constructor(
    private readonly config: CortexConfig,
    private readonly taskStore: TaskStore
  ) {
    this.logger = createLogger({
      level: config.logLevel,
      format: config.logFormat,
      context: { app: "cortex-mcp-server" }
    });
  }

  async initialize() {
    const telemetryStore = await createTelemetryStore({
      backend: this.config.telemetryBackend,
      sqlitePath: this.config.telemetrySqlitePath,
      jsonlPath: this.config.telemetryJsonlPath
    });
    this.telemetry = new TelemetryRecorder(telemetryStore);
    await this.telemetry.initialize();
  }

  async taskList(filter: TaskFilter = {}) {
    const tasks = await this.taskStore.listTasks();
    const graph = buildTaskGraph(tasks);
    const filtered = graph.nodes.filter((node) => {
      if (filter.search) {
        const haystack = `${node.code} ${node.shortTask} ${node.detail} ${node.agent} ${node.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(filter.search.toLowerCase())) {
          return false;
        }
      }
      if (filter.status && !filter.status.includes(node.status)) {
        return false;
      }
      if (filter.agent && !filter.agent.includes(node.agent)) {
        return false;
      }
      if (filter.severity && !filter.severity.includes(node.severity)) {
        return false;
      }
      if (filter.tags && !node.tags.some((tag) => filter.tags?.includes(tag))) {
        return false;
      }
      if (filter.codes && !filter.codes.includes(node.code)) {
        return false;
      }
      if (filter.readyOnly && !node.ready) {
        return false;
      }
      if (filter.blockedOnly && node.blockedByCount === 0) {
        return false;
      }
      return true;
    });

    return {
      filter,
      count: filtered.length,
      tasks: filtered.map((task) => ({
        code: task.code,
        short_task: task.shortTask,
        status: task.status,
        agent: task.agent,
        severity: task.severity,
        depends_on: task.dependsOn,
        tags: task.tags,
        ready: task.ready,
        blocked_by_count: task.blockedByCount,
        downstream_count: task.downstreamCount,
        updated_at: task.updatedAt
      })),
      cycles: graph.cycles
    };
  }

  async taskGet(codeOrId: string) {
    const tasks = await this.taskStore.listTasks();
    const graph = buildTaskGraph(tasks);
    const task = tasks.find((item) => item.code === codeOrId || item.id === codeOrId) ?? (await this.taskStore.getTask(codeOrId));
    if (!task) {
      return null;
    }
    const lookup = new Map(tasks.map((item) => [item.code, item]));
    const blockers = (graph.reverseAdjacency.get(task.code) ?? [])
      .map((code) => lookup.get(code))
      .filter((item): item is TaskRecord => Boolean(item));
    const successors = (graph.adjacency.get(task.code) ?? [])
      .map((code) => lookup.get(code))
      .filter((item): item is TaskRecord => Boolean(item));
    const node = graph.nodes.find((item) => item.code === task.code);

    return {
      task,
      blockers,
      successors,
      metrics: node
        ? {
            blocked_by_count: node.blockedByCount,
            downstream_count: node.downstreamCount,
            ready: node.ready
          }
        : undefined,
      cycles: graph.cycles
    };
  }

  async taskReadyList() {
    const tasks = await this.taskStore.listTasks();
    const readyTasks = getReadyTasks(tasks);
    return {
      count: readyTasks.length,
      tasks: readyTasks
    };
  }

  async taskBlockers(code: string) {
    const tasks = await this.taskStore.listTasks();
    return {
      code,
      blockers: getTaskBlockers(tasks, code)
    };
  }

  async taskDownstream(code: string) {
    const tasks = await this.taskStore.listTasks();
    return {
      code,
      downstream: getTaskDownstream(tasks, code)
    };
  }

  async graphSnapshot(filter: TaskFilter = {}): Promise<GraphSnapshot> {
    const tasks = await this.taskStore.listTasks();
    return buildGraphSnapshot(tasks, filter);
  }

  async criticalPathEstimate() {
    const tasks = await this.taskStore.listTasks();
    return criticalPathEstimate(tasks);
  }

  async cycles() {
    const tasks = await this.taskStore.listTasks();
    const graph = buildTaskGraph(tasks);
    return {
      count: graph.cycles.length,
      cycles: graph.cycles
    };
  }

  async telemetryRecentRuns(limit = 10) {
    return this.telemetry.recentRuns(limit);
  }

  async telemetryCostSummary(range?: { from?: string; to?: string }) {
    return this.telemetry.costSummary(range);
  }

  async withTelemetry<T>(
    context: CortexToolContext,
    toolName: string,
    input: Record<string, unknown>,
    taskCodes: string[],
    operation: () => Promise<T>,
    metadata: Record<string, unknown> = {}
  ): Promise<T> {
    const started = this.telemetry.startRun({
      sessionId: context.sessionId,
      source: "mcp-server",
      actor: context.actor,
      toolName,
      provider: "local",
      taskCodes,
      prompt: stableStringify(input),
      metadata
    });

    try {
      const result = await operation();
      await started.finish({
        success: true,
        metadata
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await started.finish({
        success: false,
        errorCode: "TOOL_EXECUTION_FAILED",
        errorMessage: message,
        metadata
      });
      throw error;
    }
  }
}
