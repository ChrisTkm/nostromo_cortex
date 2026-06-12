import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskEnsureIndexes,
  taskClose,
  taskListTasks,
  taskGetTask,
  taskBulkUpdateTasks,
  taskDeleteTasks,
  planEnsureIndexes,
  planClose,
  planGetPlan,
  planUpdatePlan,
  planDeletePlan,
  noteEnsureIndexes,
  noteClose,
  noteListNotes,
  noteGetNote,
  noteUpsertNote,
  noteDeleteNote,
  agentEnsureIndexes,
  agentEnsureSeeds,
  agentClose,
  createMongoTaskStoreMock,
  createMongoActionPlanStoreMock,
  createMongoNoteStoreMock,
  createMongoAiAgentStoreMock,
  createLoggerMock,
  jsonlTelemetryStoreMock,
  telemetryRecorderMock,
  sharedConnect,
  sharedDb,
  sharedClose,
  logsCreateIndexes,
  secretGet,
  secretStore,
  secretDelete,
  createDirectory,
  getConfig,
  updateConfig,
  telemetryInitialize,
  sharedGet,
  fsMkdir,
  fsWriteFile,
} = vi.hoisted(() => {
  const taskEnsureIndexes = vi.fn();
  const taskClose = vi.fn();
  const taskListTasks = vi.fn();
  const taskGetTask = vi.fn();
  const taskBulkUpdateTasks = vi.fn();
  const taskDeleteTasks = vi.fn();
  const planEnsureIndexes = vi.fn();
  const planClose = vi.fn();
  const planGetPlan = vi.fn();
  const planUpdatePlan = vi.fn();
  const planDeletePlan = vi.fn();
  const noteEnsureIndexes = vi.fn();
  const noteClose = vi.fn();
  const noteListNotes = vi.fn();
  const noteGetNote = vi.fn();
  const noteUpsertNote = vi.fn();
  const noteDeleteNote = vi.fn();
  const agentEnsureIndexes = vi.fn();
  const agentEnsureSeeds = vi.fn();
  const agentClose = vi.fn();
  return {
    taskEnsureIndexes,
    taskClose,
    taskListTasks,
    taskGetTask,
    taskBulkUpdateTasks,
    taskDeleteTasks,
    planEnsureIndexes,
    planClose,
    planGetPlan,
    planUpdatePlan,
    planDeletePlan,
    noteEnsureIndexes,
    noteClose,
    noteListNotes,
    noteGetNote,
    noteUpsertNote,
    noteDeleteNote,
    agentEnsureIndexes,
    agentEnsureSeeds,
    agentClose,
    createMongoTaskStoreMock: vi.fn(() => ({
      ensureIndexes: taskEnsureIndexes,
      listTasks: taskListTasks,
      getTask: taskGetTask,
      bulkUpdateTasks: taskBulkUpdateTasks,
      deleteTasks: taskDeleteTasks,
      close: taskClose,
    })),
    createMongoActionPlanStoreMock: vi.fn(() => ({
      ensureIndexes: planEnsureIndexes,
      getPlan: planGetPlan,
      updatePlan: planUpdatePlan,
      deletePlan: planDeletePlan,
      close: planClose
    })),
    createMongoNoteStoreMock: vi.fn(() => ({
      ensureIndexes: noteEnsureIndexes,
      listNotes: noteListNotes,
      getNote: noteGetNote,
      upsertNote: noteUpsertNote,
      deleteNote: noteDeleteNote,
      close: noteClose,
    })),
    createMongoAiAgentStoreMock: vi.fn(() => ({
      ensureIndexes: agentEnsureIndexes,
      ensureSeeds: agentEnsureSeeds,
      close: agentClose,
    })),
    createLoggerMock: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    jsonlTelemetryStoreMock: vi.fn().mockImplementation(() => ({})),
    telemetryRecorderMock: vi.fn().mockImplementation(() => ({
      initialize: telemetryInitialize,
      startRun: vi.fn(),
    })),
    logsCreateIndexes: vi.fn(),
    secretGet: vi.fn(),
    secretStore: vi.fn(),
    secretDelete: vi.fn(),
    sharedConnect: vi.fn(),
    sharedDb: vi.fn(),
    sharedClose: vi.fn(),
    createDirectory: vi.fn(),
    getConfig: vi.fn((_: string, fallback?: string) => fallback),
    updateConfig: vi.fn(),
    telemetryInitialize: vi.fn(),
    sharedGet: vi.fn(),
    fsMkdir: vi.fn(),
    fsWriteFile: vi.fn(),
  };
});

