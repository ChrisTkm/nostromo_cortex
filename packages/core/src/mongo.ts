import { MongoClient, ObjectId } from "mongodb";

import { normalizeActionPlan, normalizeNote, normalizeTaskDocument } from "./schema.js";
import type {
  ActionPlanDocument,
  ActionPlanRecord,
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

  async listTasks(): Promise<TaskRecord[]> {
    const collection = await this.collection();
    const items = await collection.find({}).toArray();
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
    await collection.createIndexes([
      { key: { code: 1 }, name: "code_unique", unique: true },
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
      tasks.map((task) => ({
        updateOne: {
          filter: { code: task.code },
          update: {
            $set: {
              ...task,
              created_at: task.created_at ?? now,
              updated_at: task.updated_at ?? now
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );
    return tasks.length;
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
    await collection.createIndexes([
      { key: { code: 1 }, name: "code_unique", unique: true },
      { key: { task_code: 1 }, name: "task_code_idx" },
      { key: { plan_code: 1 }, name: "plan_code_idx" },
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
