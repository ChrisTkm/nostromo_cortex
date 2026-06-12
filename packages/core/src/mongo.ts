import { MongoClient, ObjectId, type Collection } from "mongodb";

import { normalizeActionPlan, normalizeAiAgentDocument, normalizeAgentRunDocument, normalizeNote, normalizeTaskDocument } from "./schema.js";
import type {
  ActionPlanDocument,
  ActionPlanRecord,
  AgentRunDocument,
  AgentRunRecord,
  AgentStatsRecord,
  AiAgentDocument,
  AiAgentRecord,
  AiAgentStore,
  NoteDocumentInput,
  NoteRecord,
  NoteStore,
  TaskDocumentInput,
  TaskRecord,
  TaskStore
} from "./types.js";

export interface MongoTaskStoreOptions {
  mongoUrl: string;
  dbName: string;
  collectionName: string;
  sharedClient?: SharedMongoClient;
}

export interface MongoActionPlanStoreOptions {
  mongoUrl: string;
  dbName: string;
  collectionName: string;
  sharedClient?: SharedMongoClient;
}

export interface MongoNoteStoreOptions {
  mongoUrl: string;
  dbName: string;
  collectionName: string;
  sharedClient?: SharedMongoClient;
}

type MongoClientLike = Pick<MongoClient, "connect" | "db" | "close">;

const LEGACY_TASK_INDEX_NAMES = ["tasks_code_unique", "tasks_status_created_at", "tasks_tags", "tasks_plan_code"] as const;
const LEGACY_NOTE_INDEX_NAMES = ["notes_created_at", "notes_tags"] as const;

export class SharedMongoClient {
  readonly mongoUrl: string;

  private readonly client: MongoClient;

  constructor(mongoUrl: string) {
    this.mongoUrl = mongoUrl;
    this.client = new MongoClient(mongoUrl);
  }

  async connect(): Promise<MongoClient> {
    return this.client.connect();
  }

  get(): MongoClient {
    return this.client;
  }

  db(name?: string) {
    return this.client.db(name);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class MongoTaskStore implements TaskStore {
  private readonly client: MongoClientLike;

  constructor(private readonly options: MongoTaskStoreOptions) {
    this.client = options.sharedClient ?? new MongoClient(options.mongoUrl);
  }

  private async collection() {
    await this.client.connect();
    return this.client.db(this.options.dbName).collection(this.options.collectionName);
  }

  async listDatabaseNames(): Promise<string[]> {
    await this.client.connect();
    const result = await this.client
      .db()
      .admin()
      .listDatabases();
    return result.databases.map((database) => database.name).sort((left, right) => left.localeCompare(right));
  }

  async listCollectionNames(): Promise<string[]> {
    await this.client.connect();
    const result = await this.client
      .db(this.options.dbName)
      .listCollections()
      .toArray();
    return result.map((collection) => collection.name).sort((left, right) => left.localeCompare(right));
  }

  async inspectCollection(): Promise<{
    documentCount: number;
    validTaskCount: number;
    skippedCount: number;
  }> {
    const collection = await this.collection();
    const items = await collection.find({}).toArray();
    const validTaskCount = collectValidTasks(items).length;
    return {
      documentCount: items.length,
      validTaskCount,
      skippedCount: items.length - validTaskCount
    };
  }

  async listTasks(filter?: { planCode?: string }): Promise<TaskRecord[]> {
    const collection = await this.collection();
    const query: Record<string, unknown> = {};
    if (filter?.planCode) {
      query.plan_code = filter.planCode;
    }
    const items = await collection.find(query).toArray();
    return collectValidTasks(items);
  }

  async getTask(codeOrId: string): Promise<TaskRecord | null> {
    const collection = await this.collection();
    const byCode = await collection.findOne({ code: codeOrId });
    if (byCode) {
      return normalizeTaskDocument(byCode as TaskDocumentInput);
    }

    if (ObjectId.isValid(codeOrId)) {
      const byId = await collection.findOne({ _id: new ObjectId(codeOrId) });
      return byId ? normalizeTaskDocument(byId as TaskDocumentInput) : null;
    }

    return null;
  }

  async ensureIndexes(): Promise<void> {
    const collection = await this.collection();
    await dropLegacyIndexes(collection, LEGACY_TASK_INDEX_NAMES);
    await collection.createIndexes([
      { key: { code: 1 }, name: "code_unique", unique: true, partialFilterExpression: { code: { $type: "string" } } },
      { key: { plan_code: 1 }, name: "plan_code_idx" },
      { key: { status: 1 }, name: "status_idx" }
    ]);
  }

  async upsertTasks(tasks: TaskDocumentInput[]): Promise<number> {
    if (tasks.length === 0) {
      return 0;
    }

    const collection = await this.collection();
    const now = new Date().toISOString();
    await collection.bulkWrite(
      tasks.map((task) => {
        const { _id: _ignored, ...fields } = task;
        const toSet: Record<string, unknown> = {};
        const toUnset: Record<string, 1> = {};

        for (const [key, value] of Object.entries(fields)) {
          if (value === null) {
            toUnset[key] = 1;
          } else if (value !== undefined) {
            toSet[key] = value;
          }
        }

        toSet.created_at ??= now;
        toSet.updated_at ??= now;

        return {
          updateOne: {
            filter: { code: task.code },
            update: (Object.keys(toUnset).length > 0 ? { $set: toSet, $unset: toUnset } : { $set: toSet }) as never,
            upsert: true
          }
        };
      }),
      { ordered: false }
    );
    return tasks.length;
  }

  async bulkUpdateTasks(codes: string[], patch: Record<string, unknown>): Promise<number> {
    if (codes.length === 0) return 0;
    const collection = await this.collection();
    const now = new Date().toISOString();
    const toSet: Record<string, unknown> = {};
    const toUnset: Record<string, 1> = {};

    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        toUnset[key] = 1;
      } else if (value !== undefined) {
        toSet[key] = value;
      }
    }

    toSet.updated_at ??= now;

    const update: Record<string, unknown> = Object.keys(toUnset).length > 0
      ? { $set: toSet, $unset: toUnset }
      : { $set: toSet };

    const result = await collection.updateMany({ code: { $in: codes } }, update as never);
    return result.modifiedCount;
  }