vi.mock("@cortex/core", async () => {
  const actual =
    await vi.importActual<typeof import("@cortex/core")>("@cortex/core");
  return {
    ...actual,
    SharedMongoClient: class FakeSharedMongoClient {
      readonly mongoUrl: string;

      constructor(mongoUrl: string) {
        this.mongoUrl = mongoUrl;
      }

      connect = sharedConnect;
      db = sharedDb;
      close = sharedClose;
      get = sharedGet;
    },
    createMongoTaskStore: createMongoTaskStoreMock,
    createMongoActionPlanStore: createMongoActionPlanStoreMock,
    createMongoNoteStore: createMongoNoteStoreMock,
    createMongoAiAgentStore: createMongoAiAgentStoreMock,
    loadConfig: vi.fn(() => ({
      logLevel: "info",
      logFormat: "pretty",
    })),
  };
});

vi.mock("vscode", () => ({
  workspace: {
    fs: {
      createDirectory,
    },
    getConfiguration: vi.fn(() => ({
      get: getConfig,
      update: updateConfig,
    })),
  },
  ConfigurationTarget: {
    Workspace: 1,
  },
  env: {
    sessionId: "session-id",
  },
}));

vi.mock("@cortex/telemetry", () => ({
  createLogger: createLoggerMock,
  JsonlTelemetryStore: jsonlTelemetryStoreMock,
  TelemetryRecorder: telemetryRecorderMock,
}));

vi.mock("node:fs/promises", () => ({
  default: { mkdir: fsMkdir, writeFile: fsWriteFile },
  mkdir: fsMkdir,
  writeFile: fsWriteFile,
}));

import {
  ExtensionTaskService,
  webviewPlanPatchToDocumentPatch,
} from "./service.js";
import type { TaskRecord } from "@cortex/core";
import type { Document } from "mongodb";

describe("ExtensionTaskService.initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    logsCreateIndexes.mockResolvedValue([
      "logs_source_timestamp",
      "logs_level_timestamp",
      "logs_process_timestamp",
    ]);
    sharedDb.mockImplementation(() => ({
      collection: vi.fn(() => ({
        createIndexes: logsCreateIndexes,
      })),
    }));
    sharedClose.mockResolvedValue(undefined);
    secretGet.mockResolvedValue(undefined);
    secretStore.mockResolvedValue(undefined);
    secretDelete.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
    noteEnsureIndexes.mockResolvedValue(undefined);
    noteClose.mockResolvedValue(undefined);
    noteListNotes.mockResolvedValue([]);
    noteGetNote.mockResolvedValue(null);
    noteUpsertNote.mockResolvedValue({
      code: "N-1",
      title: "Note 1",
      body: "",
      tags: [],
      pinned: false,
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    });
    noteDeleteNote.mockResolvedValue(true);
  });

  it("connects the shared client and ensures task, plan, and note indexes", async () => {
    const service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: secretGet,
        store: secretStore,
        delete: secretDelete,
      },
    } as never);

    await service.initialize();

    expect(createLoggerMock).toHaveBeenCalledTimes(1);
    expect(jsonlTelemetryStoreMock).toHaveBeenCalledTimes(1);
    expect(telemetryRecorderMock).toHaveBeenCalledTimes(1);
    expect(sharedConnect).toHaveBeenCalledTimes(1);
    expect(createMongoTaskStoreMock).toHaveBeenCalledTimes(1);
    expect(createMongoActionPlanStoreMock).toHaveBeenCalledTimes(1);
    expect(createMongoNoteStoreMock).toHaveBeenCalledTimes(1);
    expect(taskEnsureIndexes).toHaveBeenCalledTimes(1);
    expect(planEnsureIndexes).toHaveBeenCalledTimes(1);
    expect(noteEnsureIndexes).toHaveBeenCalledTimes(1);
    expect(agentEnsureIndexes).toHaveBeenCalledTimes(1);
    expect(agentEnsureSeeds).toHaveBeenCalledTimes(1);
    expect(agentClose).toHaveBeenCalledTimes(1);
    expect(logsCreateIndexes).toHaveBeenCalledTimes(2);

    const [taskOptions] = createMongoTaskStoreMock.mock.calls[0] ?? [];
    const [planOptions] = createMongoActionPlanStoreMock.mock.calls[0] ?? [];
    const [noteOptions] = createMongoNoteStoreMock.mock.calls[0] ?? [];
    expect(taskOptions.sharedClient).toBe(planOptions.sharedClient);
    expect(taskOptions.sharedClient).toBe(noteOptions.sharedClient);
    expect(noteOptions.collectionName).toBe("notes");
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(
      taskEnsureIndexes.mock.invocationCallOrder[0],
    );
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(
      planEnsureIndexes.mock.invocationCallOrder[0],
    );
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(
      noteEnsureIndexes.mock.invocationCallOrder[0],
    );
  });

  it("delegates note operations and propagates mongoNotesCollection updates", async () => {
    getConfig.mockImplementation((key: string, fallback?: string) => {
      if (key === "mongoNotesCollection") {
        return "notes_custom";
      }
      return fallback;
    });

    const service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: secretGet,
        store: secretStore,
        delete: secretDelete,
      },
    } as never);

    await service.initialize();

    expect(service.getConnectionSettings()).toMatchObject({
      mongoNotesCollection: "notes_custom",
    });

    await service.listNotes();
    await service.getNote("N-1");
    await service.saveNote({ code: "N-1", title: "Note 1", body: "Body" });
    await service.deleteNote("N-1");

    expect(noteListNotes).toHaveBeenCalledTimes(1);
    expect(noteGetNote).toHaveBeenCalledWith("N-1");
    expect(noteUpsertNote).toHaveBeenCalledWith({
      code: "N-1",
      title: "Note 1",
      body: "Body",
    });
    expect(noteDeleteNote).toHaveBeenCalledWith("N-1");

    await service.updateConnectionSettings({
      mongoNotesCollection: "notes_v2",
    });

    expect(updateConfig).toHaveBeenCalledWith(
      "mongoNotesCollection",
      "notes_v2",
      1,
    );
    expect(createMongoNoteStoreMock).toHaveBeenCalledTimes(2);
    const [updatedNoteOptions] = createMongoNoteStoreMock.mock.calls[1] ?? [];
    expect(updatedNoteOptions.collectionName).toBe("notes_v2");
  });
});

