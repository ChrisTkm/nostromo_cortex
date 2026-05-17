import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  activeTextEditorRef,
  commandHandlers,
  createTreeViewMock,
  createOutputChannelMock,
  createWebviewPanelMock,
  createStatusBarItemMock,
  executeCommandMock,
  filterStateRef,
  listLogsMock,
  listArchivedPlansMock,
  loadBundleMock,
  loadPlansMock,
  loadSnapshotMock,
  listNotesMock,
  listPendingRemindersMock,
  markRemindedMock,
  panelState,
  registerCommandMock,
  recordInteractionMock,
  rescheduleReminderMock,
  saveTaskMock,
  saveNoteMock,
  getTaskMock,
  getPlanMock,
  archivePlanMock,
  getConfigMock,
  deleteNoteMock,
  updateConfigMock,
  updateConnectionSettingsMock,
  saveMongoUrlMock,
  mongoClientMock,
  mongoConnectMock,
  mongoCloseMock,
  showErrorMessageMock,
  showInformationMessageMock,
  showInputBoxMock,
  showQuickPickMock,
  showTextDocumentMock,
  showWarningMessageMock,
  openTextDocumentMock,
  outputAppendLineMock,
  outputClearMock,
  outputShowMock,
  treePlansRef,
  treeProviderInstances,
  treeRefreshMock
} = vi.hoisted(() => {
  const activeTextEditorRef: { current?: unknown } = {};
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const treeRefreshMock = vi.fn();
  const treePlansRef = {
    current: [
      { code: "PLAN-A", status: "IN_PROGRESS" },
      { code: "PLAN-B", status: "DONE" }
    ]
  };
  const treeProviderInstances: Array<{
    planStatusFilter: "active" | "done";
    refresh: ReturnType<typeof vi.fn>;
    setPlanStatusFilter: ReturnType<typeof vi.fn>;
    getChildren: ReturnType<typeof vi.fn>;
  }> = [];
  const filterStateRef = {
    current: {
      searchQuery: undefined as string | undefined,
      selectedProjects: [] as string[],
      selectedGroups: [] as string[],
      selectedTags: [] as string[],
      selectedStatuses: [] as string[],
      selectedSeverities: [] as string[],
      graphOrientation: "LR" as "LR" | "TB",
      showMiniMap: true,
      selectedTaskCode: undefined as string | undefined,
      selectedPlanCode: undefined as string | undefined,
      zoom: 1,
      pan: { x: 0, y: 0 }
    }
  };
  const listNotesMock = vi.fn();
  const listLogsMock = vi.fn();
  const listArchivedPlansMock = vi.fn();
  const loadBundleMock = vi.fn();
  const loadPlansMock = vi.fn();
  const loadSnapshotMock = vi.fn();
  const listPendingRemindersMock = vi.fn();
  const markRemindedMock = vi.fn();
  const rescheduleReminderMock = vi.fn();
  const recordInteractionMock = vi.fn();
  const getTaskMock = vi.fn();
  const getPlanMock = vi.fn();
  const archivePlanMock = vi.fn();
  const getConfigMock = vi.fn();
  const saveTaskMock = vi.fn();
  const saveNoteMock = vi.fn();
  const deleteNoteMock = vi.fn();
  const updateConfigMock = vi.fn();
  const updateConnectionSettingsMock = vi.fn();
  const saveMongoUrlMock = vi.fn();
  const mongoConnectMock = vi.fn();
  const mongoCloseMock = vi.fn();
  const mongoClientMock = vi.fn(() => ({
    connect: mongoConnectMock,
    close: mongoCloseMock
  }));
  const showInputBoxMock = vi.fn();
  const showQuickPickMock = vi.fn();
  const showErrorMessageMock = vi.fn();
  const showInformationMessageMock = vi.fn();
  const showWarningMessageMock = vi.fn();
  const showTextDocumentMock = vi.fn();
  const openTextDocumentMock = vi.fn();
  const outputAppendLineMock = vi.fn();
  const outputClearMock = vi.fn();
  const outputShowMock = vi.fn();
  const createOutputChannelMock = vi.fn(() => ({
    appendLine: outputAppendLineMock,
    clear: outputClearMock,
    dispose: vi.fn(),
    show: outputShowMock
  }));
  const createStatusBarItemMock = vi.fn(() => ({
    text: "",
    tooltip: "",
    command: undefined,
    name: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  }));
  const panelState: {
    panel?: {
      reveal: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      webview: {
        html: string;
        postMessage: ReturnType<typeof vi.fn>;
        onDidReceiveMessage: ReturnType<typeof vi.fn>;
      };
      onDidDispose: ReturnType<typeof vi.fn>;
    };
    messageHandler?: (message: unknown) => unknown;
    disposeHandler?: () => unknown;
  } = {};

  const registerCommandMock = vi.fn((command: string, handler: (...args: unknown[]) => unknown) => {
    commandHandlers.set(command, handler);
    return { dispose: vi.fn() };
  });

  const executeCommandMock = vi.fn(async (command: string, ...args: unknown[]) => {
    const handler = commandHandlers.get(command);
    return handler?.(...args);
  });

  const createTreeViewMock = vi.fn(() => ({
    title: "",
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn()
  }));

  const createWebviewPanelMock = vi.fn(() => {
    const panel = {
      reveal: vi.fn(),
      dispose: vi.fn(() => {
        panelState.disposeHandler?.();
      }),
      webview: {
        html: "",
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: (message: unknown) => unknown) => {
          panelState.messageHandler = handler;
          return { dispose: vi.fn() };
        })
      },
      onDidDispose: vi.fn((handler: () => unknown) => {
        panelState.disposeHandler = handler;
        return { dispose: vi.fn() };
      }),
      iconPath: undefined
    };
    panelState.panel = panel;
    return panel;
  });

  return {
    activeTextEditorRef,
    commandHandlers,
    createTreeViewMock,
    createOutputChannelMock,
    createWebviewPanelMock,
    createStatusBarItemMock,
    executeCommandMock,
    filterStateRef,
    listLogsMock,
    listArchivedPlansMock,
    loadBundleMock,
    loadPlansMock,
    loadSnapshotMock,
    listNotesMock,
    listPendingRemindersMock,
    markRemindedMock,
    panelState,
    registerCommandMock,
    recordInteractionMock,
    rescheduleReminderMock,
    saveTaskMock,
    saveNoteMock,
    getTaskMock,
    getPlanMock,
    archivePlanMock,
    getConfigMock,
    deleteNoteMock,
    updateConfigMock,
    updateConnectionSettingsMock,
    saveMongoUrlMock,
    mongoClientMock,
    mongoConnectMock,
    mongoCloseMock,
    showErrorMessageMock,
    showInformationMessageMock,
    showInputBoxMock,
    showQuickPickMock,
    showTextDocumentMock,
    showWarningMessageMock,
    openTextDocumentMock,
    outputAppendLineMock,
    outputClearMock,
    outputShowMock,
    treePlansRef,
    treeProviderInstances,
    treeRefreshMock
  };
});

