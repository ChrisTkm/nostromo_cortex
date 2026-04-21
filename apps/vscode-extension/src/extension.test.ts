import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  activeTextEditorRef,
  commandHandlers,
  createTreeViewMock,
  createWebviewPanelMock,
  createStatusBarItemMock,
  executeCommandMock,
  filterStateRef,
  listLogsMock,
  loadBundleMock,
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
  deleteNoteMock,
  showInformationMessageMock,
  showInputBoxMock,
  showQuickPickMock,
  showWarningMessageMock,
  treeRefreshMock
} = vi.hoisted(() => {
  const activeTextEditorRef: { current?: unknown } = {};
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const treeRefreshMock = vi.fn();
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
  const loadBundleMock = vi.fn();
  const loadSnapshotMock = vi.fn();
  const listPendingRemindersMock = vi.fn();
  const markRemindedMock = vi.fn();
  const rescheduleReminderMock = vi.fn();
  const recordInteractionMock = vi.fn();
  const getTaskMock = vi.fn();
  const saveTaskMock = vi.fn();
  const saveNoteMock = vi.fn();
  const deleteNoteMock = vi.fn();
  const showInputBoxMock = vi.fn();
  const showQuickPickMock = vi.fn();
  const showInformationMessageMock = vi.fn();
  const showWarningMessageMock = vi.fn();
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
      })
    };
    panelState.panel = panel;
    return panel;
  });

  return {
    activeTextEditorRef,
    commandHandlers,
    createTreeViewMock,
    createWebviewPanelMock,
    createStatusBarItemMock,
    executeCommandMock,
    filterStateRef,
    listLogsMock,
    loadBundleMock,
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
    deleteNoteMock,
    showInformationMessageMock,
    showInputBoxMock,
    showQuickPickMock,
    showWarningMessageMock,
    treeRefreshMock
  };
});

vi.mock("@cortex/core", () => ({
  TASK_SEVERITIES: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  TASK_STATUSES: ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "FAILED"],
  buildTaskGraph: vi.fn(() => ({ cycles: [] }))
}));

vi.mock("vscode", () => ({
  ExtensionMode: {
    Test: 1,
    1: "Test"
  },
  ViewColumn: {
    One: 1
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
    showWarningMessage: showWarningMessageMock,
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      clear: vi.fn(),
      appendLine: vi.fn(),
      show: vi.fn()
    }))
  },
  commands: {
    registerCommand: registerCommandMock,
    executeCommand: executeCommandMock
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
      mongoUrl: "mongodb://localhost:27017",
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
    markReminded: markRemindedMock,
    recordInteraction: recordInteractionMock,
    rescheduleReminder: rescheduleReminderMock,
    getTask: getTaskMock,
    saveTask: saveTaskMock,
    saveNote: saveNoteMock,
    deleteNote: deleteNoteMock
  }))
}));

vi.mock("./tree.js", () => ({
  CortexTreeProvider: vi.fn().mockImplementation(() => ({
    refresh: treeRefreshMock
  }))
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

vi.mock("./webview/script-flow/getHtml.js", () => ({
  getScriptFlowHtml: vi.fn(() => "<html><div id=\"root\"></div><script src=\"script-flow.js\"></script></html>")
}));

import { activate } from "./extension.js";

function createContext() {
  return {
    extensionMode: 1,
    extensionUri: { fsPath: "C:\\dev\\Cortex\\apps\\vscode-extension" },
    globalStorageUri: { fsPath: "C:\\temp\\cortex-storage" },
    subscriptions: [],
    workspaceState: {
      get: vi.fn(),
      update: vi.fn()
    }
  } as never;
}

describe("activate notes commands", () => {
  beforeEach(() => {
    const scriptFlowFixturePath = "C:\\dev\\Cortex\\apps\\vscode-extension\\fixtures\\script-flow\\sample.ts";
    activeTextEditorRef.current = {
      document: {
        fileName: scriptFlowFixturePath,
        uri: { fsPath: scriptFlowFixturePath },
        languageId: "typescript",
        getText: vi.fn((selection?: { isEmpty?: boolean }) =>
          selection && !selection.isEmpty ? "const value = 1;" : "export const value = 1;"
        )
      },
      selection: {
        isEmpty: false,
        start: { line: 4, character: 2 },
        end: { line: 8, character: 18 }
      }
    };
    commandHandlers.clear();
    panelState.panel = undefined;
    panelState.messageHandler = undefined;
    panelState.disposeHandler = undefined;
    vi.clearAllMocks();
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
    listPendingRemindersMock.mockResolvedValue([]);
    markRemindedMock.mockResolvedValue(null);
    recordInteractionMock.mockResolvedValue(undefined);
    rescheduleReminderMock.mockResolvedValue(null);
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
      edges: []
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
    showInformationMessageMock.mockReset();
    showWarningMessageMock.mockReset();
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
      1,
      expect.objectContaining({ enableScripts: true })
    );
    expect(panelState.panel?.webview.html).toContain("script-flow.js");
    expect(panelState.panel?.webview.postMessage).toHaveBeenCalledWith({
      type: "scriptFlow:snapshot",
      snapshot: expect.objectContaining({
        metadata: expect.objectContaining({
          path: "fixtures/script-flow/sample.ts",
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
        parseMs: 0
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
  });
});