describe("ExtensionTaskService.isJsonPathInArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    logsCreateIndexes.mockResolvedValue(["logs_source_timestamp"]);
    sharedDb.mockImplementation(() => ({
      collection: vi.fn(() => ({
        createIndexes: logsCreateIndexes,
      })),
    }));
    sharedClose.mockResolvedValue(undefined);
    secretGet.mockResolvedValue(undefined);
    secretStore.mockResolvedValue(undefined);
    secretDelete.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
    noteEnsureIndexes.mockResolvedValue(undefined);
    noteClose.mockResolvedValue(undefined);
  });

  function makeService() {
    getConfig.mockImplementation((key: string, fallback?: string) => {
      if (key === "archivePath") return "C:\\cortex-archive";
      return fallback;
    });
    return new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: { get: vi.fn(), update: vi.fn() },
      secrets: { get: secretGet, store: secretStore, delete: secretDelete },
    } as never);
  }

  it("accepts a path inside <archiveRoot>/plans", async () => {
    const service = makeService();
    await service.initialize();
    expect(
      service.isJsonPathInArchive("C:\\cortex-archive\\plans\\S-1.json"),
    ).toBe(true);
  });

  it("rejects a traversal like ../../../etc/passwd", async () => {
    const service = makeService();
    await service.initialize();
    expect(service.isJsonPathInArchive("../../../etc/passwd.json")).toBe(false);
  });

  it("rejects a non-.json file", async () => {
    const service = makeService();
    await service.initialize();
    expect(
      service.isJsonPathInArchive("C:\\cortex-archive\\plans\\readme.txt"),
    ).toBe(false);
  });

  it("rejects empty/whitespace input", async () => {
    const service = makeService();
    await service.initialize();
    expect(service.isJsonPathInArchive("")).toBe(false);
    expect(service.isJsonPathInArchive("   ")).toBe(false);
  });
});

import type { Document } from "mongodb";

