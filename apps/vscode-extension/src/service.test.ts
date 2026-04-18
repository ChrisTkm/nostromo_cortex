import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskEnsureIndexes,
  taskClose,
  planEnsureIndexes,
  planClose,
  createMongoTaskStoreMock,
  createMongoActionPlanStoreMock,
  sharedConnect,
  sharedGet,
  sharedClose,
  createDirectory,
  getConfig,
  updateConfig,
  telemetryInitialize
} = vi.hoisted(() => {
  const taskEnsureIndexes = vi.fn();
  const taskClose = vi.fn();
  const planEnsureIndexes = vi.fn();
  const planClose = vi.fn();
  return {
    taskEnsureIndexes,
    taskClose,
    planEnsureIndexes,
    planClose,
    createMongoTaskStoreMock: vi.fn(() => ({
      ensureIndexes: taskEnsureIndexes,
      close: taskClose
    })),
    createMongoActionPlanStoreMock: vi.fn(() => ({
      ensureIndexes: planEnsureIndexes,
      close: planClose
    })),
    sharedConnect: vi.fn(),
    sharedGet: vi.fn(),
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
      get = sharedGet;
      close = sharedClose;
    },
    createMongoTaskStore: createMongoTaskStoreMock,
    createMongoActionPlanStore: createMongoActionPlanStoreMock,
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

vi.mock("../../../packages/telemetry/src/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock("../../../packages/telemetry/src/jsonl-store.js", () => ({
  JsonlTelemetryStore: vi.fn().mockImplementation(() => ({}))
}));

vi.mock("../../../packages/telemetry/src/recorder.js", () => ({
  TelemetryRecorder: vi.fn().mockImplementation(() => ({
    initialize: telemetryInitialize,
    startRun: vi.fn()
  }))
}));

import { ExtensionTaskService } from "./service.js";

describe("ExtensionTaskService.initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDirectory.mockResolvedValue(undefined);
    telemetryInitialize.mockResolvedValue(undefined);
    sharedConnect.mockResolvedValue(undefined);
    sharedGet.mockReturnValue({});
    sharedClose.mockResolvedValue(undefined);
    taskEnsureIndexes.mockResolvedValue(undefined);
    taskClose.mockResolvedValue(undefined);
    planEnsureIndexes.mockResolvedValue(undefined);
    planClose.mockResolvedValue(undefined);
  });

  it("connects the shared client and ensures task and plan indexes", async () => {
    const service = new ExtensionTaskService({
      globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn()
      }
    } as never);

    await service.initialize();

    expect(sharedConnect).toHaveBeenCalledTimes(1);
    expect(sharedGet).toHaveBeenCalledTimes(1);
    expect(createMongoTaskStoreMock).toHaveBeenCalledTimes(1);
    expect(createMongoActionPlanStoreMock).toHaveBeenCalledTimes(1);
    expect(taskEnsureIndexes).toHaveBeenCalledTimes(1);
    expect(planEnsureIndexes).toHaveBeenCalledTimes(1);

    const [taskOptions] = createMongoTaskStoreMock.mock.calls[0] ?? [];
    const [planOptions] = createMongoActionPlanStoreMock.mock.calls[0] ?? [];
    expect(taskOptions.sharedClient).toBe(planOptions.sharedClient);
    expect(sharedConnect.mock.invocationCallOrder[0]).toBeLessThan(sharedGet.mock.invocationCallOrder[0]);
    expect(sharedGet.mock.invocationCallOrder[0]).toBeLessThan(taskEnsureIndexes.mock.invocationCallOrder[0]);
    expect(sharedGet.mock.invocationCallOrder[0]).toBeLessThan(planEnsureIndexes.mock.invocationCallOrder[0]);
  });
});