  async deleteTasks(codes: string[]): Promise<number> {
    if (codes.length === 0) return 0;
    const collection = await this.collection();
    const result = await collection.deleteMany({ code: { $in: codes } });
    return result.deletedCount;
  }

  async close(): Promise<void> {
    if (!this.options.sharedClient) {
      await this.client.close();
    }
  }
}

export class MongoActionPlanStore {
  private readonly client: MongoClientLike;

  constructor(private readonly options: MongoActionPlanStoreOptions) {
    this.client = options.sharedClient ?? new MongoClient(options.mongoUrl);
  }

  private async collection() {
    await this.client.connect();
    return this.client.db(this.options.dbName).collection(this.options.collectionName);
  }

  async listPlans(): Promise<ActionPlanRecord[]> {
    const collection = await this.collection();
    const items = await collection.find({}).toArray();
    return collectValidActionPlans(items);
  }

  async getPlan(codeOrId: string): Promise<ActionPlanRecord | null> {
    const collection = await this.collection();
    const byCode = await collection.findOne({ code: codeOrId });
    if (byCode) {
      return normalizeActionPlan(byCode as ActionPlanDocument);
    }

    if (ObjectId.isValid(codeOrId)) {
      const byId = await collection.findOne({ _id: new ObjectId(codeOrId) });
      return byId ? normalizeActionPlan(byId as ActionPlanDocument) : null;
    }

    return null;
  }

  async insertPlan(input: ActionPlanDocument): Promise<ActionPlanRecord> {
    const collection = await this.collection();
    const now = new Date().toISOString();
    const doc: ActionPlanDocument = {
      ...input,
      _id: undefined,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
    };
    await collection.insertOne(doc as never);
    const stored = await collection.findOne({ code: doc.code });
    if (!stored) {
      throw new Error(`Plan insert failed for code ${doc.code}`);
    }
    return normalizeActionPlan(stored as ActionPlanDocument);
  }