function fakeCollection(initial: Document[] = []) {
  const box = { docs: [...initial] };
  return {
    get docs() {
      return box.docs;
    },
    set docs(val: Document[]) {
      box.docs = val;
    },
    find: vi.fn((filter: Document = {}) => ({
      sort: vi.fn(() => ({
        toArray: vi.fn(async () => filterDocs(box.docs, filter)),
      })),
      toArray: vi.fn(async () => filterDocs(box.docs, filter)),
    })),
    findOne: vi.fn(
      async (filter: Document) => filterDocs(box.docs, filter)[0] ?? null,
    ),
    deleteMany: vi.fn(async (filter: Document) => {
      const before = box.docs.length;
      box.docs = box.docs.filter((d) => !matchFilter(d, filter));
      return { deletedCount: before - box.docs.length };
    }),
    deleteOne: vi.fn(async (filter: Document) => {
      const idx = box.docs.findIndex((d) => matchFilter(d, filter));
      if (idx >= 0) {
        box.docs.splice(idx, 1);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    }),
    replaceOne: vi.fn(async (filter: Document, doc: Document) => {
      const idx = box.docs.findIndex((d) => matchFilter(d, filter));
      if (idx >= 0) {
        box.docs[idx] = doc;
      } else {
        box.docs.push(doc);
      }
      return {
        upsertedCount: idx < 0 ? 1 : 0,
        modifiedCount: idx >= 0 ? 1 : 0,
      };
    }),
    createIndexes: vi.fn(async () => []),
  };
}

function filterDocs(docs: Document[], filter: Document): Document[] {
  return docs.filter((d) => matchFilter(d, filter));
}

function matchFilter(doc: Document, filter: Document): boolean {
  if ("$or" in filter) {
    return (filter.$or as Document[]).some((sub) => matchFilter(doc, sub));
  }
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$in" in value) {
      return (value.$in as unknown[]).includes(doc[key]);
    }
    return doc[key] === value;
  });
}

describe("ExtensionTaskService.archivePlan", () => {
  const collections: Record<string, ReturnType<typeof fakeCollection>> = {};
  let service: ExtensionTaskService;
  let fakeSession: {
    withTransaction: ReturnType<typeof vi.fn>;
    endSession: ReturnType<typeof vi.fn>;
  };
  let loggerWarn: ReturnType<typeof vi.fn>;

  function getCol(name: string) {
    if (!collections[name]) {
      collections[name] = fakeCollection();
    }
    return collections[name];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(collections).forEach((k) => delete collections[k]);

    fakeSession = {
      withTransaction: vi.fn(async (fn: () => Promise<void>) => fn()),
      endSession: vi.fn(async () => undefined),
    };
    sharedGet.mockReturnValue({ startSession: vi.fn(() => fakeSession) });

    sharedDb.mockImplementation(() => ({
      collection: (name: string) => getCol(name),
    }));

    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    sharedClose.mockResolvedValue(undefined);
    secretGet.mockResolvedValue("mongodb://127.0.0.1:27017");
    secretStore.mockResolvedValue(undefined);
    secretDelete.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    noteEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
    noteClose.mockResolvedValue(undefined);
    noteListNotes.mockResolvedValue([]);
    noteGetNote.mockResolvedValue(null);
    logsCreateIndexes.mockResolvedValue(["logs_source_timestamp"]);
    fsMkdir.mockResolvedValue(undefined);
    fsWriteFile.mockResolvedValue(undefined);

    getConfig.mockImplementation((key: string, fallback?: string) => {
      if (key === "archivePath") return "C:\\cortex-archive";
      return fallback;
    });

    service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: { get: vi.fn(), update: vi.fn() },
      secrets: { get: secretGet, store: secretStore, delete: secretDelete },
    } as never);

    await service.initialize();

    loggerWarn = (
      createLoggerMock.mock.results[0].value as {
        warn: ReturnType<typeof vi.fn>;
      }
    ).warn;
  });

  it("archives a DONE plan moving plan/tasks/notes to archived_* collections (happy path)", async () => {
    getCol("action_plans").docs = [
      { _id: 1, code: "P1", status: "DONE", title: "Plan 1" },
    ];
    getCol("tasks").docs = [
      { _id: 2, code: "P1-T1", plan_code: "P1", short_task: "Task 1" },
      { _id: 3, code: "P1-T2", plan_code: "P1", short_task: "Task 2" },
    ];
    getCol("notes").docs = [
      { _id: 4, code: "N1", plan_code: "P1", title: "Note 1", body: "" },
    ];

    const result = await service.archivePlan("P1");

    expect(result).toMatchObject({
      planCode: "P1",
      taskCount: 2,
      noteCount: 1,
    });
    expect(result.jsonPath).toContain("P1.json");

    expect(getCol("archived_plans").docs).toHaveLength(1);
    expect(getCol("archived_plans").docs[0]).toMatchObject({
      code: "P1",
      status: "DONE",
    });
    expect(getCol("archived_plans").docs[0].archived_at).toBeDefined();
    expect(getCol("archived_plans").docs[0].json_path).toBeDefined();

    expect(getCol("action_plans").docs).toHaveLength(0);
    expect(getCol("archived_tasks").docs).toHaveLength(2);
    expect(getCol("archived_notes").docs).toHaveLength(1);
    expect(getCol("tasks").docs).toHaveLength(0);
    expect(getCol("notes").docs).toHaveLength(0);

    expect(fsWriteFile).toHaveBeenCalledTimes(1);
  });

  it("falls back to ordered writes when withTransaction throws and logs a warn", async () => {
    getCol("action_plans").docs = [
      { _id: 1, code: "P1", status: "DONE", title: "Plan 1" },
    ];
    getCol("tasks").docs = [{ _id: 2, code: "P1-T1", plan_code: "P1" }];
    getCol("notes").docs = [];

    fakeSession.withTransaction.mockRejectedValueOnce(
      new Error("replica set required"),
    );

    await service.archivePlan("P1");

    expect(loggerWarn).toHaveBeenCalledWith(
      "archivePlan transaction failed; falling back to ordered writes",
      expect.objectContaining({ planCode: "P1" }),
    );

    expect(getCol("archived_plans").docs).toHaveLength(1);
    expect(getCol("action_plans").docs).toHaveLength(0);
  });

  it("writes the JSON snapshot with archived_at + plan + tasks + notes + logs", async () => {
    getCol("action_plans").docs = [
      { _id: 1, code: "P1", status: "DONE", title: "Plan 1" },
    ];
    getCol("tasks").docs = [{ _id: 2, code: "P1-T1", plan_code: "P1" }];
    getCol("notes").docs = [
      { _id: 3, code: "N1", plan_code: "P1", title: "Note 1", body: "" },
    ];
    getCol("logs").docs = [
      {
        _id: 4,
        plan_code: "P1",
        timestamp: "2026-01-01T00:00:00Z",
        message: "Log 1",
      },
    ];

    await service.archivePlan("P1");

    expect(fsWriteFile).toHaveBeenCalledTimes(1);
    const jsonArg = fsWriteFile.mock.calls[0][1] as string;
    const snapshot = JSON.parse(jsonArg);

    expect(snapshot).toHaveProperty("archived_at");
    expect(snapshot).toHaveProperty("plan");
    expect(snapshot).toHaveProperty("tasks");
    expect(snapshot).toHaveProperty("notes");
    expect(snapshot).toHaveProperty("logs");
    expect(snapshot.logs).toHaveLength(1);
    expect(snapshot.logs[0].plan_code).toBe("P1");
    expect(snapshot.plan.code).toBe("P1");
  });

  it("logs a warn when deleteMany count mismatches but does not throw", async () => {
    getCol("action_plans").docs = [
      { _id: 1, code: "P1", status: "DONE", title: "Plan 1" },
    ];
    getCol("tasks").docs = [
      { _id: 2, code: "P1-T1", plan_code: "P1" },
      { _id: 3, code: "P1-T2", plan_code: "P1" },
    ];
    getCol("notes").docs = [];

    getCol("tasks").deleteMany.mockResolvedValue({ deletedCount: 1 });

    await service.archivePlan("P1");

    expect(loggerWarn).toHaveBeenCalledWith(
      "archivePlan delete count mismatch",
      expect.objectContaining({
        expectedTasks: 2,
        deletedTasks: 1,
      }),
    );
  });
});

