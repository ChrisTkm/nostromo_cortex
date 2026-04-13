import { MongoClient, ObjectId } from "mongodb";

import { normalizeTaskDocument } from "./schema.js";
import type { TaskDocumentInput, TaskRecord, TaskStore } from "./types.js";

export interface MongoTaskStoreOptions {
  mongoUrl: string;
  dbName: string;
  collectionName: string;
}

export class MongoTaskStore implements TaskStore {
  private readonly client: MongoClient;

  constructor(private readonly options: MongoTaskStoreOptions) {
    this.client = new MongoClient(options.mongoUrl);
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

  async upsertTasks(tasks: TaskDocumentInput[]): Promise<number> {
    const collection = await this.collection();
    let writes = 0;
    for (const task of tasks) {
      writes += 1;
      await collection.updateOne(
        { code: task.code },
        {
          $set: {
            ...task,
            updated_at: task.updated_at ?? new Date().toISOString(),
            created_at: task.created_at ?? new Date().toISOString()
          }
        },
        { upsert: true }
      );
    }
    return writes;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createMongoTaskStore(options: MongoTaskStoreOptions): MongoTaskStore {
  return new MongoTaskStore(options);
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
