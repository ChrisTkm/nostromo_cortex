import path from "node:path";

import {
  buildGraphSnapshot,
  createMongoTaskStore,
  loadConfig,
  sampleTasks,
  stableStringify,
  type TaskDocumentInput,
  type TaskRecord
} from "@cortex/core";
import * as vscode from "vscode";
import { createLogger } from "../../../packages/telemetry/src/logger.js";
import { JsonlTelemetryStore } from "../../../packages/telemetry/src/jsonl-store.js";
import { TelemetryRecorder } from "../../../packages/telemetry/src/recorder.js";

import { DEFAULT_FILTER_STATE, type ExtensionFilterState } from "./state.js";

export class ExtensionTaskService {
  readonly logger;
  telemetry!: TelemetryRecorder;
  private readonly telemetryJsonlPath: string;
  private readonly config = vscode.workspace.getConfiguration("cortex");

  constructor(private readonly context: vscode.ExtensionContext) {
    const runtimeConfig = loadConfig({
      ...process.env,
      MONGO_URL: this.config.get("mongoUrl", "mongodb://localhost:27017"),
      MONGO_DB_NAME: this.config.get("mongoDbName", "cortex"),
      MONGO_TASKS_COLLECTION: this.config.get("mongoTasksCollection", "tasks"),
      TELEMETRY_BACKEND: this.config.get("telemetryBackend", "sqlite"),
      TELEMETRY_SQLITE_PATH: this.config.get("telemetrySqlitePath", path.join(context.globalStorageUri.fsPath, "telemetry.db"))
    });

    this.telemetryJsonlPath = path.join(context.globalStorageUri.fsPath, "cortex-telemetry.jsonl");
    this.logger = createLogger({
      level: runtimeConfig.logLevel,
      format: runtimeConfig.logFormat,
      context: { app: "cortex-vscode-extension" }
    });
  }

  async initialize() {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const telemetryStore = new JsonlTelemetryStore(this.telemetryJsonlPath);
    this.telemetry = new TelemetryRecorder(telemetryStore);
    await this.telemetry.initialize();
  }

  getFilterState(): ExtensionFilterState {
    return {
      ...DEFAULT_FILTER_STATE,
      ...(this.context.workspaceState.get<ExtensionFilterState>("cortex.filterState") ?? DEFAULT_FILTER_STATE)
    };
  }

  getConnectionSettings() {
    return {
      mongoUrl: this.config.get("mongoUrl", "mongodb://localhost:27017"),
      mongoDbName: this.config.get("mongoDbName", "cortex"),
      mongoTasksCollection: this.config.get("mongoTasksCollection", "tasks")
    };
  }

  async updateFilterState(nextState: Partial<ExtensionFilterState>) {
    await this.context.workspaceState.update("cortex.filterState", {
      ...this.getFilterState(),
      ...nextState
    });
  }

  async loadTasks(): Promise<TaskRecord[]> {
    const store = this.createStore();
    try {
      return await store.listTasks();
    } finally {
      await store.close();
    }
  }

  async loadSnapshot(filter?: Parameters<typeof buildGraphSnapshot>[1]) {
    const tasks = await this.loadTasks();
    return buildGraphSnapshot(tasks, filter);
  }

  async getTask(codeOrId: string): Promise<TaskRecord | null> {
    const store = this.createStore();
    try {
      return await store.getTask(codeOrId);
    } finally {
      await store.close();
    }
  }

  async saveTask(task: TaskDocumentInput) {
    const store = this.createStore();
    try {
      return await store.upsertTasks([task]);
    } finally {
      await store.close();
    }
  }

  async listDatabaseNames() {
    const store = this.createStore();
    try {
      return await store.listDatabaseNames();
    } finally {
      await store.close();
    }
  }

  async listCollectionNames(overrides?: Partial<ReturnType<ExtensionTaskService["getConnectionSettings"]>>) {
    const settings = {
      ...this.getConnectionSettings(),
      ...overrides
    };
    const store = createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection
    });
    try {
      return await store.listCollectionNames();
    } finally {
      await store.close();
    }
  }

  async inspectCollection(overrides?: Partial<ReturnType<ExtensionTaskService["getConnectionSettings"]>>) {
    const settings = {
      ...this.getConnectionSettings(),
      ...overrides
    };
    const store = createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection
    });
    try {
      return await store.inspectCollection();
    } finally {
      await store.close();
    }
  }

  async updateConnectionSettings(next: Partial<ReturnType<ExtensionTaskService["getConnectionSettings"]>>) {
    if (next.mongoUrl) {
      await this.config.update("mongoUrl", next.mongoUrl, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoDbName) {
      await this.config.update("mongoDbName", next.mongoDbName, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoTasksCollection) {
      await this.config.update("mongoTasksCollection", next.mongoTasksCollection, vscode.ConfigurationTarget.Workspace);
    }
  }

  async bootstrapSampleDatabase(overrides?: Partial<ReturnType<ExtensionTaskService["getConnectionSettings"]>>) {
    const settings = {
      ...this.getConnectionSettings(),
      ...overrides
    };
    const store = createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection
    });
    try {
      await store.upsertTasks(
        sampleTasks.map((task) => ({
          ...task,
          project: task.project ?? settings.mongoDbName
        }))
      );
    } finally {
      await store.close();
    }
    await this.updateConnectionSettings(settings);
  }

  async recordInteraction(toolName: string, metadata: Record<string, unknown>) {
    const started = this.telemetry.startRun({
      sessionId: vscode.env.sessionId,
      source: "vscode-extension",
      actor: "human",
      toolName,
      provider: "local",
      prompt: stableStringify(metadata)
    });

    await started.finish({
      success: true,
      metadata
    });
  }

  private createStore() {
    const settings = this.getConnectionSettings();
    return createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection
    });
  }
}