describe("ExtensionTaskService.listArchivedPlans", () => {
  const collections: Record<string, ReturnType<typeof fakeCollection>> = {};
  let service: ExtensionTaskService;

  function getCol(name: string) {
    if (!collections[name]) {
      collections[name] = fakeCollection();
    }
    return collections[name];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(collections).forEach((k) => delete collections[k]);

    sharedGet.mockReturnValue({ startSession: vi.fn() });

    sharedDb.mockImplementation(() => ({
      collection: (name: string) => getCol(name),
    }));

    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    sharedClose.mockResolvedValue(undefined);
    secretGet.mockResolvedValue("mongodb://127.0.0.1:27017");
    secretStore.mockResolvedValue(undefined);
    secretDelete.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    noteEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
    noteClose.mockResolvedValue(undefined);
    noteListNotes.mockResolvedValue([]);
    noteGetNote.mockResolvedValue(null);
    logsCreateIndexes.mockResolvedValue(["logs_source_timestamp"]);
    fsMkdir.mockResolvedValue(undefined);
    fsWriteFile.mockResolvedValue(undefined);

    getConfig.mockImplementation((key: string, fallback?: string) => {
      if (key === "archivePath") return "C:\\cortex-archive";
      return fallback;
    });

    service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: { get: vi.fn(), update: vi.fn() },
      secrets: { get: secretGet, store: secretStore, delete: secretDelete },
    } as never);

    await service.initialize();
  });

  it("joins archived plans with their archived tasks and notes by plan_code", async () => {
    getCol("archived_plans").docs = [
      { _id: 1, code: "P1", title: "Plan 1" },
      { _id: 2, code: "P2", title: "Plan 2" },
    ];
    getCol("archived_tasks").docs = [
      {
        _id: 3,
        code: "P1-T1",
        plan_code: "P1",
        short_task: "Task 1",
        completed_at: "2026-01-01T00:00:00Z",
      },
      {
        _id: 4,
        code: "P1-T2",
        plan_code: "P1",
        short_task: "Task 2",
        completed_at: "2026-01-02T00:00:00Z",
      },
      {
        _id: 5,
        code: "P2-T1",
        plan_code: "P2",
        short_task: "Task 3",
        completed_at: "2026-01-03T00:00:00Z",
      },
    ];
    getCol("archived_notes").docs = [
      { _id: 6, title: "Note 1", plan_code: "P1", body: "" },
      { _id: 7, title: "Note 2", task_code: "P1-T1", body: "" },
      { _id: 8, title: "Note 3", task_code: "P2-T1", body: "" },
    ];

    const result = await service.listArchivedPlans();

    expect(result).toHaveLength(2);

    const p1 = result.find((p) => p.code === "P1")!;
    expect(p1).toBeDefined();
    expect(p1.tasks).toHaveLength(2);
    expect(p1.tasks.map((t) => t.code)).toEqual(["P1-T1", "P1-T2"]);
    expect(p1.notes).toHaveLength(2);
    expect(p1.notes.map((n) => n.title)).toEqual(["Note 1", "Note 2"]);

    const p2 = result.find((p) => p.code === "P2")!;
    expect(p2).toBeDefined();
    expect(p2.tasks).toHaveLength(1);
    expect(p2.tasks.map((t) => t.code)).toEqual(["P2-T1"]);
    expect(p2.notes).toHaveLength(1);
    expect(p2.notes.map((n) => n.title)).toEqual(["Note 3"]);
  });

  it("sorts results by archivedAt descending, falling back to completedAt", async () => {
    getCol("archived_plans").docs = [
      { _id: 1, code: "P1", title: "Old", archived_at: "2026-01-01T00:00:00Z" },
      { _id: 2, code: "P2", title: "Mid", archived_at: "2026-01-15T00:00:00Z" },
      { _id: 3, code: "P3", title: "New", archived_at: "2026-02-01T00:00:00Z" },
    ];
    getCol("archived_tasks").docs = [];
    getCol("archived_notes").docs = [];

    const result = await service.listArchivedPlans();

    expect(result).toHaveLength(3);
    expect(result[0].code).toBe("P3");
    expect(result[1].code).toBe("P2");
    expect(result[2].code).toBe("P1");
  });

  it("falls back to completedAt when archivedAt is missing for sorting", async () => {
    getCol("archived_plans").docs = [
      {
        _id: 1,
        code: "P1",
        title: "Old",
        completed_at: "2026-01-01T00:00:00Z",
      },
      { _id: 2, code: "P2", title: "Mid", archived_at: "2026-01-15T00:00:00Z" },
      { _id: 3, code: "P3", title: "New", archived_at: "2026-02-01T00:00:00Z" },
    ];
    getCol("archived_tasks").docs = [];
    getCol("archived_notes").docs = [];

    const result = await service.listArchivedPlans();

    expect(result).toHaveLength(3);
    expect(result[0].code).toBe("P3");
    expect(result[1].code).toBe("P2");
    expect(result[2].code).toBe("P1");
  });
});