vi.mock("@cortex/core", () => ({
  TASK_SEVERITIES: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  TASK_STATUSES: ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "FAILED"],
  buildTaskGraph: vi.fn(() => ({ cycles: [] }))
}));

vi.mock("mongodb", () => ({
  MongoClient: mongoClientMock
}));

vi.mock("vscode", () => ({
  ExtensionMode: {
    Test: 1,
    1: "Test"
  },
  ViewColumn: {
    One: 1,
    Beside: 2
  },
  StatusBarAlignment: {
    Left: 1
  },
  window: {
    get activeTextEditor() {
      return activeTextEditorRef.current;
    },
    createTreeView: createTreeViewMock,
    createWebviewPanel: createWebviewPanelMock,
    createStatusBarItem: createStatusBarItemMock,
    showInputBox: showInputBoxMock,
    showQuickPick: showQuickPickMock,
    showInformationMessage: showInformationMessageMock,
    showTextDocument: showTextDocumentMock,
    showWarningMessage: showWarningMessageMock,
    showErrorMessage: showErrorMessageMock,
    createOutputChannel: createOutputChannelMock
  },
  commands: {
    registerCommand: registerCommandMock,
    executeCommand: executeCommandMock
  },
  Position: class Position {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  },
  Range: class Range {
    constructor(
      public readonly start: { line: number; character: number },
      public readonly end: { line: number; character: number }
    ) {}
  },
  Uri: {
    file: vi.fn((fsPath: string) => ({ fsPath })),
    joinPath: vi.fn((base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join("\\")
    }))
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: getConfigMock,
      update: updateConfigMock
    })),
    openTextDocument: openTextDocumentMock
  }
}));

