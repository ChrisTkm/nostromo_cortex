import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createMongoActionPlanStore,
  createMongoAiAgentStore,
  createMongoNoteStore,
  buildGraphSnapshot,
  createMongoTaskStore,
  ensureAiAgentRuns,
  loadConfig,
  type MongoNoteStore,
  type NoteDocumentInput,
  type NoteRecord,
  queryRuns,
  SharedMongoClient,
  sampleTasks,
  stableStringify,
  type ActionPlanDocument,
  type ActionPlanRecord,
  type AgentRunQuery,
  type AgentRunRecord,
  type TaskDocumentInput,
  type TaskRecord,
} from "@cortex/core";
import {
  createLogger,
  JsonlTelemetryStore,
  TelemetryRecorder,
} from "@cortex/telemetry";
import type { ClientSession, Collection, Document } from "mongodb";
import * as vscode from "vscode";

import { type LogRecord } from "./logs/normalize.js";
import { clampLogsLimit } from "./logs/autoRefresh.js";
import { resolveLogsFilePath } from "./logs/filePath.js";
import { LOGS_INDEX_DEFINITIONS, type LogsSource } from "./logs/source.js";
import { MongoLogsSource } from "./logs/mongoSource.js";
import { FileLogsSource } from "./logs/fileSource.js";
import { DEFAULT_FILTER_STATE, type ExtensionFilterState } from "./state.js";

const MONGO_URL_SECRET_KEY = "cortex.mongoUrl";
const DEFAULT_MONGO_URL = "mongodb://127.0.0.1:27017";

type ConnectionSettings = ReturnType<
  ExtensionTaskService["getConnectionSettings"]
>;
type ExtensionFilterStatePatch = {
  [K in keyof ExtensionFilterState]?: ExtensionFilterState[K] | undefined;
};
type TaskBundle = {
  tasks: TaskRecord[];
  plans: ActionPlanRecord[];
};
type ArchivePlanResult = {
  jsonPath: string;
  noteCount: number;
  planCode: string;
  taskCount: number;
};
type RestorePlanResult = {
  planCode: string;
  taskCount: number;
  noteCount: number;
};
type DeleteArchivedPlanResult = {
  planCode: string;
  taskCount: number;
  noteCount: number;
  jsonDeleted: boolean;
};
type ExportArchiveResult = {
  zipPath: string;
  planCount: number;
};
type ImportArchiveResult = {
  imported: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
};
export type ArchivedTaskSummary = {
  code: string;
  shortTask: string;
  status?: string;
  completedAt?: string;
  completionNote?: string;
  commitHash?: string;
};
export type ArchivedNoteSummary = {
  title: string;
  body: string;
  createdAt?: string;
  tags: string[];
};
export type ArchivedPlanSummary = {
  code: string;
  title: string;
  description?: string;
  goal?: string;
  context?: string;
  completedAt?: string;
  archivedAt?: string;
  tags: string[];
  taskCount: number;
  noteCount: number;
  jsonPath: string;
  tasks: ArchivedTaskSummary[];
  notes: ArchivedNoteSummary[];
};

export class ExtensionTaskService {
  readonly logger;
  telemetry!: TelemetryRecorder;
  private readonly telemetryJsonlPath: string;
  private readonly config = vscode.workspace.getConfiguration("cortex");
  private mongoUrl = DEFAULT_MONGO_URL;
  private sharedClient: SharedMongoClient | undefined;
  private notesStore: MongoNoteStore | undefined;
  private logsSourceCache: { source: LogsSource; key: string } | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    const runtimeConfig = loadConfig({
      ...process.env,
      MONGO_URL: DEFAULT_MONGO_URL,
      MONGO_DB_NAME: this.config.get("mongoDbName", "cortex"),
      MONGO_TASKS_COLLECTION: this.config.get("mongoTasksCollection", "tasks"),
      TELEMETRY_BACKEND: this.config.get("telemetryBackend", "sqlite"),
      TELEMETRY_SQLITE_PATH: this.config.get(
        "telemetrySqlitePath",
        path.join(context.globalStorageUri.fsPath, "telemetry.db"),
      ),
    });