  async updatePlan(code: string, patch: Partial<ActionPlanDocument>): Promise<ActionPlanRecord | null> {
    const collection = await this.collection();
    const now = new Date().toISOString();
    const toSet: Record<string, unknown> = {};
    const toUnset: Record<string, 1> = {};

    for (const [key, value] of Object.entries(patch)) {
      if (key === "_id") continue;
      if (value === null) {
        toUnset[key] = 1;
      } else if (value !== undefined) {
        toSet[key] = value;
      }
    }

    toSet.updated_at ??= now;

    const update: Record<string, unknown> = Object.keys(toUnset).length > 0
      ? { $set: toSet, $unset: toUnset }
      : { $set: toSet };

    const result = await collection.updateOne({ code }, update as never);

    if (result.matchedCount === 0) return null;

    const updated = await collection.findOne({ code });
    return updated ? normalizeActionPlan(updated as ActionPlanDocument) : null;
  }

  async ensureIndexes(): Promise<void> {
    const collection = await this.collection();
    await collection.createIndexes([
      { key: { code: 1 }, name: "code_unique", unique: true },
      { key: { status: 1 }, name: "status_idx" }
    ]);
  }

  async close(): Promise<void> {
    if (!this.options.sharedClient) {
      await this.client.close();
    }
  }
}

export class MongoNoteStore implements NoteStore {
  private readonly client: MongoClientLike;

  constructor(private readonly options: MongoNoteStoreOptions) {
    this.client = options.sharedClient ?? new MongoClient(options.mongoUrl);
  }

  private async collection() {
    await this.client.connect();
    return this.client.db(this.options.dbName).collection(this.options.collectionName);
  }

  async listNotes(): Promise<NoteRecord[]> {
    const collection = await this.collection();
    const items = await collection
      .find({})
      .sort({ pinned: -1, updated_at: -1 })
      .toArray();
    return collectValidNotes(items);
  }

  async getNote(code: string): Promise<NoteRecord | null> {
    const collection = await this.collection();
    const note = await collection.findOne({ code: code.trim() });
    return note ? normalizeNote(note as NoteDocumentInput) : null;
  }

  async upsertNote(input: NoteDocumentInput): Promise<NoteRecord> {
    const collection = await this.collection();
    const normalized = normalizeNote(input);

    await collection.updateOne(
      { code: normalized.code },
      {
        $set: {
          code: normalized.code,
          title: normalized.title,
          body: normalized.body,
          tags: normalized.tags,
          task_code: normalized.taskCode ?? null,
          plan_code: normalized.planCode ?? null,
          pinned: normalized.pinned,
          remind_at: normalized.remindAt ?? null,
          reminded_at: normalized.remindedAt ?? null,
          created_at: normalized.createdAt,
          updated_at: normalized.updatedAt
        }
      },
      { upsert: true }
    );

    const stored = await collection.findOne({ code: normalized.code });
    if (!stored) {
      throw new Error(`Note upsert failed for code ${normalized.code}`);
    }

    return normalizeNote(stored as NoteDocumentInput);
  }

  async deleteNote(code: string): Promise<boolean> {
    const collection = await this.collection();
    const result = await collection.deleteOne({ code: code.trim() });
    return result.deletedCount > 0;
  }

  async ensureIndexes(): Promise<void> {
    const collection = await this.collection();
    await dropLegacyIndexes(collection, LEGACY_NOTE_INDEX_NAMES);
    await collection.createIndexes([
      { key: { code: 1 }, name: "code_unique", unique: true, partialFilterExpression: { code: { $type: "string" } } },
      { key: { task_code: 1 }, name: "task_code_idx" },
      { key: { plan_code: 1 }, name: "plan_code_idx" },
      { key: { remind_at: 1, reminded_at: 1 }, name: "reminder_due_idx" },
      { key: { updated_at: -1 }, name: "updated_at_desc_idx" }
    ]);
  }

  async close(): Promise<void> {
    if (!this.options.sharedClient) {
      await this.client.close();
    }
  }
}

export function createMongoTaskStore(options: MongoTaskStoreOptions): MongoTaskStore {
  return new MongoTaskStore(options);
}

export function createMongoActionPlanStore(options: MongoActionPlanStoreOptions): MongoActionPlanStore {
  return new MongoActionPlanStore(options);
}

export function createMongoNoteStore(options: MongoNoteStoreOptions): MongoNoteStore {
  return new MongoNoteStore(options);
}

