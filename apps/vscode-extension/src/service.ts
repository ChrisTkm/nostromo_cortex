import { randomUUID } from "node:crypto";
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
  insertRun,
  loadConfig,
  type MongoNoteStore,
  type NoteDocumentInput,
  type NoteRecord,
  queryRuns,
  SharedMongoClient,
  sampleTasks,
  stableStringify,
  updateRun,
  type ActionPlanDocument,
  type ActionPlanRecord,
  type AgentRunDocument,
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

import { type LogsSource } from "./logs/source.js";
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
type CreateBackupResult = {
  id: string;
  path: string;
  documentCount: number;
  dataDocumentCount: number;
};
type RestoreBackupResult = {
  id: string;
  restoredCollections: number;
  restoredDocuments: number;
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
export type ArchiveStorageStats = {
  activeDocuments: number;
  activePlans: number;
  activeTasks: number;
  activeNotes: number;
  archivedDocuments: number;
  archivedPlans: number;
  archivedTasks: number;
  archivedNotes: number;
  jsonSnapshots: number;
  archivePath: string;
  plansPath: string;
};
export type BackupSummary = {
  id: string;
  createdAt: string;
  path: string;
  reason?: string;
  documentCount: number;
  dataDocumentCount: number;
  collections: Array<{ name: string; count: number }>;
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
    const config = vscode.workspace.getConfiguration("cortex");
    return {
      mongoUrl: this.mongoUrl,
      mongoDbName: config.get("mongoDbName", "cortex"),
      mongoTasksCollection: config.get("mongoTasksCollection", "tasks"),
      mongoNotesCollection: config.get("mongoNotesCollection", "notes"),
      mongoLogsCollection: config.get("mongoLogsCollection", "logs"),
      mongoPlansCollection: config.get(
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
    const [plan, tasks] = await Promise.all([
      this.getPlan(planCode),
      this.loadPlanTasks(planCode),
    ]);
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
    const now = new Date().toISOString();
    const patch: Partial<ActionPlanDocument> = {
      progress,
      updated_at: now,
    };

    if (total > 0 && done === total) {
      patch.status = "DONE";
      patch.current_task_code = null;
      patch.completed_at = plan?.completedAt ?? now;
    }

    return this.updatePlan(planCode, patch);
  }

  async bulkUpdateTaskStatus(
    planCode: string,
    codes: string[],
    status: string,
  ): Promise<ActionPlanRecord | null> {
    const existingTasks =
      status === "DONE"
        ? await Promise.all(codes.map((code) => this.getTask(code)))
        : [];
    const patch: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    if (status === "IN_PROGRESS") {
      patch.started_at = now;
      patch.completed_at = null;
    } else if (status === "DONE" || status === "FAILED") {
      patch.completed_at = now;
    } else {
      patch.completed_at = null;
    }
    await this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.bulkUpdateTasks(codes, patch),
    );
    if (status === "DONE") {
      await Promise.all(
        existingTasks.map(async (existing, index) => {
          const code = codes[index];
          if (!code || existing?.status === "DONE") return;
          const completedTask = await this.getTask(code);
          if (completedTask?.status === "DONE") {
            await this.ensureDoneTaskRun(completedTask, existing);
          }
        }),
      );
    }
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

    const archivedPlanFromMongo = await archivedPlans.findOne({ code });
    const diskSnapshot = archivedPlanFromMongo
      ? null
      : await this.readArchivedPlanSnapshot(code);
    const archivedPlan = archivedPlanFromMongo ?? diskSnapshot?.plan ?? null;
    const restoreFromMongo = Boolean(archivedPlanFromMongo);
    if (!archivedPlan) {
      throw new Error(`Archived plan ${code} not found.`);
    }

    const existingActive = await plans.findOne({ code });
    if (existingActive) {
      throw new Error(
        `Active plan ${code} already exists; cannot restore over it.`,
      );
    }

    const archivedTasksList = restoreFromMongo
      ? await archivedTasks.find({ plan_code: code }).toArray()
      : (diskSnapshot?.tasks ?? []);
    const taskCodes = archivedTasksList
      .map((task) => (typeof task.code === "string" ? task.code : undefined))
      .filter((value): value is string => Boolean(value));
    const archivedNotesList = restoreFromMongo
      ? await archivedNotes
          .find({
            $or: [
              { plan_code: code },
              ...(taskCodes.length > 0
                ? [{ task_code: { $in: taskCodes } }]
                : []),
            ],
          })
          .toArray()
      : (diskSnapshot?.notes ?? []);

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
        restoreFromMongo && archivedNotesList.length > 0
          ? await archivedNotes.deleteMany(
              { _id: { $in: archivedNotesList.map((n) => n._id) } },
              session ? { session } : undefined,
            )
          : { deletedCount: 0 };
      const deletedTasks =
        restoreFromMongo && archivedTasksList.length > 0
          ? await archivedTasks.deleteMany(
              { _id: { $in: archivedTasksList.map((t) => t._id) } },
              session ? { session } : undefined,
            )
          : { deletedCount: 0 };
      const deletedPlan = restoreFromMongo
        ? await archivedPlans.deleteOne(
            { _id: archivedPlan._id },
            session ? { session } : undefined,
          )
        : { deletedCount: 1 };
      if (
        (restoreFromMongo &&
          (deletedNotes.deletedCount ?? 0) !== archivedNotesList.length) ||
        (restoreFromMongo &&
          (deletedTasks.deletedCount ?? 0) !== archivedTasksList.length) ||
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

    const summaries = new Map<string, ArchivedPlanSummary>();
    for (const diskPlan of await this.listArchivedPlansFromDisk()) {
      summaries.set(diskPlan.code, diskPlan);
    }
    for (const mongoPlan of plans
      .map((plan) => this.toArchivedPlanSummary(plan, tasks, notes, archivePath))
      .filter((plan) => plan.code)) {
      summaries.set(mongoPlan.code, mongoPlan);
    }

    return [...summaries.values()]
      .sort((left, right) =>
        (right.archivedAt ?? right.completedAt ?? "").localeCompare(
          left.archivedAt ?? left.completedAt ?? "",
        ),
      );
  }

  async getArchiveStorageStats(): Promise<ArchiveStorageStats> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const [
      activePlans,
      activeTasks,
      activeNotes,
      archivedPlans,
      archivedTasks,
      archivedNotes,
      diskPlans,
    ] = await Promise.all([
      db.collection(settings.mongoPlansCollection).countDocuments(),
      db.collection(settings.mongoTasksCollection).countDocuments(),
      db.collection(settings.mongoNotesCollection).countDocuments(),
      db.collection("archived_plans").countDocuments(),
      db.collection("archived_tasks").countDocuments(),
      db.collection("archived_notes").countDocuments(),
      this.listArchivedPlansFromDisk(),
    ]);
    const archivePath = this.resolveArchivePath();
    const plansPath = path.join(archivePath, "plans");
    return {
      activeDocuments: activePlans + activeTasks + activeNotes,
      activePlans,
      activeTasks,
      activeNotes,
      archivedDocuments: archivedPlans + archivedTasks + archivedNotes,
      archivedPlans,
      archivedTasks,
      archivedNotes,
      jsonSnapshots: diskPlans.length,
      archivePath,
      plansPath,
    };
  }

  getBackupPath(): string {
    return this.resolveBackupPath();
  }

  isBackupId(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/.test(
      value.trim(),
    );
  }

  async countBackupDataDocuments(): Promise<number> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const counts = await Promise.all(
      this.getBackupDataCollectionNames(settings).map((name) =>
        db.collection(name).countDocuments(),
      ),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  }

  async createBackup(reason = "manual"): Promise<CreateBackupResult> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const id = backupStamp();
    const backupPath = path.join(this.resolveBackupPath(), id);
    await fs.mkdir(backupPath, { recursive: true });

    const collectionNames = this.getBackupCollectionNames(settings);
    const collections: Array<{ name: string; count: number; file: string }> = [];
    let documentCount = 0;
    let dataDocumentCount = 0;
    const dataCollections = new Set(this.getBackupDataCollectionNames(settings));

    for (const name of collectionNames) {
      const docs = await db.collection(name).find({}).toArray();
      const file = `${name}.json`;
      await fs.writeFile(
        path.join(backupPath, file),
        JSON.stringify(docs, null, 2),
        "utf8",
      );
      collections.push({ name, count: docs.length, file });
      documentCount += docs.length;
      if (dataCollections.has(name)) {
        dataDocumentCount += docs.length;
      }
    }

    const manifest = {
      version: 1,
      id,
      created_at: new Date().toISOString(),
      reason,
      database: settings.mongoDbName,
      document_count: documentCount,
      data_document_count: dataDocumentCount,
      collections,
    };
    await fs.writeFile(
      path.join(backupPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    await this.pruneBackups();

    return { id, path: backupPath, documentCount, dataDocumentCount };
  }

  async listBackups(): Promise<BackupSummary[]> {
    const backupRoot = this.resolveBackupPath();
    let entries: string[];
    try {
      entries = await fs.readdir(backupRoot);
    } catch {
      return [];
    }

    const backups: BackupSummary[] = [];
    for (const entry of entries) {
      const manifestPath = path.join(backupRoot, entry, "manifest.json");
      try {
        const manifest = JSON.parse(
          await fs.readFile(manifestPath, "utf8"),
        ) as {
          id?: unknown;
          created_at?: unknown;
          reason?: unknown;
          document_count?: unknown;
          data_document_count?: unknown;
          collections?: Array<{ name?: unknown; count?: unknown }>;
        };
        const id = stringValue(manifest.id) || entry;
        const createdAt = stringValue(manifest.created_at);
        if (!this.isBackupId(id) || !createdAt) continue;
        const collections = Array.isArray(manifest.collections)
          ? manifest.collections
              .map((collection) => ({
                name: stringValue(collection.name),
                count:
                  typeof collection.count === "number" ? collection.count : 0,
              }))
              .filter((collection) => collection.name)
          : [];
        backups.push({
          id,
          createdAt,
          path: path.dirname(manifestPath),
          reason: stringValue(manifest.reason) || undefined,
          documentCount:
            typeof manifest.document_count === "number"
              ? manifest.document_count
              : 0,
          dataDocumentCount:
            typeof manifest.data_document_count === "number"
              ? manifest.data_document_count
              : collections
                  .filter((collection) => collection.name !== "ai_agents")
                  .reduce((sum, collection) => sum + collection.count, 0),
          collections,
        });
      } catch (error) {
        this.logger.warn("backup manifest skipped", {
          manifestPath,
          error: String(error),
        });
      }
    }

    return backups.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  async restoreBackup(backupId: string): Promise<RestoreBackupResult> {
    const id = backupId.trim();
    if (!this.isBackupId(id)) {
      throw new Error("Invalid backup id.");
    }
    const backupPath = path.join(this.resolveBackupPath(), id);
    const manifest = JSON.parse(
      await fs.readFile(path.join(backupPath, "manifest.json"), "utf8"),
    ) as {
      collections?: Array<{ name?: unknown; file?: unknown; count?: unknown }>;
    };
    const settings = this.getConnectionSettings();
    const allowedCollections = new Set(this.getBackupCollectionNames(settings));
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    let restoredCollections = 0;
    let restoredDocuments = 0;

    for (const collectionRef of manifest.collections ?? []) {
      const name = stringValue(collectionRef.name);
      const file = stringValue(collectionRef.file);
      if (!name || !file || !allowedCollections.has(name)) continue;
      const docs = JSON.parse(
        await fs.readFile(path.join(backupPath, file), "utf8"),
      ) as Document[];
      const collection = db.collection(name);
      await collection.deleteMany({});
      if (docs.length > 0) {
        await collection.insertMany(docs, { ordered: false });
      }
      restoredCollections += 1;
      restoredDocuments += docs.length;
    }

    return { id, restoredCollections, restoredDocuments };
  }

  private toArchivedPlanSummary(
    plan: Document,
    tasks: Document[],
    notes: Document[],
    archivePath: string,
  ): ArchivedPlanSummary {
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
      stringField(plan, "json_path") || path.join(archivePath, "plans", `${code}.json`);

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
    };
  }

  private async listArchivedPlansFromDisk(): Promise<ArchivedPlanSummary[]> {
    const plansPath = path.join(this.resolveArchivePath(), "plans");
    let entries: string[];
    try {
      entries = await fs.readdir(plansPath);
    } catch {
      return [];
    }

    const summaries: ArchivedPlanSummary[] = [];
    for (const fileName of entries) {
      if (!fileName.toLowerCase().endsWith(".json")) continue;
      const jsonPath = path.join(plansPath, fileName);
      try {
        const snapshot = await this.readArchivedPlanSnapshotByPath(jsonPath);
        if (!snapshot) continue;
        const summary = this.toArchivedPlanSummary(
          snapshot.plan,
          snapshot.tasks,
          snapshot.notes,
          this.resolveArchivePath(),
        );
        if (summary.code) summaries.push(summary);
      } catch (error) {
        this.logger.warn("archive json snapshot skipped", {
          jsonPath,
          error: String(error),
        });
      }
    }
    return summaries;
  }

  private async readArchivedPlanSnapshot(planCode: string): Promise<{
    plan: Document;
    tasks: Document[];
    notes: Document[];
  } | null> {
    const jsonPath = path.join(
      this.resolveArchivePath(),
      "plans",
      `${planCode}.json`,
    );
    return this.readArchivedPlanSnapshotByPath(jsonPath);
  }

  private async readArchivedPlanSnapshotByPath(jsonPath: string): Promise<{
    plan: Document;
    tasks: Document[];
    notes: Document[];
  } | null> {
    const parsed = JSON.parse(await fs.readFile(jsonPath, "utf8")) as {
      archived_at?: unknown;
      plan?: Document;
      tasks?: Document[];
      notes?: Document[];
    };
    if (!parsed.plan) return null;
    return {
      plan: {
        ...parsed.plan,
        archived_at:
          stringValue(parsed.archived_at) ||
          optionalStringField(parsed.plan, "archived_at"),
        json_path: jsonPath,
      },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
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
    const existing = await this.getTask(task.code);
    const now = new Date().toISOString();
    const nextTask: TaskDocumentInput = { ...task };
    if (existing?.status !== nextTask.status) {
      if (nextTask.status === "IN_PROGRESS" && !existing?.startedAt) {
        nextTask.started_at = now;
        nextTask.completed_at = null;
      } else if (nextTask.status === "DONE" || nextTask.status === "FAILED") {
        nextTask.completed_at = now;
      } else if (existing?.status === "DONE" || existing?.status === "FAILED") {
        nextTask.completed_at = null;
      }
      nextTask.updated_at = now;
    }
    const saved = await this.withTaskStore(this.getConnectionSettings(), (store) =>
      store.upsertTasks([nextTask]),
    );
    if (existing?.status !== "DONE" && nextTask.status === "DONE") {
      const completedTask = await this.getTask(nextTask.code);
      await this.ensureDoneTaskRun(completedTask, existing);
    }
    const affectedPlanCodes = new Set<string>();
    if (existing?.planCode) {
      affectedPlanCodes.add(existing.planCode);
    }
    if (typeof nextTask.plan_code === "string" && nextTask.plan_code.trim()) {
      affectedPlanCodes.add(nextTask.plan_code.trim());
    }

    await Promise.all(
      [...affectedPlanCodes].map((planCode) =>
        this.recalcPlanProgress(planCode),
      ),
    );
    return saved;
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

  getLogsSource(): LogsSource {
    // Read fresh config each call: this.config is a one-time snapshot and would
    // not reflect a folder change made via the "Change" button (logs:selectFolder).
    const sources = vscode.workspace
      .getConfiguration("cortex")
      .get<string[]>("logsSources", ["C:\\dev\\Nostromo\\logs"]);
    const key = `file:${sources.join(",")}`;
    if (this.logsSourceCache?.key === key) {
      return this.logsSourceCache.source;
    }
    this.logsSourceCache?.source.dispose();
    const source = new FileLogsSource({
      sources,
      log: (event) => {
        this.logger[event.type](event.message, event.meta);
      },
    });
    this.logsSourceCache = { source, key };
    return source;
  }

  async queryAgentRuns(query?: AgentRunQuery): Promise<AgentRunRecord[]> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    return queryRuns(db, query ?? {});
  }

  async updateAgentRunReport(
    id: string,
    patch: Partial<AgentRunDocument>,
  ): Promise<void> {
    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    const current = await db.collection("agent_runs").findOne({ id });
    const startedAt = patch.started_at ?? current?.started_at;
    const endedAt = patch.ended_at ?? current?.ended_at;
    const startedTime = startedAt ? new Date(startedAt as string | Date).getTime() : Number.NaN;
    const endedTime = endedAt ? new Date(endedAt as string | Date).getTime() : Number.NaN;
    const durationPatch =
      Number.isFinite(startedTime) && Number.isFinite(endedTime)
        ? { duration_ms: Math.max(0, endedTime - startedTime) }
        : { duration_ms: null };
    await updateRun(db, id, {
      ...patch,
      ...durationPatch,
    });
  }

  private async ensureDoneTaskRun(
    task: TaskRecord | null,
    previous?: TaskRecord | null,
  ): Promise<string | null> {
    if (!task || task.status !== "DONE") {
      return null;
    }

    const settings = this.getConnectionSettings();
    const sharedClient = await this.requireSharedClient(settings);
    const db = sharedClient.db(settings.mongoDbName);
    await ensureAiAgentRuns(db);

    const collection = db.collection("agent_runs");
    const existing = await collection.findOne({ task_codes: task.code });
    const endedAt = task.completedAt ?? new Date().toISOString();
    const startedAt = task.startedAt ?? previous?.startedAt ?? endedAt;
    const startedTime = new Date(startedAt).getTime();
    const endedTime = new Date(endedAt).getTime();
    const durationMs =
      Number.isFinite(startedTime) && Number.isFinite(endedTime)
        ? Math.max(0, endedTime - startedTime)
        : null;
    const runPatch: Partial<AgentRunDocument> = {
      agent_slug: task.agent || previous?.agent || "any",
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      task_codes: [task.code],
      plan_codes: task.planCode ? [task.planCode] : [],
      files_touched: [],
      commits: [],
      status: "completed",
    };

    if (typeof existing?.id === "string" && existing.id.trim()) {
      await updateRun(db, existing.id, runPatch);
      return existing.id;
    }
    if (existing?._id) {
      const id = `task-${task.code}-${randomUUID()}`;
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            id,
            ...runPatch,
            updated_at: new Date().toISOString(),
          },
        },
      );
      return id;
    }

    const id = `task-${task.code}-${randomUUID()}`;
    await insertRun(db, {
      id,
      agent_slug: runPatch.agent_slug ?? "any",
      started_at: startedAt,
      ended_at: endedAt,
      ...(durationMs !== null ? { duration_ms: durationMs } : {}),
      task_codes: [task.code],
      plan_codes: task.planCode ? [task.planCode] : [],
      files_touched: [],
      commits: [],
      status: "completed",
    });
    return id;
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

  private resolveBackupPath() {
    const configured = this.config.get<string>("backup.path", "").trim();
    return configured || path.join(os.homedir(), "cortex-backups");
  }

  private getBackupRetentionDays() {
    const value = this.config.get<number>("backup.retentionDays", 30);
    return Math.max(1, Math.min(365, Math.floor(value)));
  }

  private getBackupCollectionNames(settings: ConnectionSettings) {
    return [
      settings.mongoPlansCollection,
      settings.mongoTasksCollection,
      settings.mongoNotesCollection,
      "agent_runs",
      "ai_agents",
      "archived_plans",
      "archived_tasks",
      "archived_notes",
      "logs",
    ].filter((name, index, all) => name && all.indexOf(name) === index);
  }

  private getBackupDataCollectionNames(settings: ConnectionSettings) {
    return this.getBackupCollectionNames(settings).filter(
      (name) => name !== "ai_agents",
    );
  }

  private async pruneBackups() {
    const retentionMs = this.getBackupRetentionDays() * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    for (const backup of await this.listBackups()) {
      const created = Date.parse(backup.createdAt);
      if (Number.isNaN(created) || created >= cutoff) continue;
      try {
        await fs.rm(backup.path, { recursive: true, force: true });
      } catch (error) {
        this.logger.warn("backup prune failed", {
          backupPath: backup.path,
          error: String(error),
        });
      }
    }
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
  return stringValue(value);
}

function optionalStringField(document: Document, key: string) {
  const value = stringField(document, key);
  return value || undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function backupStamp() {
  return new Date()
    .toISOString()
    .slice(0, 23)
    .replace(/T/, "_")
    .replace(/:/g, "-")
    .replace(/\./g, "-");
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