    this.telemetryJsonlPath = path.join(
      context.globalStorageUri.fsPath,
      "cortex-telemetry.jsonl",
    );
    this.logger = createLogger({
      level: runtimeConfig.logLevel,
      format: runtimeConfig.logFormat,
      context: { app: "cortex-vscode-extension" },
    });
  }

  async initialize() {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    await this.refreshMongoUrlFromSecrets();
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
    const persisted =
      this.context.workspaceState.get<Partial<ExtensionFilterState>>(
        "cortex.filterState",
      ) ?? {};
    const clampedZoom =
      typeof persisted.zoom === "number" && Number.isFinite(persisted.zoom)
        ? Math.min(Math.max(persisted.zoom, 0.2), 2.8)
        : DEFAULT_FILTER_STATE.zoom;

    return {
      ...DEFAULT_FILTER_STATE,
      ...persisted,
      pan: { ...DEFAULT_FILTER_STATE.pan, ...(persisted.pan ?? {}) },
      zoom: clampedZoom,
      selectedTags: Array.isArray(persisted.selectedTags)
        ? persisted.selectedTags
        : [],
      selectedProjects: Array.isArray(persisted.selectedProjects)
        ? persisted.selectedProjects
        : [],
      selectedGroups: Array.isArray(persisted.selectedGroups)
        ? persisted.selectedGroups
        : [],
      selectedStatuses: Array.isArray(persisted.selectedStatuses)
        ? persisted.selectedStatuses
        : [],
      selectedSeverities: Array.isArray(persisted.selectedSeverities)
        ? persisted.selectedSeverities
        : [],
      graphOrientation: persisted.graphOrientation === "TB" ? "TB" : "LR",
      showMiniMap:
        typeof persisted.showMiniMap === "boolean"
          ? persisted.showMiniMap
          : DEFAULT_FILTER_STATE.showMiniMap,
      groupByLane:
        typeof persisted.groupByLane === "boolean"
          ? persisted.groupByLane
          : DEFAULT_FILTER_STATE.groupByLane,
    };
  }

  getConnectionSettings() {
    return {
      mongoUrl: this.mongoUrl,
      mongoDbName: this.config.get("mongoDbName", "cortex"),
      mongoTasksCollection: this.config.get("mongoTasksCollection", "tasks"),
      mongoNotesCollection: this.config.get("mongoNotesCollection", "notes"),
      mongoLogsCollection: this.config.get("mongoLogsCollection", "logs"),
      mongoPlansCollection: this.config.get(
        "mongoPlansCollection",
        "action_plans",
      ),
    };
  }

  async updateFilterState(nextState: ExtensionFilterStatePatch) {
    await this.context.workspaceState.update("cortex.filterState", {
      ...this.getFilterState(),
      ...nextState,
    });
  }

  async loadTasks(): Promise<TaskRecord[]> {
    return this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.listTasks(),
    );
  }

  async loadPlans(): Promise<ActionPlanRecord[]> {
    return this.withPlanStore(this.getConnectionSettings(), (store) =>
      store.listPlans(),
    );
  }

  async loadBundle(): Promise<TaskBundle> {
    const [tasks, plans] = await Promise.all([
      this.loadTasks(),
      this.loadPlans(),
    ]);
    return { tasks, plans };
  }

  async loadSnapshot(
    filter?: Parameters<typeof buildGraphSnapshot>[1],
    bundle?: TaskBundle,
    selectedPlan?: ActionPlanRecord | null,
  ) {
    const sourceBundle = bundle ?? (await this.loadBundle());
    const plan =
      selectedPlan ??
      (filter?.planCode
        ? sourceBundle.plans.find(
            (candidate) => candidate.code === filter.planCode,
          )
        : undefined);
    const snapshot = buildGraphSnapshot(
      sourceBundle.tasks,
      filter,
      plan ? { plan } : undefined,
    );
    this.logger.debug("loadSnapshot", {
      filter,
      taskCount: sourceBundle.tasks.length,
      visibleNodeCount: snapshot.nodes.length,
      visibleEdgeCount: snapshot.edges.length,
    });
    return snapshot;
  }

  async getTask(codeOrId: string): Promise<TaskRecord | null> {
    return this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.getTask(codeOrId),
    );
  }

  async getPlan(code: string): Promise<ActionPlanRecord | null> {
    return this.withPlanStore(this.getConnectionSettings(), (store) =>
      store.getPlan(code),
    );
  }

  async updatePlan(
    code: string,
    patch: Partial<ActionPlanDocument>,
  ): Promise<ActionPlanRecord | null> {
    return this.withPlanStore(this.getConnectionSettings(), (store) =>
      store.updatePlan(code, patch),
    );
  }

  async createPlanWithTasks(
    plan: ActionPlanDocument,
    tasks: TaskDocumentInput[],
  ): Promise<{ plan: ActionPlanRecord; taskCount: number }> {
    const planCode = plan.code.trim();
    if (!planCode) throw new Error("Plan code is required.");
    if (!plan.title?.trim()) throw new Error("Plan title is required.");

    const taskCodes = tasks.map((t) => t.code).filter(Boolean) as string[];

    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);

    const planStore = createMongoActionPlanStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoPlansCollection,
      sharedClient,
    });

    const taskStore = createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection,
      sharedClient,
    });

    try {
      const existingPlan = await planStore.getPlan(planCode);
      if (existingPlan) {
        throw new Error(`Plan code '${planCode}' already exists.`);
      }

      const conflictCodes: string[] = [];
      for (const code of taskCodes) {
        const existing = await taskStore.getTask(code);
        if (existing) conflictCodes.push(code);
      }
      if (conflictCodes.length > 0) {
        throw new Error(
          `Task codes already exist: ${conflictCodes.join(", ")}. No changes were made.`,
        );
      }

      const inserted = await planStore.insertPlan(plan);
      const taskCount =
        tasks.length > 0 ? await taskStore.upsertTasks(tasks) : 0;

      return { plan: inserted, taskCount };
    } finally {
      await planStore.close();
      await taskStore.close();
    }
  }

  async appendPlanNote(
    code: string,
    text: string,
  ): Promise<ActionPlanRecord | null> {
    const plan = await this.getPlan(code);
    if (!plan) return null;
    const now = new Date().toISOString();
    const existing = plan.notes ?? "";
    const appended = existing
      ? `${existing}\n[${now}] ${text}`
      : `[${now}] ${text}`;
    return this.updatePlan(code, { notes: appended, updated_at: now });
  }

  async loadPlanTasks(planCode: string): Promise<TaskRecord[]> {
    return this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.listTasks({ planCode }),
    );
  }

  async recalcPlanProgress(planCode: string): Promise<ActionPlanRecord | null> {
    const tasks = await this.loadPlanTasks(planCode);
    const total = tasks.length;
    const pending = tasks.filter((t) => t.status === "PENDING").length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const blocked = tasks.filter((t) => t.status === "BLOCKED").length;
    const done = tasks.filter((t) => t.status === "DONE").length;
    const failed = tasks.filter((t) => t.status === "FAILED").length;
    const progress: ActionPlanRecord["progress"] = {
      total,
      pending,
      in_progress: inProgress,
      blocked,
      done,
      failed,
    };
    return this.updatePlan(planCode, {
      progress,
      updated_at: new Date().toISOString(),
    });
  }

  async bulkUpdateTaskStatus(
    planCode: string,
    codes: string[],
    status: string,
  ): Promise<ActionPlanRecord | null> {
    const patch: Record<string, unknown> = { status };
    if (status === "DONE") {
      patch.completed_at = new Date().toISOString();
    } else {
      patch.completed_at = null;
    }
    await this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.bulkUpdateTasks(codes, patch),
    );
    return this.recalcPlanProgress(planCode);
  }

  async bulkUpdateTaskAgent(
    planCode: string,
    codes: string[],
    agent: string,
  ): Promise<ActionPlanRecord | null> {
    await this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.bulkUpdateTasks(codes, { agent }),
    );
    return this.recalcPlanProgress(planCode);
  }

  async bulkMoveTasksToPlan(
    codes: string[],
    targetPlanCode: string,
  ): Promise<void> {
    const targetPlan = await this.getPlan(targetPlanCode);
    if (!targetPlan) throw new Error(`Target plan ${targetPlanCode} not found`);

    const sourceTasks = (
      await Promise.all(codes.map((c) => this.getTask(c)))
    ).filter(Boolean) as TaskRecord[];
    const sourcePlanCodes = [
      ...new Set(
        sourceTasks.map((t) => t.planCode).filter(Boolean) as string[],
      ),
    ];

    await this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.bulkUpdateTasks(codes, {
        plan_code: targetPlanCode,
        project: targetPlan.project ?? targetPlanCode,
      }),
    );

    for (const pc of sourcePlanCodes) {
      await this.recalcPlanProgress(pc);
    }
    await this.recalcPlanProgress(targetPlanCode);
  }

  async bulkDeleteTasks(
    planCode: string,
    codes: string[],
  ): Promise<ActionPlanRecord | null> {
    await this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.deleteTasks(codes),
    );
    return this.recalcPlanProgress(planCode);
  }

  async deletePlanWithTasks(code: string): Promise<{ taskCount: number }> {
    const tasks = await this.loadPlanTasks(code);
    const taskCodes = tasks.map((t) => t.code);
    if (taskCodes.length > 0) {
      await this.withTaskStore(this.getConnectionSettings(), (store) =>
        store.deleteTasks(taskCodes),
      );
    }
    await this.withPlanStore(this.getConnectionSettings(), (store) =>
      store.deletePlan(code),
    );
    return { taskCount: taskCodes.length };
  }

  isJsonPathInArchive(rawJsonPath: string): boolean {
    if (typeof rawJsonPath !== "string" || !rawJsonPath.trim()) return false;
    const candidate = path.normalize(rawJsonPath.trim());
    if (!candidate.toLowerCase().endsWith(".json")) return false;
    const archiveRoot = path.normalize(
      path.join(this.resolveArchivePath(), "plans"),
    );
    const relative = path.relative(archiveRoot, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
    return true;
  }

  getArchivePath(): string {
    return this.resolveArchivePath();
  }

  async archivePlan(planCode: string): Promise<ArchivePlanResult> {
    const code = planCode.trim();
    if (!code) {
      throw new Error("Plan code is required.");
    }

    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const plans = db.collection(settings.mongoPlansCollection);
    const tasksCollection = db.collection(settings.mongoTasksCollection);
    const notesCollection = db.collection(settings.mongoNotesCollection);
    const archivedPlans = db.collection("archived_plans");
    const archivedTasks = db.collection("archived_tasks");
    const archivedNotes = db.collection("archived_notes");

    const plan = await plans.findOne({ code });
    if (!plan) {
      throw new Error(`Plan ${code} not found.`);
    }
    if (
      String((plan as { status?: unknown }).status).toUpperCase() !== "DONE"
    ) {
      throw new Error(`Plan ${code} is not DONE.`);
    }

    const tasks = await tasksCollection.find({ plan_code: code }).toArray();
    const taskCodes = tasks
      .map((task) => (typeof task.code === "string" ? task.code : undefined))
      .filter((value): value is string => Boolean(value));
    const notes = await notesCollection
      .find({
        $or: [
          { plan_code: code },
          ...(taskCodes.length > 0 ? [{ task_code: { $in: taskCodes } }] : []),
        ],
      })
      .toArray();

    const logsCollection = await this.getLogsCollection(settings);
    const logs = await logsCollection
      .find({
        $or: [
          { plan_code: code },
          ...(taskCodes.length > 0 ? [{ task_code: { $in: taskCodes } }] : []),
        ],
      })
      .sort({ timestamp: 1 })
      .toArray();

    const archivedAt = new Date().toISOString();
    const archivePath = this.resolveArchivePath();
    const plansArchivePath = path.join(archivePath, "plans");
    await fs.mkdir(plansArchivePath, { recursive: true });
    const jsonPath = path.join(plansArchivePath, `${code}.json`);
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          archived_at: archivedAt,
          plan,
          tasks,
          notes,
          logs,
        },
        null,
        2,
      ),
      "utf8",
    );
    const archivedPlan = {
      ...plan,
      archived_at: archivedAt,
      json_path: jsonPath,
    };

    const runArchiveWrites = async (session?: ClientSession) => {
      await archiveDocuments(archivedPlans, [archivedPlan], session);
      await archiveDocuments(archivedTasks, tasks, session);
      await archiveDocuments(archivedNotes, notes, session);
      const deletedNotes = await notesCollection.deleteMany(
        { _id: { $in: notes.map((note) => note._id) } },
        session ? { session } : undefined,
      );
      const deletedTasks = await tasksCollection.deleteMany(
        { _id: { $in: tasks.map((task) => task._id) } },
        session ? { session } : undefined,
      );
      const deletedPlan = await plans.deleteOne(
        { _id: plan._id },
        session ? { session } : undefined,
      );
      if (
        deletedNotes.deletedCount !== notes.length ||
        deletedTasks.deletedCount !== tasks.length ||
        deletedPlan.deletedCount !== 1
      ) {
        this.logger.warn("archivePlan delete count mismatch", {
          planCode: code,
          expectedNotes: notes.length,
          deletedNotes: deletedNotes.deletedCount,
          expectedTasks: tasks.length,
          deletedTasks: deletedTasks.deletedCount,
          expectedPlans: 1,
          deletedPlans: deletedPlan.deletedCount,
        });
      }
    };

    const client = sharedClient.get();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await runArchiveWrites(session);
      });
    } catch (error) {
      this.logger.warn(
        "archivePlan transaction failed; falling back to ordered writes",
        {
          planCode: code,
          error: String(error),
        },
      );
      await runArchiveWrites();
    } finally {
      await session.endSession();
    }

    return {
      jsonPath,
      noteCount: notes.length,
      planCode: code,
      taskCount: tasks.length,
    };
  }

  async restorePlan(planCode: string): Promise<RestorePlanResult> {
    const code = planCode.trim();
    if (!code) {
      throw new Error("Plan code is required.");
    }

    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const plans = db.collection(settings.mongoPlansCollection);
    const tasksCollection = db.collection(settings.mongoTasksCollection);
    const notesCollection = db.collection(settings.mongoNotesCollection);
    const archivedPlans = db.collection("archived_plans");
    const archivedTasks = db.collection("archived_tasks");
    const archivedNotes = db.collection("archived_notes");

    const archivedPlan = await archivedPlans.findOne({ code });
    if (!archivedPlan) {
      throw new Error(`Archived plan ${code} not found.`);
    }

    const existingActive = await plans.findOne({ code });
    if (existingActive) {
      throw new Error(
        `Active plan ${code} already exists; cannot restore over it.`,
      );
    }

    const archivedTasksList = await archivedTasks
      .find({ plan_code: code })
      .toArray();
    const taskCodes = archivedTasksList
      .map((task) => (typeof task.code === "string" ? task.code : undefined))
      .filter((value): value is string => Boolean(value));
    const archivedNotesList = await archivedNotes
      .find({
        $or: [
          { plan_code: code },
          ...(taskCodes.length > 0 ? [{ task_code: { $in: taskCodes } }] : []),
        ],
      })
      .toArray();

    const {
      archived_at: _archivedAt,
      json_path: _jsonPath,
      ...planRest
    } = archivedPlan as Document & {
      archived_at?: unknown;
      json_path?: unknown;
    };
    const restoredPlan = {
      ...planRest,
      status: "IN_PROGRESS",
      updated_at: new Date().toISOString(),
    };

    const runRestoreWrites = async (session?: ClientSession) => {
      await archiveDocuments(plans, [restoredPlan], session);
      if (archivedTasksList.length > 0) {
        await archiveDocuments(tasksCollection, archivedTasksList, session);
      }
      if (archivedNotesList.length > 0) {
        await archiveDocuments(notesCollection, archivedNotesList, session);
      }
      const deletedNotes =
        archivedNotesList.length > 0
          ? await archivedNotes.deleteMany(
              { _id: { $in: archivedNotesList.map((n) => n._id) } },
              session ? { session } : undefined,
            )
          : { deletedCount: 0 };
      const deletedTasks =
        archivedTasksList.length > 0
          ? await archivedTasks.deleteMany(
              { _id: { $in: archivedTasksList.map((t) => t._id) } },
              session ? { session } : undefined,
            )
          : { deletedCount: 0 };
      const deletedPlan = await archivedPlans.deleteOne(
        { _id: archivedPlan._id },
        session ? { session } : undefined,
      );
      if (
        (deletedNotes.deletedCount ?? 0) !== archivedNotesList.length ||
        (deletedTasks.deletedCount ?? 0) !== archivedTasksList.length ||
        deletedPlan.deletedCount !== 1
      ) {
        this.logger.warn("restorePlan delete count mismatch", {
          planCode: code,
          expectedNotes: archivedNotesList.length,
          deletedNotes: deletedNotes.deletedCount,
          expectedTasks: archivedTasksList.length,
          deletedTasks: deletedTasks.deletedCount,
          expectedPlans: 1,
          deletedPlans: deletedPlan.deletedCount,
        });
      }
    };

    const client = sharedClient.get();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await runRestoreWrites(session);
      });
    } catch (error) {
      this.logger.warn(
        "restorePlan transaction failed; falling back to ordered writes",
        {
          planCode: code,
          error: String(error),
        },
      );
      await runRestoreWrites();
    } finally {
      await session.endSession();
    }

    return {
      planCode: code,
      taskCount: archivedTasksList.length,
      noteCount: archivedNotesList.length,
    };
  }

  async deleteArchivedPlan(
    planCode: string,
    options: { keepJson: boolean },
  ): Promise<DeleteArchivedPlanResult> {
    const code = planCode.trim();
    if (!code) {
      throw new Error("Plan code is required.");
    }

    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const archivedPlans = db.collection("archived_plans");
    const archivedTasks = db.collection("archived_tasks");
    const archivedNotes = db.collection("archived_notes");

    const archivedPlan = await archivedPlans.findOne({ code });
    if (!archivedPlan) {
      throw new Error(`Archived plan ${code} not found.`);
    }

    const archivedTasksList = await archivedTasks
      .find({ plan_code: code })
      .toArray();
    const taskCodes = archivedTasksList
      .map((task) => (typeof task.code === "string" ? task.code : undefined))
      .filter((value): value is string => Boolean(value));
    const archivedNotesList = await archivedNotes
      .find({
        $or: [
          { plan_code: code },
          ...(taskCodes.length > 0 ? [{ task_code: { $in: taskCodes } }] : []),
        ],
      })
      .toArray();

    const jsonPath =
      typeof archivedPlan.json_path === "string"
        ? archivedPlan.json_path
        : undefined;

    const runDeleteWrites = async (session?: ClientSession) => {
      const deletedNotes =
        archivedNotesList.length > 0
          ? await archivedNotes.deleteMany(
              { _id: { $in: archivedNotesList.map((n) => n._id) } },
              session ? { session } : undefined,
            )
          : { deletedCount: 0 };
      const deletedTasks =
        archivedTasksList.length > 0
          ? await archivedTasks.deleteMany(
              { _id: { $in: archivedTasksList.map((t) => t._id) } },
              session ? { session } : undefined,
            )
          : { deletedCount: 0 };
      const deletedPlan = await archivedPlans.deleteOne(
        { _id: archivedPlan._id },
        session ? { session } : undefined,
      );
      if (
        (deletedNotes.deletedCount ?? 0) !== archivedNotesList.length ||
        (deletedTasks.deletedCount ?? 0) !== archivedTasksList.length ||
        deletedPlan.deletedCount !== 1
      ) {
        this.logger.warn("deleteArchivedPlan delete count mismatch", {
          planCode: code,
          expectedNotes: archivedNotesList.length,
          deletedNotes: deletedNotes.deletedCount,
          expectedTasks: archivedTasksList.length,
          deletedTasks: deletedTasks.deletedCount,
          expectedPlans: 1,
          deletedPlans: deletedPlan.deletedCount,
        });
      }
    };

    const client = sharedClient.get();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await runDeleteWrites(session);
      });
    } catch (error) {
      this.logger.warn(
        "deleteArchivedPlan transaction failed; falling back to ordered writes",
        {
          planCode: code,
          error: String(error),
        },
      );
      await runDeleteWrites();
    } finally {
      await session.endSession();
    }

    let jsonDeleted = false;
    if (!options.keepJson && jsonPath) {
      try {
        await fs.unlink(jsonPath);
        jsonDeleted = true;
      } catch (error) {
        this.logger.warn("deleteArchivedPlan json unlink failed", {
          jsonPath,
          error: String(error),
        });
      }
    }

    return {
      planCode: code,
      taskCount: archivedTasksList.length,
      noteCount: archivedNotesList.length,
      jsonDeleted,
    };
  }

  async exportArchive(targetZipPath: string): Promise<ExportArchiveResult> {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const archivePath = path.join(this.resolveArchivePath(), "plans");
    let entries: string[];
    try {
      entries = await fs.readdir(archivePath);
    } catch (error) {
      throw new Error(`Could not read archive folder: ${String(error)}`);
    }
    const jsonFiles = entries.filter((name) =>
      name.toLowerCase().endsWith(".json"),
    );

    const manifestPlans: Array<{
      code: string;
      archived_at?: string;
      task_count: number;
      note_count: number;
    }> = [];

    for (const fileName of jsonFiles) {
      const fullPath = path.join(archivePath, fileName);
      const content = await fs.readFile(fullPath, "utf8");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        continue;
      }
      const plan =
        (parsed.plan as { code?: string; archived_at?: string }) ?? {};
      if (typeof plan.code !== "string") continue;
      zip.folder("plans")?.file(fileName, content);
      manifestPlans.push({
        code: plan.code,
        archived_at: plan.archived_at,
        task_count: Array.isArray(parsed.tasks) ? parsed.tasks.length : 0,
        note_count: Array.isArray(parsed.notes) ? parsed.notes.length : 0,
      });
    }

    const manifest = {
      version: 1,
      generated_at: new Date().toISOString(),
      source: "cortex-vscode-extension",
      count: manifestPlans.length,
      plans: manifestPlans,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    await fs.writeFile(targetZipPath, zipBuffer);

    return { zipPath: targetZipPath, planCount: manifestPlans.length };
  }

  async importArchive(sourceZipPath: string): Promise<ImportArchiveResult> {
    const JSZip = (await import("jszip")).default;

    let zipBuffer: Buffer;
    try {
      zipBuffer = await fs.readFile(sourceZipPath);
    } catch (error) {
      throw new Error(`Could not read ZIP file: ${String(error)}`);
    }

    let zip: typeof JSZip.prototype;
    try {
      zip = await JSZip.loadAsync(zipBuffer);
    } catch (error) {
      throw new Error(`Invalid ZIP file: ${String(error)}`);
    }

    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) {
      throw new Error(
        "ZIP missing manifest.json. Not a Cortex archive export.",
      );
    }
    const manifestRaw = await manifestFile.async("string");
    let manifest: { version?: number; plans?: Array<{ code?: string }> };
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      throw new Error("Invalid manifest.json in ZIP.");
    }
    if (manifest.version !== 1) {
      throw new Error(`Unsupported manifest version: ${manifest.version}.`);
    }

    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const archivedPlans = db.collection("archived_plans");
    const archivedTasks = db.collection("archived_tasks");
    const archivedNotes = db.collection("archived_notes");

    const plansDir = path.join(this.resolveArchivePath(), "plans");
    await fs.mkdir(plansDir, { recursive: true });

    const imported: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const planRef of manifest.plans ?? []) {
      const code = typeof planRef.code === "string" ? planRef.code : undefined;
      if (!code) continue;
      const fileName = `${code}.json`;
      const zipEntry = zip.file(`plans/${fileName}`);
      if (!zipEntry) {
        failed.push({ name: code, error: `Missing plans/${fileName} in ZIP.` });
        continue;
      }

      const existing = await archivedPlans.findOne({ code });
      if (existing) {
        skipped.push(code);
        continue;
      }

      try {
        const content = await zipEntry.async("string");
        const parsed = JSON.parse(content) as {
          plan?: Record<string, unknown>;
          tasks?: Record<string, unknown>[];
          notes?: Record<string, unknown>[];
        };
        const planDoc = parsed.plan;
        if (!planDoc) {
          failed.push({ name: code, error: "Missing plan in snapshot." });
          continue;
        }

        const stripId = <T extends Record<string, unknown>>(
          doc: T,
        ): Omit<T, "_id"> => {
          const { _id: _drop, ...rest } = doc;
          return rest;
        };

        await archivedPlans.insertOne(stripId(planDoc));
        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
          await archivedTasks.insertMany(parsed.tasks.map(stripId), {
            ordered: false,
          });
        }
        if (Array.isArray(parsed.notes) && parsed.notes.length > 0) {
          await archivedNotes.insertMany(parsed.notes.map(stripId), {
            ordered: false,
          });
        }

        const fullPath = path.join(plansDir, fileName);
        try {
          await fs.access(fullPath);
        } catch {
          await fs.writeFile(fullPath, content, "utf8");
        }

        imported.push(code);
      } catch (error) {
        failed.push({ name: code, error: String(error) });
      }
    }

    return { imported, skipped, failed };
  }

  async listArchivedPlans(): Promise<ArchivedPlanSummary[]> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const [plans, tasks, notes] = await Promise.all([
      db.collection("archived_plans").find({}).toArray(),
      db.collection("archived_tasks").find({}).toArray(),
      db.collection("archived_notes").find({}).toArray(),
    ]);
    const archivePath = this.resolveArchivePath();

    return plans
      .map((plan) => {
        const code = stringField(plan, "code");
        const planTasks = tasks.filter(
          (task) => stringField(task, "plan_code") === code,
        );
        const taskCodes = new Set(
          planTasks.map((task) => stringField(task, "code")).filter(Boolean),
        );
        const planNotes = notes.filter(
          (note) =>
            stringField(note, "plan_code") === code ||
            taskCodes.has(stringField(note, "task_code")),
        );
        const jsonPath =
          stringField(plan, "json_path") ||
          path.join(archivePath, "plans", `${code}.json`);

        return {
          code,
          title: stringField(plan, "title"),
          description: optionalStringField(plan, "description"),
          goal: optionalStringField(plan, "goal"),
          context: optionalStringField(plan, "context"),
          completedAt: optionalStringField(plan, "completed_at"),
          archivedAt: optionalStringField(plan, "archived_at"),
          tags: stringArrayField(plan, "tags"),
          taskCount: planTasks.length,
          noteCount: planNotes.length,
          jsonPath,
          tasks: planTasks
            .map((task) => ({
              code: stringField(task, "code"),
              shortTask: stringField(task, "short_task"),
              status: optionalStringField(task, "status"),
              completedAt: optionalStringField(task, "completed_at"),
              completionNote: optionalStringField(task, "completion_note"),
              commitHash: optionalStringField(task, "commit_hash"),
            }))
            .sort((left, right) => left.code.localeCompare(right.code)),
          notes: planNotes
            .map((note) => ({
              title: stringField(note, "title"),
              body: stringField(note, "body"),
              createdAt: optionalStringField(note, "created_at"),
              tags: stringArrayField(note, "tags"),
            }))
            .sort((left, right) =>
              (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
            ),
        } satisfies ArchivedPlanSummary;
      })
      .filter((plan) => plan.code)
      .sort((left, right) =>
        (right.archivedAt ?? right.completedAt ?? "").localeCompare(
          left.archivedAt ?? left.completedAt ?? "",
        ),
      );
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

  async listPendingReminders(options: {
    now: string | Date;
  }): Promise<NoteRecord[]> {
    const now = normalizeReminderIso(options.now);
    const notes = await this.listNotes();

    return notes
      .filter(
        (note) => note.remindAt && !note.remindedAt && note.remindAt <= now,
      )
      .sort((left, right) =>
        String(left.remindAt).localeCompare(String(right.remindAt)),
      );
  }

  async markReminded(
    code: string,
    when: string | Date,
  ): Promise<NoteRecord | null> {
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
      reminded_at: normalizeReminderIso(when),
    });
  }

  async rescheduleReminder(
    code: string,
    remindAt: string | Date,
  ): Promise<NoteRecord | null> {
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
      reminded_at: null,
    });
  }

  async listLogs(
    limit?: number,
    beforeTimestamp?: string,
  ): Promise<LogRecord[]> {
    const resolved = clampLogsLimit(
      limit ?? this.config.get<number>("logsLimit", 500),
    );
    return this.getLogsSource().list({ limit: resolved, beforeTimestamp });
  }

  async saveTask(task: TaskDocumentInput) {
    return this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.upsertTasks([task]),
    );
  }

  async listDatabaseNames() {
    return this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.listDatabaseNames(),
    );
  }

  async listCollectionNames(overrides?: Partial<ConnectionSettings>) {
    return this.withTaskStore(
      {
        ...this.getConnectionSettings(),
        ...overrides,
      },
      (store) => store.listCollectionNames(),
    );
  }

  async inspectCollection(overrides?: Partial<ConnectionSettings>) {
    return this.withTaskStore(
      {
        ...this.getConnectionSettings(),
        ...overrides,
      },
      (store) => store.inspectCollection(),
    );
  }

  async updateConnectionSettings(next: Partial<ConnectionSettings>) {
    const updatedSettings = {
      ...this.getConnectionSettings(),
      ...next,
    };

    if (next.mongoUrl) {
      await this.storeMongoUrl(next.mongoUrl);
    }
    if (next.mongoDbName) {
      await this.config.update(
        "mongoDbName",
        next.mongoDbName,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    if (next.mongoTasksCollection) {
      await this.config.update(
        "mongoTasksCollection",
        next.mongoTasksCollection,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    if (next.mongoNotesCollection) {
      await this.config.update(
        "mongoNotesCollection",
        next.mongoNotesCollection,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    if (next.mongoLogsCollection) {
      await this.config.update(
        "mongoLogsCollection",
        next.mongoLogsCollection,
        vscode.ConfigurationTarget.Workspace,
      );
    }

    if (next.mongoUrl) {
      await this.refreshSharedClient();
    }
    if (next.mongoUrl || next.mongoDbName || next.mongoNotesCollection) {
      this.notesStore = this.createNotesStore(updatedSettings);
    }
  }

  async clearMongoUrl() {
    await this.context.secrets.delete(MONGO_URL_SECRET_KEY);
    await this.refreshSharedClient();
  }

  async saveMongoUrl(mongoUrl: string) {
    await this.storeMongoUrl(mongoUrl);
  }

  async bootstrapSampleDatabase(overrides?: Partial<ConnectionSettings>) {
    const settings = {
      ...this.getConnectionSettings(),
      ...overrides,
    };
    await this.withTaskStore(settings, async (store) => {
      await store.upsertTasks(
        sampleTasks.map((task) => ({
          ...task,
          project: task.project ?? settings.mongoDbName,
        })),
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
      prompt: stableStringify(metadata),
    });

    await started.finish({
      success: true,
      metadata,
    });
  }

  private createStore(
    settings: ConnectionSettings = this.getConnectionSettings(),
  ) {
    const sharedClient = this.getSharedClient(settings);
    return createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection,
      ...(sharedClient ? { sharedClient } : {}),
    });
  }

  private createPlanStore(
    settings: ConnectionSettings = this.getConnectionSettings(),
  ) {
    const sharedClient = this.getSharedClient(settings);
    return createMongoActionPlanStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoPlansCollection,
      ...(sharedClient ? { sharedClient } : {}),
    });
  }

  private createNotesStore(
    settings: ConnectionSettings = this.getConnectionSettings(),
  ) {
    const sharedClient = this.getSharedClient(settings);
    return createMongoNoteStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoNotesCollection,
      ...(sharedClient ? { sharedClient } : {}),
    });
  }

  private getNotesStore(
    settings: ConnectionSettings = this.getConnectionSettings(),
  ) {
    if (!this.notesStore) {
      this.notesStore = this.createNotesStore(settings);
    }
    return this.notesStore;
  }

  private getSharedClient(settings: ConnectionSettings) {
    if (
      !this.sharedClient ||
      this.sharedClient.mongoUrl !== settings.mongoUrl
    ) {
      return undefined;
    }
    return this.sharedClient;
  }

  private async refreshSharedClient() {
    await this.refreshMongoUrlFromSecrets();
    const settings = this.getConnectionSettings();
    if (this.sharedClient?.mongoUrl === settings.mongoUrl) {
      return;
    }

    await this.sharedClient?.close();
    this.sharedClient = new SharedMongoClient(settings.mongoUrl);
    await this.sharedClient.connect();
    this.notesStore = this.createNotesStore(settings);
  }

  private async refreshMongoUrlFromSecrets() {
    this.mongoUrl =
      (await this.context.secrets.get(MONGO_URL_SECRET_KEY)) ||
      DEFAULT_MONGO_URL;
  }

  private async storeMongoUrl(mongoUrl: string) {
    await this.context.secrets.store(MONGO_URL_SECRET_KEY, mongoUrl);
    this.mongoUrl = mongoUrl;
    this.notesStore = undefined;
    await this.sharedClient?.close();
    this.sharedClient = undefined;
  }

  private async ensureMongoIndexes() {
    const settings = this.getConnectionSettings();
    const sharedClient = this.getSharedClient(settings);
    const taskStore = createMongoTaskStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoTasksCollection,
      ...(sharedClient ? { sharedClient } : {}),
    });
    const planStore = createMongoActionPlanStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: settings.mongoPlansCollection,
      ...(sharedClient ? { sharedClient } : {}),
    });
    const notesStore = this.getNotesStore(settings);
    const agentStore = createMongoAiAgentStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: "ai_agents",
      ...(sharedClient ? { sharedClient } : {}),
    });

    const db = sharedClient?.db(settings.mongoDbName);

    try {
      await Promise.all([
        taskStore.ensureIndexes(),
        planStore.ensureIndexes(),
        notesStore.ensureIndexes(),
        (async () => {
          await agentStore.ensureIndexes();
          await agentStore.ensureSeeds();
        })(),
        this.getLogsSource().ensureIndexes(),
        ...(db ? [ensureAiAgentRuns(db)] : []),
      ]);
    } finally {
      await Promise.all([
        taskStore.close(),
        planStore.close(),
        notesStore.close(),
        agentStore.close(),
      ]);
    }
  }

  private async getLogsCollection(
    settings: ConnectionSettings = this.getConnectionSettings(),
  ) {
    const sharedClient = await this.requireSharedClient(settings);
    return sharedClient
      .db(settings.mongoDbName)
      .collection<Record<string, unknown>>(settings.mongoLogsCollection);
  }

  private getLogsSource(): LogsSource {
    const kind = this.config.get<string>("logsSource", "mongo");
    const rawPath = this.config.get<string>("logsFilePath", "");
    const changeStreamsEnabled = this.config.get<boolean>(
      "logsChangeStreams",
      false,
    );
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resolvedPath = resolveLogsFilePath({
      configured: rawPath,
      workspaceRoot,
    });
    const key = `${kind}:${resolvedPath ?? ""}:cs=${changeStreamsEnabled}`;
    if (this.logsSourceCache?.key === key) {
      return this.logsSourceCache.source;
    }
    this.logsSourceCache?.source.dispose();
    let source: LogsSource;
    if (kind === "file" && resolvedPath) {
      source = new FileLogsSource({
        filePath: resolvedPath,
        log: (event) => {
          this.logger[event.type](event.message, event.meta);
        },
      });
    } else {
      source = new MongoLogsSource(
        () => this.getLogsCollection(),
        LOGS_INDEX_DEFINITIONS,
        {
          changeStreamsEnabled,
          log: (event) => {
            this.logger[event.type](event.message, event.meta);
          },
        },
      );
    }
    this.logsSourceCache = { source, key };
    return source;
  }

  async queryAgentRuns(query?: AgentRunQuery): Promise<AgentRunRecord[]> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    return queryRuns(db, query ?? {});
  }

  async listAiAgents(): Promise<
    Array<{ slug: string; displayName: string; iconPath?: string | null }>
  > {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const store = createMongoAiAgentStore({
      mongoUrl: settings.mongoUrl,
      dbName: settings.mongoDbName,
      collectionName: "ai_agents",
      ...(sharedClient ? { sharedClient } : {}),
    });
    try {
      return await store.listAgents();
    } finally {
      await store.close();
    }
  }

  private async requireSharedClient(settings: ConnectionSettings) {
    let sharedClient = this.getSharedClient(settings);
    if (!sharedClient) {
      await this.refreshSharedClient();
      sharedClient = this.getSharedClient(this.getConnectionSettings());
    }
    if (!sharedClient) {
      throw new Error("Mongo client unavailable");
    }
    return sharedClient;
  }

  private resolveArchivePath() {
    const configured = this.config.get<string>("archivePath", "").trim();
    return configured || path.join(os.homedir(), "cortex-archive");
  }

  private async withTaskStore<T>(
    settings: ConnectionSettings,
    handler: (store: ReturnType<typeof createMongoTaskStore>) => Promise<T>,
  ): Promise<T> {
    const store = this.createStore(settings);
    try {
      return await handler(store);
    } finally {
      await store.close();
    }
  }

  private async withPlanStore<T>(
    settings: ConnectionSettings,
    handler: (
      store: ReturnType<typeof createMongoActionPlanStore>,
    ) => Promise<T>,
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

async function archiveDocuments(
  collection: Collection<Document>,
  documents: Document[],
  session?: ClientSession,
) {
  await Promise.all(
    documents.map((document) =>
      collection.replaceOne({ _id: document._id }, document, {
        upsert: true,
        ...(session ? { session } : {}),
      }),
    ),
  );
}

function stringField(document: Document, key: string) {
  const value = document[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : "";
}

function optionalStringField(document: Document, key: string) {
  const value = stringField(document, key);
  return value || undefined;
}

function stringArrayField(document: Document, key: string) {
  const value = document[key];
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .sort((left, right) => left.localeCompare(right))
    : [];
}

/**
 * Traduce un patch de plan proveniente del webview (keys camelCase del
 * ActionPlanRecord) al shape persistible de ActionPlanDocument (snake_case).
 * Hoy el unico campo divergente es assignedAgent -> assigned_agent; null se
 * preserva para que updatePlan lo convierta en $unset.
 */
export function webviewPlanPatchToDocumentPatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const { assignedAgent, ...rest } = patch;
  if (assignedAgent === undefined) {
    return rest;
  }
  return { ...rest, assigned_agent: assignedAgent };
}