vi.mock("./service.js", () => ({
  ExtensionTaskService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    logger: {
      debug: vi.fn(),
      error: vi.fn()
    },
    getConnectionSettings: vi.fn(() => ({
      mongoUrl: "mongodb://127.0.0.1:27017",
      mongoDbName: "nostromo_cortex",
      mongoTasksCollection: "tasks",
      mongoNotesCollection: "notes",
      mongoLogsCollection: "logs",
      mongoPlansCollection: "action_plans"
    })),
    getFilterState: vi.fn(() => ({
      ...filterStateRef.current,
      selectedProjects: [...filterStateRef.current.selectedProjects],
      selectedGroups: [...filterStateRef.current.selectedGroups],
      selectedTags: [...filterStateRef.current.selectedTags],
      selectedStatuses: [...filterStateRef.current.selectedStatuses],
      selectedSeverities: [...filterStateRef.current.selectedSeverities],
      pan: { ...filterStateRef.current.pan }
    })),
    updateFilterState: vi.fn(async (nextState: Record<string, unknown>) => {
      filterStateRef.current = {
        ...filterStateRef.current,
        ...nextState,
        selectedProjects: Array.isArray(nextState.selectedProjects)
          ? [...(nextState.selectedProjects as string[])]
          : filterStateRef.current.selectedProjects,
        selectedGroups: Array.isArray(nextState.selectedGroups)
          ? [...(nextState.selectedGroups as string[])]
          : filterStateRef.current.selectedGroups,
        selectedTags: Array.isArray(nextState.selectedTags)
          ? [...(nextState.selectedTags as string[])]
          : filterStateRef.current.selectedTags,
        selectedStatuses: Array.isArray(nextState.selectedStatuses)
          ? [...(nextState.selectedStatuses as string[])]
          : filterStateRef.current.selectedStatuses,
        selectedSeverities: Array.isArray(nextState.selectedSeverities)
          ? [...(nextState.selectedSeverities as string[])]
          : filterStateRef.current.selectedSeverities,
        pan:
          nextState.pan && typeof nextState.pan === "object"
            ? { ...filterStateRef.current.pan, ...(nextState.pan as { x?: number; y?: number }) }
            : filterStateRef.current.pan
      };
    }),
    loadBundle: loadBundleMock,
    loadSnapshot: loadSnapshotMock,
    listNotes: listNotesMock,
    listPendingReminders: listPendingRemindersMock,
    listLogs: listLogsMock,
    listArchivedPlans: listArchivedPlansMock,
    markReminded: markRemindedMock,
    recordInteraction: recordInteractionMock,
    rescheduleReminder: rescheduleReminderMock,
    getTask: getTaskMock,
    getPlan: getPlanMock,
    archivePlan: archivePlanMock,
    saveTask: saveTaskMock,
    saveNote: saveNoteMock,
    deleteNote: deleteNoteMock,
    clearMongoUrl: vi.fn().mockResolvedValue(undefined),
    listDatabaseNames: vi.fn().mockResolvedValue([]),
    listCollectionNames: vi.fn().mockResolvedValue([]),
    inspectCollection: vi.fn().mockResolvedValue({ documentCount: 0, validTaskCount: 0, skippedCount: 0 }),
    updateConnectionSettings: updateConnectionSettingsMock,
    saveMongoUrl: saveMongoUrlMock,
    bootstrapSampleDatabase: vi.fn().mockResolvedValue(undefined),
    loadPlans: loadPlansMock
  }))
}));

vi.mock("./tree.js", () => ({
  CortexTreeProvider: vi.fn().mockImplementation((_service, initialFilter: "active" | "done" = "active") => {
    const instance = {
      planStatusFilter: initialFilter,
      refresh: treeRefreshMock,
      setPlanStatusFilter: vi.fn((next: "active" | "done") => {
        instance.planStatusFilter = next;
      }),
      getChildren: vi.fn(async () =>
        treePlansRef.current
          .filter((plan) => (instance.planStatusFilter === "done" ? plan.status === "DONE" : plan.status === "IN_PROGRESS"))
          .map((plan) => ({
            kind: "group",
            id: `plan:${plan.code}`,
            label: plan.code,
            children: []
          }))
      )
    };
    treeProviderInstances.push(instance);
    return instance;
  })
}));

vi.mock("./webview/html.js", () => ({
  getGraphHtml: vi.fn(() => "<html></html>")
}));

vi.mock("./webview/notes/getHtml.js", () => ({
  getNotesHtml: vi.fn(() => "<html><div id=\"root\"></div><script src=\"notes.js\"></script></html>")
}));

vi.mock("./webview/logs/getHtml.js", () => ({
  getLogsHtml: vi.fn(() => "<html><div id=\"root\"></div><script src=\"logs.js\"></script></html>")
}));

vi.mock("./webview/archive/getHtml.js", () => ({
  getArchiveHtml: vi.fn(() => "<html><div id=\"root\"></div><script src=\"archive.js\"></script></html>")
}));

vi.mock("./webview/script-flow/getHtml.js", () => ({
  getScriptFlowHtml: vi.fn(() => "<html><div id=\"root\"></div><script src=\"script-flow.js\"></script></html>")
}));

import { activate } from "./extension.js";

function createContext(initialWorkspaceState: Record<string, unknown> = {}) {
  const workspaceStateValues = new Map<string, unknown>(Object.entries(initialWorkspaceState));
  const secretValues = new Map<string, string>();
  return {
    extensionMode: 1,
    extensionUri: { fsPath: "C:\\dev\\Cortex\\apps\\vscode-extension" },
    globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
    subscriptions: [],
    workspaceState: {
      get: vi.fn((key: string, defaultValue?: unknown) => (workspaceStateValues.has(key) ? workspaceStateValues.get(key) : defaultValue)),
      update: vi.fn(async (key: string, value: unknown) => {
        workspaceStateValues.set(key, value);
      })
    },
    secrets: {
      get: vi.fn(async (key: string) => secretValues.get(key)),
      store: vi.fn(async (key: string, value: string) => {
        secretValues.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        secretValues.delete(key);
      })
    }
  } as any;
}

