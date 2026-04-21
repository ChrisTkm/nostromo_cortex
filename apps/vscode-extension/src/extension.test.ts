import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  commandHandlers,
  createTreeViewMock,
  createWebviewPanelMock,
  createStatusBarItemMock,
  executeCommandMock,
  listLogsMock,
  listNotesMock,
  listPendingRemindersMock,
  markRemindedMock,
  panelState,
  registerCommandMock,
  recordInteractionMock,
  rescheduleReminderMock,
  saveNoteMock,
  deleteNoteMock,
  showInformationMessageMock,
  showQuickPickMock,
  showWarningMessageMock,
  treeRefreshMock
} = vi.hoisted(() => {
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const treeRefreshMock = vi.fn();
  const listNotesMock = vi.fn();
  const listLogsMock = vi.fn();
  const listPendingRemindersMock = vi.fn();
  const markRemindedMock = vi.fn();
  const rescheduleReminderMock = vi.fn();
  const recordInteractionMock = vi.fn();
  const saveNoteMock = vi.fn();
  const deleteNoteMock = vi.fn();
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
    commandHandlers,
    createTreeViewMock,
    createWebviewPanelMock,
    createStatusBarItemMock,
    executeCommandMock,
    listLogsMock,
    listNotesMock,
    listPendingRemindersMock,
    markRemindedMock,
    panelState,
    registerCommandMock,
    recordInteractionMock,
    rescheduleReminderMock,
    saveNoteMock,
    deleteNoteMock,
    showInformationMessageMock,
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
    createTreeView: createTreeViewMock,
    createWebviewPanel: createWebviewPanelMock,
    createStatusBarItem: createStatusBarItemMock,
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
    getFilterState: vi.fn(() => ({
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
    })),
    updateFilterState: vi.fn().mockResolvedValue(undefined),
    listNotes: listNotesMock,
    listPendingReminders: listPendingRemindersMock,
    listLogs: listLogsMock,
    markReminded: markRemindedMock,
    recordInteraction: recordInteractionMock,
    rescheduleReminder: rescheduleReminderMock,
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
    commandHandlers.clear();
    panelState.panel = undefined;
    panelState.messageHandler = undefined;
    panelState.disposeHandler = undefined;
    vi.clearAllMocks();
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
        expect.objectContaining({ label: "Logs", command: "cortex.openLogs" })
      ])
    );
    expect(options).toEqual(expect.objectContaining({ title: "Switch Cortex panel" }));
    expect(executeCommandMock).toHaveBeenCalledWith("workbench.view.extension.cortex");
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
});