describe("ExtensionTaskService plan task bulk operations", () => {
  let service: ExtensionTaskService;

  beforeEach(async () => {
    vi.clearAllMocks();
    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    logsCreateIndexes.mockResolvedValue(["logs_source_timestamp"]);
    sharedDb.mockImplementation(() => ({
      collection: vi.fn(() => ({
        createIndexes: logsCreateIndexes,
      })),
    }));
    sharedClose.mockResolvedValue(undefined);
    secretGet.mockResolvedValue(undefined);
    secretStore.mockResolvedValue(undefined);
    secretDelete.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
    noteEnsureIndexes.mockResolvedValue(undefined);
    noteClose.mockResolvedValue(undefined);
    noteListNotes.mockResolvedValue([]);
    noteGetNote.mockResolvedValue(null);

    service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: { get: vi.fn(), update: vi.fn() },
      secrets: { get: secretGet, store: secretStore, delete: secretDelete },
    } as never);

    await service.initialize();
  });

  it("loadPlanTasks calls store.listTasks with planCode filter", async () => {
    taskListTasks.mockResolvedValue([
      { code: "T1", shortTask: "Task 1", status: "PENDING" } as TaskRecord,
      { code: "T2", shortTask: "Task 2", status: "DONE" } as TaskRecord,
    ]);

    const result = await service.loadPlanTasks("P1");

    expect(taskListTasks).toHaveBeenCalledWith({ planCode: "P1" });
    expect(result).toHaveLength(2);
  });

  it("recalcPlanProgress counts tasks by status and updates plan progress", async () => {
    taskListTasks.mockResolvedValue([
      { code: "T1", status: "PENDING" } as TaskRecord,
      { code: "T2", status: "IN_PROGRESS" } as TaskRecord,
      { code: "T3", status: "BLOCKED" } as TaskRecord,
      { code: "T4", status: "DONE" } as TaskRecord,
      { code: "T5", status: "FAILED" } as TaskRecord,
    ]);
    planUpdatePlan.mockResolvedValue({
      code: "P1",
      progress: {
        total: 5,
        pending: 1,
        in_progress: 1,
        blocked: 1,
        done: 1,
        failed: 1,
      },
    } as never);

    const result = await service.recalcPlanProgress("P1");

    expect(planUpdatePlan).toHaveBeenCalledWith(
      "P1",
      expect.objectContaining({
        progress: {
          total: 5,
          pending: 1,
          in_progress: 1,
          blocked: 1,
          done: 1,
          failed: 1,
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        progress: expect.objectContaining({ total: 5 }),
      }),
    );
  });

  it("bulkUpdateTaskStatus sets completed_at for DONE and unsets for other status", async () => {
    taskBulkUpdateTasks.mockResolvedValue(2);
    taskListTasks.mockResolvedValue([]);
    planUpdatePlan.mockResolvedValue({ code: "P1" } as never);

    await service.bulkUpdateTaskStatus("P1", ["T1", "T2"], "DONE");

    expect(taskBulkUpdateTasks).toHaveBeenCalledTimes(1);
    const [codes, patch] = taskBulkUpdateTasks.mock.calls[0] as [
      string[],
      Record<string, unknown>,
    ];
    expect(codes).toEqual(["T1", "T2"]);
    expect(patch).toMatchObject({ status: "DONE" });
    expect(patch.completed_at).toEqual(expect.any(String));
    expect(planUpdatePlan).toHaveBeenCalledWith("P1", expect.anything());

    vi.clearAllMocks();
    taskBulkUpdateTasks.mockClear();
    taskBulkUpdateTasks.mockResolvedValue(2);
    taskListTasks.mockResolvedValue([]);
    planUpdatePlan.mockResolvedValue({ code: "P1" } as never);

    await service.bulkUpdateTaskStatus("P1", ["T3"], "IN_PROGRESS");

    const [, patch2] = taskBulkUpdateTasks.mock.calls[0] as [
      string[],
      Record<string, unknown>,
    ];
    expect(patch2).toMatchObject({ status: "IN_PROGRESS" });
    expect(patch2.completed_at).toBeNull();
  });

  it("bulkUpdateTaskAgent updates agent and recalculates progress", async () => {
    taskBulkUpdateTasks.mockResolvedValue(2);
    taskListTasks.mockResolvedValue([]);
    planUpdatePlan.mockResolvedValue({ code: "P1" } as never);

    await service.bulkUpdateTaskAgent("P1", ["T1", "T2"], "nomad");

    expect(taskBulkUpdateTasks).toHaveBeenCalledWith(["T1", "T2"], {
      agent: "nomad",
    });
    expect(planUpdatePlan).toHaveBeenCalledWith("P1", expect.anything());
  });

  it("bulkDeleteTasks calls store.deleteTasks and recalculates progress", async () => {
    taskDeleteTasks.mockResolvedValue(2);
    taskListTasks.mockResolvedValue([]);
    planUpdatePlan.mockResolvedValue({ code: "P1" } as never);

    await service.bulkDeleteTasks("P1", ["T1", "T2"]);

    expect(taskDeleteTasks).toHaveBeenCalledWith(["T1", "T2"]);
    expect(planUpdatePlan).toHaveBeenCalledWith("P1", expect.anything());
  });

  it("bulkMoveTasksToPlan validates target, updates plan_code and recalculates source + target", async () => {
    taskGetTask.mockImplementation(async (code: string) => {
      if (code === "T1")
        return { code: "T1", planCode: "P1", status: "PENDING" } as TaskRecord;
      if (code === "T2")
        return { code: "T2", planCode: "P1", status: "DONE" } as TaskRecord;
      return null;
    });
    planGetPlan.mockResolvedValue({
      code: "P2",
      title: "Target",
      project: "cortex2",
    } as never);
    taskBulkUpdateTasks.mockResolvedValue(1);
    taskListTasks.mockResolvedValue([]);
    planUpdatePlan.mockResolvedValue({} as never);

    await service.bulkMoveTasksToPlan(["T1", "T2"], "P2");

    expect(planGetPlan).toHaveBeenCalledWith("P2");
    expect(taskBulkUpdateTasks).toHaveBeenCalledWith(["T1", "T2"], {
      plan_code: "P2",
      project: "cortex2",
    });
    // recalc llamado para source (P1) y target (P2)
    expect(planUpdatePlan).toHaveBeenCalledWith("P1", expect.anything());
    expect(planUpdatePlan).toHaveBeenCalledWith("P2", expect.anything());
  });

  it("bulkMoveTasksToPlan throws when target plan not found", async () => {
    planGetPlan.mockResolvedValue(null);

    await expect(
      service.bulkMoveTasksToPlan(["T1"], "MISSING"),
    ).rejects.toThrow("Target plan MISSING not found");
  });
});