describe("activate notes commands", () => {
  beforeEach(() => {
    const scriptFlowFixturePath = "C:\\dev\\Cortex\\apps\\vscode-extension\\fixtures\\script-flow\\sample.ts";
    const scriptFlowFixtureSource = [
      "export function accumulate(limit: number) {",
      "  let total = 0;",
      "",
      "  if (limit <= 0) {",
      "    return total;",
      "  }",
      "",
      "  for (let index = 0; index < limit; index += 1) {",
      "    total += index;",
      "  }",
      "",
      "  return total;",
      "}"
    ].join("\n");
    activeTextEditorRef.current = {
      document: {
        fileName: scriptFlowFixturePath,
        uri: { fsPath: scriptFlowFixturePath },
        languageId: "typescript",
        getText: vi.fn(() => scriptFlowFixtureSource)
      },
      selection: {
        isEmpty: false,
        start: { line: 4, character: 2 },
        end: { line: 8, character: 18 }
      }
    };
    commandHandlers.clear();
    treeProviderInstances.length = 0;
    treePlansRef.current = [
      { code: "PLAN-A", status: "IN_PROGRESS" },
      { code: "PLAN-B", status: "DONE" }
    ];
    panelState.panel = undefined;
    panelState.messageHandler = undefined;
    panelState.disposeHandler = undefined;
    vi.clearAllMocks();
    getConfigMock.mockReturnValue(undefined);
    updateConfigMock.mockResolvedValue(undefined);
    updateConnectionSettingsMock.mockResolvedValue(undefined);
    saveMongoUrlMock.mockResolvedValue(undefined);
    mongoConnectMock.mockResolvedValue(undefined);
    mongoCloseMock.mockResolvedValue(undefined);
    filterStateRef.current = {
      searchQuery: undefined,
      selectedProjects: [],
      selectedGroups: [],
      selectedTags: [],
      selectedStatuses: [],
      selectedSeverities: [],
      graphOrientation: "LR",
      showMiniMap: true,
      selectedTaskCode: undefined,
      selectedPlanCode: undefined,
      zoom: 1,
      pan: { x: 0, y: 0 }
    };
    listNotesMock.mockResolvedValue([
      {
        code: "N-1",
        title: "First note",
        body: "",
        tags: [],
        pinned: false,
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z"
      }
    ]);
    listLogsMock.mockResolvedValue([
      {
        timestamp: "2026-04-18T00:00:00.000Z",
        day: "2026-04-18",
        level: "INFO",
        source: "nostromo.bootstrap",
        folder: "nostromo",
        message: "Mongo ready",
        summary: "Mongo ready (nostromo.bootstrap)",
        details: []
      }
    ]);
    listArchivedPlansMock.mockResolvedValue([
      {
        code: "PLAN-B",
        title: "Done plan",
        completedAt: "2026-04-18T00:00:00.000Z",
        archivedAt: "2026-04-19T00:00:00.000Z",
        tags: ["archive"],
        taskCount: 2,
        noteCount: 1,
        jsonPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json",
        tasks: [
          {
            code: "TASK-2",
            shortTask: "Second task",
            status: "DONE"
          }
        ],
        notes: [
          {
            title: "Archive note",
            body: "Stored note",
            tags: []
          }
        ]
      }
    ]);
    listPendingRemindersMock.mockResolvedValue([]);
    markRemindedMock.mockResolvedValue(null);
    recordInteractionMock.mockResolvedValue(undefined);
    rescheduleReminderMock.mockResolvedValue(null);
    loadPlansMock.mockResolvedValue([]);
    archivePlanMock.mockResolvedValue({
      jsonPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json",
      noteCount: 1,
      planCode: "PLAN-B",
      taskCount: 2
    });
    getPlanMock.mockResolvedValue({
      code: "PLAN-B",
      title: "Done plan",
      description: "",
      goal: "",
      context: "",
      status: "DONE",
      tags: [],
      progress: {
        total: 2,
        pending: 0,
        in_progress: 0,
        blocked: 0,
        done: 2,
        failed: 0
      },
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    });
    getTaskMock.mockResolvedValue({
      id: "task-1",
      code: "TASK-1",
      shortTask: "First task",
      detail: "Existing detail",
      status: "PENDING",
      severity: "LOW",
      agent: "codex",
      tags: ["graph"],
      dependsOn: [],
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    });
    saveTaskMock.mockResolvedValue(undefined);
    loadBundleMock.mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          code: "TASK-1",
          shortTask: "First task",
          severity: "LOW",
          status: "PENDING",
          tags: [],
          planCode: "PLAN-A"
        },
        {
          id: "task-2",
          code: "TASK-2",
          shortTask: "Second task",
          severity: "LOW",
          status: "PENDING",
          tags: [],
          planCode: "PLAN-B"
        }
      ],
      plans: [{ code: "PLAN-0" }, { code: "PLAN-A" }, { code: "PLAN-B" }]
    });
    loadSnapshotMock.mockImplementation(async (filter?: { planCode?: string }) => ({
      nodes: filter?.planCode ? [{ id: filter.planCode, data: { label: filter.planCode } }] : [],
      edges: [],
      warnings: {
        orphans: []
      }
    }));
    saveNoteMock.mockResolvedValue({
      code: "N-2",
      title: "Saved note",
      body: "Body",
      tags: [],
      pinned: false,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    });
    deleteNoteMock.mockResolvedValue(true);
    showInputBoxMock.mockReset();
    showQuickPickMock.mockReset();
    showErrorMessageMock.mockReset();
    showInformationMessageMock.mockReset();
    showWarningMessageMock.mockReset();
    openTextDocumentMock.mockRejectedValue(new Error("No mocked document"));
  });

  it("starts the tree in active mode and only exposes IN_PROGRESS plans", async () => {
    const context = createContext();

    await activate(context);

    const treeProvider = treeProviderInstances[0];
    const treeView = createTreeViewMock.mock.results[0]?.value;
    const children = await treeProvider.getChildren();

    expect(context.workspaceState.get).toHaveBeenCalledWith("cortex.planStatusFilter", "active");
    expect(treeProvider.planStatusFilter).toBe("active");
    expect(children.map((node: { label: string }) => node.label)).toEqual(["PLAN-A"]);
    expect(treeView.title).toBe("Cortex · En curso");
  });

  it("migrates a legacy Mongo URL setting into SecretStorage on activation", async () => {
    getConfigMock.mockReturnValueOnce("mongodb://legacy.example:27017");
    const context = createContext();

    await activate(context);

    expect(context.secrets.store).toHaveBeenCalledWith("cortex.mongoUrl", "mongodb://legacy.example:27017");
    expect(updateConfigMock).toHaveBeenCalledWith("mongoUrl", undefined, 2);
    expect(updateConfigMock).toHaveBeenCalledWith("mongoUrl", undefined, 1);
    expect(showInformationMessageMock).toHaveBeenCalledWith(expect.stringContaining("migrated the Mongo URL"));
  });

  it("rejects invalid Mongo URLs before pinging or saving", async () => {
    showInputBoxMock.mockResolvedValueOnce("https://mongo.example");

    await activate(createContext());
    await executeCommandMock("cortex.setMongoUrl");

    expect(showErrorMessageMock).toHaveBeenCalledWith("URL inválida: debe empezar con mongodb:// o mongodb+srv://");
    expect(mongoClientMock).not.toHaveBeenCalled();
    expect(saveMongoUrlMock).not.toHaveBeenCalled();
  });

  it("saves a Mongo URL after a successful ping", async () => {
    showInputBoxMock.mockResolvedValueOnce(" mongodb://mongo.example:27017 ");

    await activate(createContext());
    await executeCommandMock("cortex.setMongoUrl");

    expect(mongoClientMock).toHaveBeenCalledWith("mongodb://mongo.example:27017", { serverSelectionTimeoutMS: 3000 });
    expect(mongoConnectMock).toHaveBeenCalledTimes(1);
    expect(mongoCloseMock).toHaveBeenCalledTimes(1);
    expect(saveMongoUrlMock).toHaveBeenCalledWith("mongodb://mongo.example:27017");
    expect(showInformationMessageMock).toHaveBeenCalledWith("Mongo URL guardada.");
  });

  it("does not save a Mongo URL when ping fails and the user cancels", async () => {
    mongoConnectMock.mockRejectedValueOnce(new Error("offline"));
    showInputBoxMock.mockResolvedValueOnce("mongodb+srv://mongo.example/db");
    showWarningMessageMock.mockResolvedValueOnce("Cancelar");

    await activate(createContext());
    await executeCommandMock("cortex.setMongoUrl");

    expect(showWarningMessageMock).toHaveBeenCalledWith("No se pudo conectar. ¿Guardar igual?", "Guardar", "Cancelar");
    expect(saveMongoUrlMock).not.toHaveBeenCalled();
    expect(showInformationMessageMock).not.toHaveBeenCalledWith("Mongo URL guardada.");
  });

  it("saves a Mongo URL when ping fails and the user confirms", async () => {
    mongoConnectMock.mockRejectedValueOnce(new Error("offline"));
    showInputBoxMock.mockResolvedValueOnce("mongodb://mongo.example:27017");
    showWarningMessageMock.mockResolvedValueOnce("Guardar");

    await activate(createContext());
    await executeCommandMock("cortex.setMongoUrl");

    expect(showWarningMessageMock).toHaveBeenCalledWith("No se pudo conectar. ¿Guardar igual?", "Guardar", "Cancelar");
    expect(saveMongoUrlMock).toHaveBeenCalledWith("mongodb://mongo.example:27017");
    expect(showInformationMessageMock).toHaveBeenCalledWith("Mongo URL guardada.");
  });

  it("archives a DONE plan from a tree context argument and opens the JSON on request", async () => {
    showInformationMessageMock.mockResolvedValueOnce("Open JSON");

    await activate(createContext());
    await executeCommandMock("cortex.archivePlan", {
      kind: "group",
      planCode: "PLAN-B",
      label: "PLAN-B"
    });

    expect(getPlanMock).toHaveBeenCalledWith("PLAN-B");
    expect(archivePlanMock).toHaveBeenCalledWith("PLAN-B");
    expect(treeRefreshMock).toHaveBeenCalled();
    expect(showInformationMessageMock).toHaveBeenCalledWith("Plan PLAN-B archived (2 tasks, 1 notes).", "Open JSON");
    expect(executeCommandMock).toHaveBeenCalledWith("vscode.open", {
      fsPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json"
    });
  });

  it("aborts archivePlan when the selected plan is not DONE", async () => {
    getPlanMock.mockResolvedValueOnce({
      code: "PLAN-A",
      title: "Active plan",
      description: "",
      goal: "",
      context: "",
      status: "IN_PROGRESS",
      tags: [],
      progress: {
        total: 1,
        pending: 0,
        in_progress: 1,
        blocked: 0,
        done: 0,
        failed: 0
      },
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    });

    await activate(createContext());
    await executeCommandMock("cortex.archivePlan", "PLAN-A");

    expect(showErrorMessageMock).toHaveBeenCalledWith("Plan PLAN-A is not DONE.");
    expect(archivePlanMock).not.toHaveBeenCalled();
  });

  it("toggles the tree to done mode and only exposes DONE plans", async () => {
    const context = createContext();

    await activate(context);
    await executeCommandMock("cortex.togglePlanStatusFilter");

    const treeProvider = treeProviderInstances[0];
    const treeView = createTreeViewMock.mock.results[0]?.value;
    const children = await treeProvider.getChildren();

    expect(context.workspaceState.update).toHaveBeenCalledWith("cortex.planStatusFilter", "done");
    expect(context.workspaceState.get("cortex.planStatusFilter", "active")).toBe("done");
    expect(treeProvider.setPlanStatusFilter).toHaveBeenCalledWith("done");
    expect(treeProvider.planStatusFilter).toBe("done");
    expect(children.map((node: { label: string }) => node.label)).toEqual(["PLAN-B"]);
    expect(treeView.title).toBe("Cortex · Cerrados");
  });

  it("adds Notes to cortex.showOptions and opens the notes panel", async () => {
    showQuickPickMock.mockResolvedValueOnce({
      label: "Notes",
      command: "cortex.openNotes"
    });

    await activate(createContext());
    await executeCommandMock("cortex.showOptions");

    const [items] = showQuickPickMock.mock.calls[0] ?? [];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Notes",
          command: "cortex.openNotes"
        })
      ])
    );
    expect(createWebviewPanelMock).toHaveBeenCalledWith("cortex.notes", "Cortex Notes", 1, expect.objectContaining({ enableScripts: true }));
    expect(panelState.panel?.webview.html).toContain('<div id="root"></div>');
    expect(panelState.panel?.webview.html).toContain("notes.js");
  });

  it("wires ready, save, and delete messages to the notes service", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openNotes");

    await panelState.messageHandler?.({ type: "ready" });

    expect(listNotesMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "notes:list",
      notes: expect.arrayContaining([expect.objectContaining({ code: "N-1" })])
    });

    await panelState.messageHandler?.({
      type: "notes:save",
      input: { code: "N-2", title: "Saved note", body: "Body" }
    });

    expect(saveNoteMock).toHaveBeenCalledWith({
      code: "N-2",
      title: "Saved note",
      body: "Body"
    });
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "notes:saved",
      note: expect.objectContaining({ code: "N-2" })
    });

    await panelState.messageHandler?.({ type: "notes:delete", code: "N-1" });

    expect(deleteNoteMock).toHaveBeenCalledWith("N-1");
    expect(listNotesMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not replay the initial notes mode on duplicate ready messages", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openNotes");

    await panelState.messageHandler?.({ type: "ready" });
    await panelState.messageHandler?.({ type: "ready" });

    const openMessages = panelState.panel?.webview.postMessage.mock.calls.filter(([message]) => {
      return typeof message === "object" && message !== null && (message as { type?: string }).type === "open";
    });

    expect(openMessages).toHaveLength(1);
  });

  it("adds Logs to cortex.showOptions and opens the logs panel", async () => {
    showQuickPickMock.mockResolvedValueOnce({
      label: "Logs",
      command: "cortex.openLogs"
    });

    await activate(createContext());
    await executeCommandMock("cortex.showOptions");

    const [items] = showQuickPickMock.mock.calls[0] ?? [];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Logs",
          command: "cortex.openLogs"
        })
      ])
    );
    expect(createWebviewPanelMock).toHaveBeenCalledWith("cortex.logs", "Cortex Logs", 1, expect.objectContaining({ enableScripts: true }));
    expect(panelState.panel?.webview.html).toContain("logs.js");
  });

  it("posts logs on ready, refresh, and panel reopen when data exists", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openLogs");

    await panelState.messageHandler?.({ type: "ready" });

    expect(listLogsMock).toHaveBeenCalledTimes(1);
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "logs:list",
      logs: expect.arrayContaining([expect.objectContaining({ source: "nostromo.bootstrap" })])
    });

    await panelState.messageHandler?.({ type: "logs:refresh" });

    expect(listLogsMock).toHaveBeenCalledTimes(2);

    await executeCommandMock("cortex.openLogs");

    expect(panelState.panel?.reveal).toHaveBeenCalled();
    expect(listLogsMock).toHaveBeenCalledTimes(3);
  });

  it("opens the archive panel, posts archived plans, and opens JSON snapshots", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openArchive");
    await panelState.messageHandler?.({ type: "ready" });

    expect(createWebviewPanelMock).toHaveBeenCalledWith("cortex.archive", "Cortex Archive", 1, expect.objectContaining({ enableScripts: true }));
    expect(panelState.panel?.webview.html).toContain("archive.js");
    expect(listArchivedPlansMock).toHaveBeenCalledTimes(1);
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "archive:list",
      plans: expect.arrayContaining([expect.objectContaining({ code: "PLAN-B" })])
    });

    openTextDocumentMock.mockResolvedValueOnce({ uri: { fsPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json" } });
    await panelState.messageHandler?.({
      type: "archive:openJson",
      jsonPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json"
    });

    expect(openTextDocumentMock).toHaveBeenCalledWith({ fsPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json" });
    expect(showTextDocumentMock).toHaveBeenCalledWith(expect.objectContaining({ uri: expect.objectContaining({ fsPath: "C:\\temp\\cortex-archive\\plans\\PLAN-B.json" }) }));
  });

  it("adds Script Flow to cortex.showOptions and opens the dedicated panel", async () => {
    showQuickPickMock.mockResolvedValueOnce({
      label: "Script Flow",
      command: "cortex.openScriptFlow"
    });

    await activate(createContext());
    await executeCommandMock("cortex.showOptions");
    await panelState.messageHandler?.({ type: "ready" });

    const [items] = showQuickPickMock.mock.calls[0] ?? [];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Script Flow",
          command: "cortex.openScriptFlow"
        })
      ])
    );
    expect(createWebviewPanelMock).toHaveBeenCalledWith(
      "cortex.scriptFlow",
      "Cortex Script Flow",
      2,
      expect.objectContaining({ enableScripts: true })
    );
    expect(panelState.panel?.webview.html).toContain("script-flow.js");
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "scriptFlow:snapshot",
      snapshot: expect.objectContaining({
        metadata: expect.objectContaining({
          path: "C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts",
          language: "typescript"
        }),
        nodes: expect.arrayContaining([expect.objectContaining({ id: "fn:accumulate", kind: "function" })]),
        edges: expect.any(Array)
      })
    });
    expect(recordInteractionMock).toHaveBeenCalledWith(
      "script_flow_open",
      expect.objectContaining({
        lang: "typescript",
        parseMs: expect.any(Number)
      })
    );
  });

  it("offers Tasks, Graph, Notes, and Logs in the panel switcher", async () => {
    showQuickPickMock.mockResolvedValueOnce({
      label: "Tasks",
      command: "cortex.openTasks"
    });

    await activate(createContext());
    await executeCommandMock("cortex.switchPanel");

    const [items, options] = showQuickPickMock.mock.calls[0] ?? [];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Tasks", command: "cortex.openTasks" }),
        expect.objectContaining({ label: "Graph", command: "cortex.openGraph" }),
        expect.objectContaining({ label: "Notes", command: "cortex.openNotes" }),
        expect.objectContaining({ label: "Logs", command: "cortex.openLogs" }),
        expect.objectContaining({ label: "Archive", command: "cortex.openArchive" }),
        expect.objectContaining({ label: "Script Flow", command: "cortex.openScriptFlow" })
      ])
    );
    expect(options).toEqual(expect.objectContaining({ title: "Switch Cortex panel" }));
    expect(executeCommandMock).toHaveBeenCalledWith("workbench.view.extension.cortex");
  });

  it("opens Graph with the selected task plan instead of the persisted banner plan", async () => {
    filterStateRef.current.selectedPlanCode = "PLAN-0";

    await activate(createContext());
    await executeCommandMock("cortex.openGraph", "TASK-1");

    expect(loadSnapshotMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ planCode: "PLAN-A" }),
      expect.any(Object),
      expect.objectContaining({ code: "PLAN-A" })
    );
    expect(filterStateRef.current.selectedPlanCode).toBe("PLAN-A");
    expect(filterStateRef.current.selectedTaskCode).toBe("TASK-1");

    await executeCommandMock("cortex.openGraph", "TASK-2");

    expect(loadSnapshotMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ planCode: "PLAN-B" }),
      expect.any(Object),
      expect.objectContaining({ code: "PLAN-B" })
    );
    expect(filterStateRef.current.selectedPlanCode).toBe("PLAN-B");
    expect(filterStateRef.current.selectedTaskCode).toBe("TASK-2");
  });

  it("preserves manual plan navigation when reopening Graph without a task target", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openGraph", "TASK-1");

    await panelState.messageHandler?.({ type: "selectPlan", code: "PLAN-B" });

    expect(filterStateRef.current.selectedPlanCode).toBe("PLAN-B");
    expect(filterStateRef.current.selectedTaskCode).toBeUndefined();
    expect(loadSnapshotMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ planCode: "PLAN-B" }),
      expect.any(Object),
      expect.objectContaining({ code: "PLAN-B" })
    );

    await executeCommandMock("cortex.openGraph");

    expect(loadSnapshotMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ planCode: "PLAN-B" }),
      expect.any(Object),
      expect.objectContaining({ code: "PLAN-B" })
    );
  });

  it("writes orphan dependency warnings from the Graph webview to the Cortex output channel", async () => {
    loadSnapshotMock.mockResolvedValueOnce({
      nodes: [],
      edges: [],
      warnings: {
        orphans: [{ taskCode: "TASK-2", missing: "TASK-404" }]
      }
    });

    await activate(createContext());
    await executeCommandMock("cortex.openGraph");
    await panelState.messageHandler?.({ type: "showOrphanWarnings" });

    expect(createOutputChannelMock).toHaveBeenCalledWith("Cortex");
    expect(outputClearMock).toHaveBeenCalled();
    expect(outputAppendLineMock).toHaveBeenCalledWith("WARN orphan dep: task=TASK-2 missing=TASK-404");
    expect(outputShowMock).toHaveBeenCalledWith(true);
  });

  it("reuses the existing task edit flow when the Graph webview posts editTask", async () => {
    showInputBoxMock.mockResolvedValueOnce("Edited from inspector");
    showQuickPickMock.mockResolvedValueOnce("DONE").mockResolvedValueOnce("HIGH");

    await activate(createContext());
    await executeCommandMock("cortex.openGraph", "TASK-1");
    await panelState.messageHandler?.({ type: "editTask", code: "TASK-1" });

    expect(getTaskMock).toHaveBeenCalledWith("TASK-1");
    expect(saveTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "TASK-1",
        short_task: "Edited from inspector",
        status: "DONE",
        severity: "HIGH"
      })
    );
    expect(showInformationMessageMock).toHaveBeenCalledWith("Task TASK-1 updated.");
  });

  it("lets editNote and deleteNote pick a note code when none is provided", async () => {
    showQuickPickMock
      .mockResolvedValueOnce({
        label: "N-1",
        code: "N-1"
      })
      .mockResolvedValueOnce({
        label: "N-1",
        code: "N-1"
      });
    showWarningMessageMock.mockResolvedValue("Delete");

    await activate(createContext());
    await executeCommandMock("cortex.openNotes");
    await executeCommandMock("cortex.editNote");
    await executeCommandMock("cortex.deleteNote");

    expect(showQuickPickMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ code: "N-1" })]),
      expect.objectContaining({ title: "Select a note to edit" })
    );
    expect(panelState.panel?.reveal).toHaveBeenCalled();
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "open",
      mode: {
        type: "edit",
        code: "N-1"
      }
    });
    expect(showWarningMessageMock).toHaveBeenCalledWith("Delete note N-1?", { modal: true }, "Delete");
    expect(deleteNoteMock).toHaveBeenCalledWith("N-1");
  });

  it("records node selection telemetry from the Script Flow webview", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openScriptFlow");
    await panelState.messageHandler?.({ type: "ready" });
    await panelState.messageHandler?.({ type: "scriptFlow:selectNode", nodeId: "fn:accumulate" });

    expect(recordInteractionMock).toHaveBeenCalledWith(
      "script_flow_node_select",
      expect.objectContaining({
        nodeId: "fn:accumulate",
        kind: "function"
      })
    );
    expect(showTextDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "C:\\dev\\Cortex\\apps\\vscode-extension\\fixtures\\script-flow\\sample.ts" }),
      expect.objectContaining({
        selection: expect.objectContaining({
          start: expect.objectContaining({ line: 0, character: 0 }),
          end: expect.objectContaining({ line: 12, character: 1 })
        })
      })
    );
  });

  it("records drawer click telemetry from the Script Flow webview", async () => {
    await activate(createContext());
    await executeCommandMock("cortex.openScriptFlow");
    await panelState.messageHandler?.({ type: "ready" });
    await panelState.messageHandler?.({ type: "scriptFlow:drawerClick", section: "decisions" });

    expect(recordInteractionMock).toHaveBeenCalledWith("script_flow_drawer_click", {
      section: "decisions"
    });
  });
});
