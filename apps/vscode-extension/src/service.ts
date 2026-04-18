import path from "node:path";

import {
  createMongoActionPlanStore,
  buildGraphSnapshot,
  createMongoTaskStore,
  loadConfig,
  SharedMongoClient,
  sampleTasks,
  stableStringify,
  type ActionPlanRecord,
  type TaskDocumentInput,
  type TaskRecord
} from "@cortex/core";
import * as vscode from "vscode";
import { createLogger } from "../../../packages/telemetry/src/logger.js";
import { JsonlTelemetryStore } from "../../../packages/telemetry/src/jsonl-store.js";
import { TelemetryRecorder } from "../../../packages/telemetry/src/recorder.js";

import { DEFAULT_FILTER_STATE, type ExtensionFilterState } from "./state.js";

type ConnectionSettings = ReturnType<ExtensionTaskService["getConnectionSettings"]>;
type ExtensionFilterStatePatch = {
  [K in keyof ExtensionFilterState]?: ExtensionFilterState[K] | undefined;
};
type TaskBundle = {
  tasks: TaskRecord[];
  plans: ActionPlanRecord[];
};

export class ExtensionTaskService {
  readonly logger;
  telemetry!: TelemetryRecorder;
  private readonly telemetryJsonlPath: string;
  private readonly config = vscode.workspace.getConfiguration("cortex");
  private sharedClient: SharedMongoClient | undefined;

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
    await this.refreshSharedClient();
    await this.ensureMongoIndexes();
  }

  async dispose() {
    await this.sharedClient?.close();
    this.sharedClient = undefined;
  }

  getFilterState(): ExtensionFilterState {
    const persisted = this.context.workspaceState.get<Partial<ExtensionFilterState>>("cortex.filterState") ?? {};
    const clampedZoom =
      typeof persisted.zoom === "number" && Number.isFinite(persisted.zoom)
        ? Math.min(Math.max(persisted.zoom, 0.2), 2.8)
        : DEFAULT_FILTER_STATE.zoom;

    return {
      ...DEFAULT_FILTER_STATE,
      ...persisted,
      pan: { ...DEFAULT_FILTER_STATE.pan, ...(persisted.pan ?? {}) },
      zoom: clampedZoom,
      selectedTags: Array.isArray(persisted.selectedTags) ? persisted.selectedTags : [],
      selectedProjects: Array.isArray(persisted.selectedProjects) ? persisted.selectedProjects : [],
      selectedGroups: Array.isArray(persisted.selectedGroups) ? persisted.selectedGroups : [],
      selectedStatuses: Array.isArray(persisted.selectedStatuses) ? persisted.selectedStatuses : [],
      selectedSeverities: Array.isArray(persisted.selectedSeverities) ? persisted.selectedSeverities : [],
      graphOrientation: persisted.graphOrientation === "TB" ? "TB" : "LR",
      showMiniMap: typeof persisted.showMiniMap === "boolean" ? persisted.showMiniMap : DEFAULT_FILTER_STATE.showMiniMap
    };
  }

  getConnectionSettings() {
    return {
      mongoUrl: this.config.get("mongoUrl", "mongodb://localhost:27017"),
      mongoDbName: this.config.get("mongoDbName", "cortex"),
      mongoTasksCollection: this.config.get("mongoTasksCollection", "tasks"),
      mongoPlansCollection: this.config.get("mongoPlansCollection", "action_plans")
    };
  }

  async updateFilterState(nextState: ExtensionFilterStatePatch) {
    await this.context.workspaceState.update("cortex.filterState", {
      ...this.getFilterState(),
      ...nextState
    });
  }

  async loadTasks(): Promise<TaskRecord[]> {
    return this.withTaskStore(this.getConnectionSettings(), (store) => store.listTasks());
  }

  async loadPlans(): Promise<ActionPlanRecord[]> {
    return this.withPlanStore(this.getConnectionSettings(), (store) => store.listPlans());
  }

  async loadBundle(): Promise<TaskBundle> {
    const [tasks, plans] = await Promise.all([this.loadTasks(), this.loadPlans()]);
    return { tasks, plans };
  }

  async loadSnapshot(
    filter?: Parameters<typeof buildGraphSnapshot>[1],
    bundle?: TaskBundle,
    selectedPlan?: ActionPlanRecord | null
  ) {
    const sourceBundle = bundle ?? (await this.loadBundle());
    const plan =
      selectedPlan ?? (filter?.planCode ? sourceBundle.plans.find((candidate) => candidate.code === filter.planCode) : undefined);
    const snapshot = buildGraphSnapshot(sourceBundle.tasks, filter, plan ? { plan } : undefined);
    this.logger.debug("loadSnapshot", {
      filter,
      taskCount: sourceBundle.tasks.length,
      visibleNodeCount: snapshot.nodes.length,
      visibleEdgeCount: snapshot.edges.length
    });
    return snapshot;
  }

  async getTask(codeOrId: string): Promise<TaskRecord | null> {
    return this.withTaskStore(this.getConnectionSettings(), (store) => store.getTask(codeOrId));
  }

  async getPlan(code: string): Promise<ActionPlanRecord | null> {
    return this.withPlanStore(this.getConnectionSettings(), (store) => store.getPlan(code));
  }

  async saveTask(task: TaskDocumentInput) {
    return this.withTaskStore(this.getConnectionSettings(), (store) => store.upsertTasks([task]));
  }

  async listDatabaseNames() {
    return this.withTaskStore(this.getConnectionSettings(), (store) => store.listDatabaseNames());
  }

  async listCollectionNames(overrides?: Partial<ConnectionSettings>) {
    return this.withTaskStore(
      {
        ...this.getConnectionSettings(),
        ...overrides
      },
      (store) => store.listCollectionNames()
    );
  }

  async inspectCollection(overrides?: Partial<ConnectionSettings>) {
    return this.withTaskStore(
      {
        ...this.getConnectionSettings(),
        ...overrides
      },
      (store) => store.inspectCollection()
    );
  }

  async updateConnectionSettings(next: Partial<ConnectionSettings>) {
    if (next.mongoUrl) {
      await this.config.update("mongoUrl", next.mongoUrl, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoDbName) {
      await this.config.update("mongoDbName", next.mongoDbName, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoTasksCollection) {
      await this.config.update("mongoTasksCollection", next.mongoTasksCollection, vscode.ConfigurationTarget.Workspace);
    }

    if (next.mongoUrl) {
      await this.refreshSharedClient();
    }
  }

  async bootstrapSampleDatabase(overrides?: Partial<ConnectionSettings>) {
    const settings = {
      ...this.getConnectionSettings(),
      ...overrides
    };
    await this.withTaskStore(settings, async (store) => {
      await store.upsertTasks(
        sampleTasks.map((task) => ({
          ...task,
          project: task.project ?? settings.mongoDbName
        }))
      );
    });
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

  private createStore(settings: ConnectionSettings = this.getConnectionSettings()) {
    const sharedClient = this.getSharedClient(settings);
    return createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection,
      ...(sharedClient ? { sharedClient } : {})
    });
  }

  private createPlanStore(settings: ConnectionSettings = this.getConnectionSettings()) {
    const sharedClient = this.getSharedClient(settings);
    return createMongoActionPlanStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoPlansCollection,
      ...(sharedClient ? { sharedClient } : {})
    });
  }

  private getSharedClient(settings: ConnectionSettings) {
    if (!this.sharedClient || this.sharedClient.mongoUrl !== settings.mongoUrl) {
      return undefined;
    }
    return this.sharedClient;
  }

  private async refreshSharedClient() {
    const settings = this.getConnectionSettings();
    if (this.sharedClient?.mongoUrl === settings.mongoUrl) {
      return;
    }

    await this.sharedClient?.close();
    this.sharedClient = new SharedMongoClient(settings.mongoUrl);
    await this.sharedClient.connect();
  }

  private async ensureMongoIndexes() {
    const settings = this.getConnectionSettings();
    const sharedClient = this.getSharedClient(settings);
    sharedClient?.get();

    const taskStore = createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection,
      ...(sharedClient ? { sharedClient } : {})
    });
    const planStore = createMongoActionPlanStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoPlansCollection,
      ...(sharedClient ? { sharedClient } : {})
    });

    try {
      await Promise.all([taskStore.ensureIndexes(), planStore.ensureIndexes()]);
    } finally {
      await Promise.all([taskStore.close(), planStore.close()]);
    }
  }

  private async withTaskStore<T>(settings: ConnectionSettings, handler: (store: ReturnType<typeof createMongoTaskStore>) => Promise<T>): Promise<T> {
    const store = this.createStore(settings);
    try {
      return await handler(store);
    } finally {
      await store.close();
    }
  }

  private async withPlanStore<T>(
    settings: ConnectionSettings,
    handler: (store: ReturnType<typeof createMongoActionPlanStore>) => Promise<T>
  ): Promise<T> {
    const store = this.createPlanStore(settings);
    try {
      return await handler(store);
    } finally {
      await store.close();
    }
  }
}