describe("webviewPlanPatchToDocumentPatch", () => {
  it("maps assignedAgent to assigned_agent preserving the rest", () => {
    const patch = webviewPlanPatchToDocumentPatch({
      title: "T",
      assignedAgent: "big-pickle",
      tags: ["a"],
    });

    expect(patch).toEqual({
      title: "T",
      assigned_agent: "big-pickle",
      tags: ["a"],
    });
    expect(patch).not.toHaveProperty("assignedAgent");
  });

  it("preserves null assignedAgent so updatePlan can $unset it", () => {
    const patch = webviewPlanPatchToDocumentPatch({ assignedAgent: null });

    expect(patch).toEqual({ assigned_agent: null });
  });

  it("omits assigned_agent entirely when the webview did not send it", () => {
    const patch = webviewPlanPatchToDocumentPatch({ title: "T" });

    expect(patch).toEqual({ title: "T" });
  });
});

describe("ExtensionTaskService.deletePlanWithTasks", () => {
  let service: ExtensionTaskService;

  beforeEach(async () => {
    vi.clearAllMocks();
    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    logsCreateIndexes.mockResolvedValue(["logs_source_timestamp"]);
    sharedDb.mockImplementation(() => ({
      collection: vi.fn(() => ({ createIndexes: logsCreateIndexes })),
    }));
    sharedClose.mockResolvedValue(undefined);
    secretGet.mockResolvedValue(undefined);
    secretStore.mockResolvedValue(undefined);
    secretDelete.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
    noteEnsureIndexes.mockResolvedValue(undefined);
    noteClose.mockResolvedValue(undefined);
    noteListNotes.mockResolvedValue([]);
    noteGetNote.mockResolvedValue(null);

    service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: { get: vi.fn(), update: vi.fn() },
      secrets: { get: secretGet, store: secretStore, delete: secretDelete },
    } as never);

    await service.initialize();
  });

  it("deletes plan and its tasks, returns task count", async () => {
    taskListTasks.mockResolvedValue([
      { code: "T1", status: "PENDING" } as TaskRecord,
      { code: "T2", status: "DONE" } as TaskRecord,
    ]);
    taskDeleteTasks.mockResolvedValue(2);
    planDeletePlan.mockResolvedValue(true);

    const result = await service.deletePlanWithTasks("P1");

    expect(taskListTasks).toHaveBeenCalledWith({ planCode: "P1" });
    expect(taskDeleteTasks).toHaveBeenCalledWith(["T1", "T2"]);
    expect(planDeletePlan).toHaveBeenCalledWith("P1");
    expect(result).toEqual({ taskCount: 2 });
  });

  it("skips task delete when plan has no tasks", async () => {
    taskListTasks.mockResolvedValue([]);
    planDeletePlan.mockResolvedValue(true);

    const result = await service.deletePlanWithTasks("EMPTY-PLAN");

    expect(taskDeleteTasks).not.toHaveBeenCalled();
    expect(planDeletePlan).toHaveBeenCalledWith("EMPTY-PLAN");
    expect(result).toEqual({ taskCount: 0 });
  });
});
