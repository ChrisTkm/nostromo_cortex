import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskEnsureIndexes,
  taskClose,
  planEnsureIndexes,
  planClose,
  noteEnsureIndexes,
  noteClose,
  noteListNotes,
  noteGetNote,
  noteUpsertNote,
  noteDeleteNote,
  createMongoTaskStoreMock,
  createMongoActionPlanStoreMock,
  createMongoNoteStoreMock,
  createLoggerMock,
  jsonlTelemetryStoreMock,
  telemetryRecorderMock,
  sharedConnect,
  sharedDb,
  sharedClose,
  logsCreateIndexes,
  createDirectory,
  getConfig,
  updateConfig,
  telemetryInitialize
} = vi.hoisted(() => {
  const taskEnsureIndexes = vi.fn();
  const taskClose = vi.fn();
  const planEnsureIndexes = vi.fn();
  const planClose = vi.fn();
  const noteEnsureIndexes = vi.fn();
  const noteClose = vi.fn();
  const noteListNotes = vi.fn();
  const noteGetNote = vi.fn();
  const noteUpsertNote = vi.fn();
  const noteDeleteNote = vi.fn();
  return {
    taskEnsureIndexes,
    taskClose,
    planEnsureIndexes,
    planClose,
    noteEnsureIndexes,
    noteClose,
    noteListNotes,
    noteGetNote,
    noteUpsertNote,
    noteDeleteNote,
    createMongoTaskStoreMock: vi.fn(() => ({
      ensureIndexes: taskEnsureIndexes,
      close: taskClose
    })),
    createMongoActionPlanStoreMock: vi.fn(() => ({
      ensureIndexes: planEnsureIndexes,
      close: planClose
    })),
    createMongoNoteStoreMock: vi.fn(() => ({
      ensureIndexes: noteEnsureIndexes,
      listNotes: noteListNotes,
      getNote: noteGetNote,
      upsertNote: noteUpsertNote,
      deleteNote: noteDeleteNote,
      close: noteClose
    })),
    createLoggerMock: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })),
    jsonlTelemetryStoreMock: vi.fn().mockImplementation(() => ({})),
    telemetryRecorderMock: vi.fn().mockImplementation(() => ({
      initialize: telemetryInitialize,
      startRun: vi.fn()
    })),
    logsCreateIndexes: vi.fn(),
    sharedConnect: vi.fn(),
    sharedDb: vi.fn(),
    sharedClose: vi.fn(),
    createDirectory: vi.fn(),
    getConfig: vi.fn((_: string, fallback?: string) => fallback),
    updateConfig: vi.fn(),
    telemetryInitialize: vi.fn()
  };
});

vi.mock("@cortex/core", async () => {
  const actual = await vi.importActual<typeof import("@cortex/core")>("@cortex/core");
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
    },
    createMongoTaskStore: createMongoTaskStoreMock,
    createMongoActionPlanStore: createMongoActionPlanStoreMock,
    createMongoNoteStore: createMongoNoteStoreMock,
    loadConfig: vi.fn(() => ({
      logLevel: "info",
      logFormat: "pretty"
    }))
  };
});

vi.mock("vscode", () => ({
  workspace: {
    fs: {
      createDirectory
    },
    getConfiguration: vi.fn(() => ({
      get: getConfig,
      update: updateConfig
    }))
  },
  ConfigurationTarget: {
    Workspace: 1
  },
  env: {
    sessionId: "session-id"
  }
}));

vi.mock("@cortex/telemetry", () => ({
  createLogger: createLoggerMock,
  JsonlTelemetryStore: jsonlTelemetryStoreMock,
  TelemetryRecorder: telemetryRecorderMock
}));

import { ExtensionTaskService } from "./service.js";

describe("ExtensionTaskService.initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    logsCreateIndexes.mockResolvedValue(["logs_source_timestamp", "logs_level_timestamp", "logs_process_timestamp"]);
    sharedDb.mockImplementation(() => ({
      collection: vi.fn(() => ({
        createIndexes: logsCreateIndexes
      }))
    }));
    sharedClose.mockResolvedValue(undefined);
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
      updatedAt: "2026-04-17T00:00:00.000Z"
    });
    noteDeleteNote.mockResolvedValue(true);
  });

  it("connects the shared client and ensures task, plan, and note indexes", async () => {
    const service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn()
      }
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
    expect(logsCreateIndexes).toHaveBeenCalledTimes(1);

    const [taskOptions] = createMongoTaskStoreMock.mock.calls[0] ?? [];
    const [planOptions] = createMongoActionPlanStoreMock.mock.calls[0] ?? [];
    const [noteOptions] = createMongoNoteStoreMock.mock.calls[0] ?? [];
    expect(taskOptions.sharedClient).toBe(planOptions.sharedClient);
    expect(taskOptions.sharedClient).toBe(noteOptions.sharedClient);
    expect(noteOptions.collectionName).toBe("notes");
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(taskEnsureIndexes.mock.invocationCallOrder[0]);
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(planEnsureIndexes.mock.invocationCallOrder[0]);
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(noteEnsureIndexes.mock.invocationCallOrder[0]);
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
        update: vi.fn()
      }
    } as never);

    await service.initialize();

    expect(service.getConnectionSettings()).toMatchObject({
      mongoNotesCollection: "notes_custom"
    });

    await service.listNotes();
    await service.getNote("N-1");
    await service.saveNote({ code: "N-1", title: "Note 1", body: "Body" });
    await service.deleteNote("N-1");

    expect(noteListNotes).toHaveBeenCalledTimes(1);
    expect(noteGetNote).toHaveBeenCalledWith("N-1");
    expect(noteUpsertNote).toHaveBeenCalledWith({ code: "N-1", title: "Note 1", body: "Body" });
    expect(noteDeleteNote).toHaveBeenCalledWith("N-1");

    await service.updateConnectionSettings({ mongoNotesCollection: "notes_v2" });

    expect(updateConfig).toHaveBeenCalledWith("mongoNotesCollection", "notes_v2", 1);
    expect(createMongoNoteStoreMock).toHaveBeenCalledTimes(2);
    const [updatedNoteOptions] = createMongoNoteStoreMock.mock.calls[1] ?? [];
    expect(updatedNoteOptions.collectionName).toBe("notes_v2");
  });
});