export interface MongoAiAgentStoreOptions {
  mongoUrl: string;
  dbName: string;
  collectionName: string;
  sharedClient?: SharedMongoClient;
}

export class MongoAiAgentStore implements AiAgentStore {
  private readonly client: MongoClientLike;

  constructor(private readonly options: MongoAiAgentStoreOptions) {
    this.client = options.sharedClient ?? new MongoClient(options.mongoUrl);
  }

  private async collection() {
    await this.client.connect();
    return this.client.db(this.options.dbName).collection(this.options.collectionName);
  }

  async listAgents(): Promise<AiAgentRecord[]> {
    const collection = await this.collection();
    const items = await collection.find({}).toArray();
    return items.map((item) => normalizeAiAgentDocument(item as AiAgentDocument));
  }

  async findAgent(slug: string): Promise<AiAgentRecord | null> {
    const collection = await this.collection();
    const item = await collection.findOne({ slug });
    return item ? normalizeAiAgentDocument(item as AiAgentDocument) : null;
  }

  async ensureIndexes(): Promise<void> {
    const collection = await this.collection();
    await collection.createIndexes([
      { key: { slug: 1 }, name: "slug_unique", unique: true }
    ]);
  }

  async ensureSeeds(): Promise<void> {
    const { AI_AGENT_SEEDS } = await import("./ai-agents-seed.js");
    const collection = await this.collection();
    const count = await collection.countDocuments({});
    if (count > 0) return;

    const now = new Date().toISOString();
    await collection.insertMany(
      AI_AGENT_SEEDS.map((seed) => ({
        ...seed,
        created_at: now,
        updated_at: now
      })) as any[]
    );
  }

  async updateIcon(slug: string, iconPath: string): Promise<void> {
    const collection = await this.collection();
    await collection.updateOne(
      { slug },
      { $set: { icon_path: iconPath, updated_at: new Date().toISOString() } }
    );
  }

  async close(): Promise<void> {
    if (!this.options.sharedClient) {
      await this.client.close();
    }
  }
}

export function createMongoAiAgentStore(options: MongoAiAgentStoreOptions): MongoAiAgentStore {
  return new MongoAiAgentStore(options);
}

async function dropLegacyIndexes(collection: Collection, names: readonly string[]): Promise<void> {
  for (const name of names) {
    try {
      await collection.dropIndex(name);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        ("codeName" in error || "code" in error) &&
        ((error as { codeName?: string }).codeName === "IndexNotFound" || (error as { code?: number }).code === 26)
      ) {
        continue;
      }
      throw error;
    }
  }
}

function collectValidTasks(items: unknown[]): TaskRecord[] {
  const validTasks: TaskRecord[] = [];
  for (const item of items) {
    const record = item as TaskDocumentInput & Record<string, unknown>;
    const looksLikeTask =
      typeof record.code === "string" ||
      typeof record.short_task === "string" ||
      typeof record.shortTask === "string" ||
      typeof record.depends_on !== "undefined" ||
      typeof record.dependsOn !== "undefined";
    if (!looksLikeTask) {
      continue;
    }

    try {
      validTasks.push(normalizeTaskDocument(record));
    } catch {
      continue;
    }
  }
  return validTasks;
}

function collectValidActionPlans(items: unknown[]): ActionPlanRecord[] {
  const validPlans: ActionPlanRecord[] = [];
  for (const item of items) {
    const record = item as ActionPlanDocument & Record<string, unknown>;
    const looksLikePlan =
      typeof record.code === "string" ||
      typeof record.title === "string" ||
      typeof record.goal === "string" ||
      typeof record.current_task_code !== "undefined" ||
      typeof record.currentTaskCode !== "undefined";
    if (!looksLikePlan) {
      continue;
    }

    try {
      validPlans.push(normalizeActionPlan(record));
    } catch {
      continue;
    }
  }
  return validPlans;
}

function collectValidNotes(items: unknown[]): NoteRecord[] {
  const validNotes: NoteRecord[] = [];
  for (const item of items) {
    const record = item as NoteDocumentInput & Record<string, unknown>;
    const looksLikeNote =
      typeof record.code === "string" ||
      typeof record.title === "string" ||
      typeof record.task_code !== "undefined" ||
      typeof record.taskCode !== "undefined" ||
      typeof record.plan_code !== "undefined" ||
      typeof record.planCode !== "undefined";
    if (!looksLikeNote) {
      continue;
    }

    try {
      validNotes.push(normalizeNote(record));
    } catch {
      continue;
    }
  }
  return validNotes;
}

