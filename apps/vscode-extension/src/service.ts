import path from "node:path";

import {
  createMongoActionPlanStore,
  createMongoNoteStore,
  buildGraphSnapshot,
  createMongoTaskStore,
  loadConfig,
  type MongoNoteStore,
  type NoteDocumentInput,
  type NoteRecord,
  SharedMongoClient,
  sampleTasks,
  stableStringify,
  type ActionPlanRecord,
  type TaskDocumentInput,
  type TaskRecord
} from "@cortex/core";
import { createLogger, JsonlTelemetryStore, TelemetryRecorder } from "@cortex/telemetry";
import * as vscode from "vscode";

import { normalizeLogCollection, type LogRecord } from "./logs.js";
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
  private notesStore: MongoNoteStore | undefined;

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
    this.notesStore = undefined;
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
      mongoNotesCollection: this.config.get("mongoNotesCollection", "notes"),
      mongoLogsCollection: this.config.get("mongoLogsCollection", "logs"),
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

  async listNotes(): Promise<NoteRecord[]> {
    return this.getNotesStore().listNotes();
  }

  async getNote(code: string): Promise<NoteRecord | null> {
    return this.getNotesStore().getNote(code);
  }

  async saveNote(input: NoteDocumentInput): Promise<NoteRecord> {
    return this.getNotesStore().upsertNote(input);
  }

  async deleteNote(code: string): Promise<boolean> {
    return this.getNotesStore().deleteNote(code);
  }

  async listPendingReminders(options: { now: string | Date }): Promise<NoteRecord[]> {
    const now = normalizeReminderIso(options.now);
    const notes = await this.listNotes();

    return notes
      .filter((note) => note.remindAt && !note.remindedAt && note.remindAt <= now)
      .sort((left, right) => String(left.remindAt).localeCompare(String(right.remindAt)));
  }

  async markReminded(code: string, when: string | Date): Promise<NoteRecord | null> {
    const note = await this.getNote(code);
    if (!note) {
      return null;
    }

    return this.saveNote({
      code: note.code,
      title: note.title,
      body: note.body,
      tags: note.tags,
      ...(note.taskCode ? { task_code: note.taskCode } : {}),
      ...(note.planCode ? { plan_code: note.planCode } : {}),
      ...(note.pinned ? { pinned: true } : {}),
      ...(note.remindAt ? { remind_at: note.remindAt } : {}),
      reminded_at: normalizeReminderIso(when)
    });
  }

  async rescheduleReminder(code: string, remindAt: string | Date): Promise<NoteRecord | null> {
    const note = await this.getNote(code);
    if (!note) {
      return null;
    }

    return this.saveNote({
      code: note.code,
      title: note.title,
      body: note.body,
      tags: note.tags,
      ...(note.taskCode ? { task_code: note.taskCode } : {}),
      ...(note.planCode ? { plan_code: note.planCode } : {}),
      ...(note.pinned ? { pinned: true } : {}),
      remind_at: normalizeReminderIso(remindAt),
      reminded_at: null
    });
  }

  async listLogs(limit = 500): Promise<LogRecord[]> {
    const collection = await this.getLogsCollection();
    const items = await collection.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
    return normalizeLogCollection(items);
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
    const updatedSettings = {
      ...this.getConnectionSettings(),
      ...next
    };

    if (next.mongoUrl) {
      await this.config.update("mongoUrl", next.mongoUrl, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoDbName) {
      await this.config.update("mongoDbName", next.mongoDbName, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoTasksCollection) {
      await this.config.update("mongoTasksCollection", next.mongoTasksCollection, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoNotesCollection) {
      await this.config.update("mongoNotesCollection", next.mongoNotesCollection, vscode.ConfigurationTarget.Workspace);
    }
    if (next.mongoLogsCollection) {
      await this.config.update("mongoLogsCollection", next.mongoLogsCollection, vscode.ConfigurationTarget.Workspace);
    }

    if (next.mongoUrl) {
      await this.refreshSharedClient();
    }
    if (next.mongoUrl || next.mongoDbName || next.mongoNotesCollection) {
      this.notesStore = this.createNotesStore(updatedSettings);
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

  private createNotesStore(settings: ConnectionSettings = this.getConnectionSettings()) {
    const sharedClient = this.getSharedClient(settings);
    return createMongoNoteStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoNotesCollection,
      ...(sharedClient ? { sharedClient } : {})
    });
  }

  private getNotesStore(settings: ConnectionSettings = this.getConnectionSettings()) {
    if (!this.notesStore) {
      this.notesStore = this.createNotesStore(settings);
    }
    return this.notesStore;
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
    this.notesStore = this.createNotesStore(settings);
  }

  private async ensureMongoIndexes() {
    const settings = this.getConnectionSettings();
    const sharedClient = this.getSharedClient(settings);
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
    const notesStore = this.getNotesStore(settings);
    const logsCollection = await this.getLogsCollection(settings);

    try {
      await Promise.all([
        taskStore.ensureIndexes(),
        planStore.ensureIndexes(),
        notesStore.ensureIndexes(),
        logsCollection.createIndexes([
          { key: { source: 1, timestamp: -1 }, name: "logs_source_timestamp" },
          { key: { level: 1, timestamp: -1 }, name: "logs_level_timestamp" },
          { key: { process: 1, timestamp: -1 }, name: "logs_process_timestamp", partialFilterExpression: { process: { $type: "string" } } }
        ])
      ]);
    } finally {
      await Promise.all([taskStore.close(), planStore.close(), notesStore.close()]);
    }
  }

  private async getLogsCollection(settings: ConnectionSettings = this.getConnectionSettings()) {
    let sharedClient = this.getSharedClient(settings);
    if (!sharedClient) {
      await this.refreshSharedClient();
      sharedClient = this.getSharedClient(this.getConnectionSettings());
    }
    if (!sharedClient) {
      throw new Error("Mongo client unavailable for logs collection");
    }
    return sharedClient.db(settings.mongoDbName).collection<Record<string, unknown>>(settings.mongoLogsCollection);
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

function normalizeReminderIso(value: string | Date) {
  return new Date(value).toISOString();
}