export interface AgentRunQuery {
  agentSlug?: string;
  status?: "running" | "completed" | "failed";
  limit?: number;
  beforeTimestamp?: string;
}

export async function ensureAiAgentRuns(
  db: import("mongodb").Db,
  collectionName?: string
): Promise<void> {
  const collection = db.collection(collectionName ?? "agent_runs");
  await collection.createIndexes([
    { key: { agent_slug: 1, started_at: -1 }, name: "agent_slug_started_at_desc" }
  ]);
}

export async function insertRun(
  db: import("mongodb").Db,
  doc: AgentRunDocument,
  collectionName?: string
): Promise<void> {
  const collection = db.collection(collectionName ?? "agent_runs");
  const now = new Date().toISOString();
  await collection.insertOne({
    ...doc,
    created_at: doc.created_at ?? now,
    updated_at: doc.updated_at ?? now
  } as any);
}

export async function updateRun(
  db: import("mongodb").Db,
  id: string,
  patch: Partial<AgentRunDocument>,
  collectionName?: string
): Promise<void> {
  const collection = db.collection(collectionName ?? "agent_runs");
  await collection.updateOne(
    { id },
    { $set: { ...patch, updated_at: new Date().toISOString() } }
  );
}

export async function queryRuns(
  db: import("mongodb").Db,
  query: AgentRunQuery,
  collectionName?: string
): Promise<AgentRunRecord[]> {
  const collection = db.collection(collectionName ?? "agent_runs");
  const filter: Record<string, unknown> = {};
  if (query.agentSlug) filter.agent_slug = query.agentSlug;
  if (query.status) filter.status = query.status;
  if (query.beforeTimestamp) filter.started_at = { $lt: query.beforeTimestamp };

  const items = await collection
    .find(filter)
    .sort({ started_at: -1 })
    .limit(query.limit ?? 50)
    .toArray();

  return items.map((item) => normalizeAgentRunDocument(item as AgentRunDocument));
}

export interface AgentStatsQuery {
  /** Filtra stats para un agente específico. */
  agentSlug?: string;
  /** Solo runs desde esta fecha (ISO). */
  from?: string;
  /** Solo runs hasta esta fecha (ISO). */
  to?: string;
}

export async function queryAgentStats(
  db: import("mongodb").Db,
  query?: AgentStatsQuery,
  collectionName?: string
): Promise<AgentStatsRecord[]> {
  const collection = db.collection(collectionName ?? "agent_runs");
  const match: Record<string, unknown> = {};
  if (query?.agentSlug) match.agent_slug = query.agentSlug;
  if (query?.from || query?.to) {
    const startedAt: Record<string, string> = {};
    if (query?.from) startedAt.$gte = query.from;
    if (query?.to) startedAt.$lte = query.to;
    match.started_at = startedAt;
  }

  const pipeline: import("mongodb").Document[] = [
    ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
    {
      $group: {
        _id: "$agent_slug",
        totalRuns: { $sum: 1 },
        completedRuns: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        failedRuns: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        runningRuns: { $sum: { $cond: [{ $eq: ["$status", "running"] }, 1, 0] } },
        totalTokensIn: { $sum: { $ifNull: ["$tokens_in", 0] } },
        totalTokensOut: { $sum: { $ifNull: ["$tokens_out", 0] } },
        totalCostUsd: { $sum: { $ifNull: ["$cost_usd", 0] } },
        firstRunAt: { $min: "$started_at" },
        lastRunAt: { $max: "$started_at" }
      }
    },
    { $sort: { totalRuns: -1 } },
    {
      $project: {
        _id: 0,
        agentSlug: "$_id",
        totalRuns: 1,
        completedRuns: 1,
        failedRuns: 1,
        runningRuns: 1,
        totalTokensIn: 1,
        totalTokensOut: 1,
        totalCostUsd: 1,
        firstRunAt: 1,
        lastRunAt: 1
      }
    }
  ];

  return collection.aggregate(pipeline).toArray() as Promise<AgentStatsRecord[]>;
}
