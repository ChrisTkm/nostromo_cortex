import {
  buildTaskGraph,
  TASK_SEVERITIES,
  TASK_STATUSES,
  type NoteDocumentInput,
  type NoteRecord,
  type TaskDocumentInput,
  type TaskFilter,
  type TaskRecord
} from "@cortex/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { disposeReminderTimers, fireDue, scheduleAll } from "./reminders.js";
import { ExtensionTaskService } from "./service.js";
import { isScriptFlowWebviewMessage, sendError, sendSnapshot, sendUnsupported } from "./scriptFlow/bridge.js";
import { isScriptFlowSnapshot, type ScriptFlowLanguage, type ScriptFlowSnapshot } from "./scriptFlow/types.js";
import { DEFAULT_FILTER_STATE } from "./state.js";
import { CortexTreeProvider, type TaskTreeNode } from "./tree.js";
import { getGraphHtml } from "./webview/html.js";
import { getLogsHtml } from "./webview/logs/getHtml.js";
import { getNotesHtml } from "./webview/notes/getHtml.js";
import { getScriptFlowHtml } from "./webview/script-flow/getHtml.js";

type ConnectionSettings = ReturnType<ExtensionTaskService["getConnectionSettings"]>;
type NoteQuickPickItem = vscode.QuickPickItem & { code: string };
type NotesPanelMode = "list" | "new" | { type: "edit"; code: string };
type NotesPanelRequest = {
  mode: NotesPanelMode;
  search?: string;
};
type PlanQuickPickItem = vscode.QuickPickItem & { planCode?: string | undefined };
type OptionsQuickPickItem = vscode.QuickPickItem & { command: string };
type PanelQuickPickItem = vscode.QuickPickItem & { command: string };
type ScriptFlowScope = "file" | "selection";
type ScriptFlowRequest = {
  scope: ScriptFlowScope;
};
type FilterCatalog = {
  projects: string[];
  groups: string[];
  tags: string[];
  statuses: string[];
  severities: string[];
};
type ScriptFlowDelivery =
  | { type: "snapshot"; snapshot: ScriptFlowSnapshot }
  | { type: "error"; error: string }
  | { type: "unsupported"; language?: string };

let activeService: ExtensionTaskService | undefined;
const SCRIPT_FLOW_LANGUAGE_BY_EXTENSION: Record<string, ScriptFlowLanguage> = {
  ".py": "python",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript"
};
const SCRIPT_FLOW_FIXTURE_RELATIVE_PATH = path.join("fixtures", "script-flow", "sample.ts");
const SCRIPT_FLOW_FIXTURE_SNAPSHOT_RELATIVE_PATH = path.join("fixtures", "script-flow", "sample.ts.snapshot.json");

function nonce() {
  return Math.random().toString(36).slice(2);
}

export async function activate(context: vscode.ExtensionContext) {
  const service = new ExtensionTaskService(context);
  activeService = service;
  service.logger.debug("activate", {
    extensionMode: vscode.ExtensionMode[context.extensionMode]
  });
  try {
    await service.initialize();
    service.logger.debug("initialize succeeded", {});
  } catch (err) {
    await service.dispose();
    activeService = undefined;
    service.logger.error("initialize failed", { error: String(err) });
    throw err;
  }

  const reminderStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
  reminderStatusBar.name = "Cortex Note Reminders";
  context.subscriptions.push(reminderStatusBar, { dispose: disposeReminderTimers });
  await fireDue(service, reminderStatusBar, "startup");
  await scheduleAll(service, reminderStatusBar);

  const treeProvider = new CortexTreeProvider(service);
  const treeView = vscode.window.createTreeView("cortex.overview", {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);

  let graphPanel: vscode.WebviewPanel | undefined;
  let logsPanel: vscode.WebviewPanel | undefined;
  let logsPanelReady = false;
  let notesPanel: vscode.WebviewPanel | undefined;
  let notesPanelReady = false;
  let scriptFlowPanel: vscode.WebviewPanel | undefined;
  let scriptFlowPanelReady = false;
  let currentScriptFlowSnapshot: ScriptFlowSnapshot | undefined;
  let pendingNotesMode: NotesPanelMode = "list";
  let pendingNotesSearch: string | undefined;
  let pendingScriptFlowRequest: ScriptFlowRequest = { scope: "file" };

  async function postSnapshot(selectedTaskCode?: string) {
    if (!graphPanel) {
      return;
    }

    const persistedState = service.getFilterState();
    service.logger.debug("postSnapshot filterState", {
      filterState: persistedState
    });
    const bundle = await service.loadBundle();
    service.logger.debug("postSnapshot tasks/plans", {
      taskCount: bundle.tasks.length,
      planCount: bundle.plans.length
    });
    const availablePlanCodes = new Set(bundle.plans.map((plan) => plan.code));
    const selectedPlanCode = resolveSelectedPlanCode(bundle.tasks, persistedState, availablePlanCodes, selectedTaskCode);
    const nextSelectedTaskCode = resolveSelectedTaskCode(bundle.tasks, persistedState, selectedPlanCode, selectedTaskCode);
    const selectedPlan = selectedPlanCode ? bundle.plans.find((plan) => plan.code === selectedPlanCode) ?? null : null;
    const catalog = buildFilterCatalog(
      selectedPlanCode ? bundle.tasks.filter((task) => task.planCode === selectedPlanCode) : bundle.tasks
    );
    const state = sanitizeFilterState(
      {
        ...persistedState,
        selectedPlanCode,
        selectedTaskCode: nextSelectedTaskCode
      },
      catalog,
      availablePlanCodes
    );
    if (!sameFilterState(persistedState, state)) {
      await service.updateFilterState(state);
    }

    const snapshotFilter = buildSnapshotFilter(state);
    service.logger.debug("postSnapshot snapshotFilter", {
      snapshotFilter
    });
    const snapshot = await service.loadSnapshot(snapshotFilter, bundle, selectedPlan);
    service.logger.debug("postSnapshot snapshot nodes/edges", {
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length
    });

    const payload = {
      type: "snapshot",
      snapshot,
      plans: bundle.plans,
      planTasks: buildPlanTasks(bundle.plans, bundle.tasks),
      totals: {
        totalTaskCount: bundle.tasks.length
      },
      state: {
        orientation: state.graphOrientation,
        showMiniMap: state.showMiniMap,
        selectedTaskCode: state.selectedTaskCode,
        zoom: state.zoom,
        pan: state.pan
      },
      connection: service.getConnectionSettings(),
      filters: snapshotFilter,
      catalog
    };

    graphPanel.webview.postMessage(payload);
    await service.recordInteraction("graph_snapshot", {
      mongo_query_count: 2,
      snapshot_node_count: snapshot.nodes.length,
      snapshot_edge_count: snapshot.edges.length,
      payload_size_bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      chained_tool_calls: 1
    });
  }

  async function refreshView() {
    treeProvider.refresh();
    await postSnapshot();
  }

  async function postNotesList(search?: string) {
    const panel = notesPanel;
    if (!panel) {
      return;
    }
    const notes = await service.listNotes();
    if (notesPanel !== panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "notes:list",
      notes,
      ...(search?.trim() ? { search: search.trim() } : {})
    });
  }

  async function postLogsList() {
    const panel = logsPanel;
    if (!panel) {
      return;
    }

    const logs = await service.listLogs();
    if (logsPanel !== panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "logs:list",
      logs
    });
  }

  async function postNotesMode(mode: NotesPanelMode) {
    const panel = notesPanel;
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "open",
      mode
    });
  }

  async function postScriptFlowInit(request: ScriptFlowRequest) {
    const panel = scriptFlowPanel;
    if (!panel) {
      return;
    }

    currentScriptFlowSnapshot = undefined;
    const delivery = await buildScriptFlowDelivery(request, context.extensionUri);
    if (scriptFlowPanel !== panel) {
      return;
    }

    if (delivery.type === "snapshot") {
      currentScriptFlowSnapshot = delivery.snapshot;
      await sendSnapshot(panel.webview, delivery.snapshot);
      await service.recordInteraction("script_flow_open", {
        lang: delivery.snapshot.metadata.language,
        nodeCount: delivery.snapshot.nodes.length,
        edgeCount: delivery.snapshot.edges.length,
        parseMs: 0
      });
      return;
    }

    if (delivery.type === "error") {
      await sendError(panel.webview, delivery.error);
      return;
    }

    await sendUnsupported(panel.webview, delivery.language);
  }

  async function refreshNotesPanel() {
    if (!notesPanel || !notesPanelReady) {
      return;
    }
    await postNotesList();
  }

  async function openNotesPanel(request: NotesPanelRequest) {
    pendingNotesMode = request.mode;
    pendingNotesSearch = request.search?.trim() || undefined;
    if (notesPanel) {
      notesPanel.reveal(vscode.ViewColumn.One);
      if (pendingNotesSearch) {
        await postNotesList(pendingNotesSearch);
        pendingNotesSearch = undefined;
      }
      await postNotesMode(request.mode);
      return;
    }

    notesPanelReady = false;
    notesPanel = vscode.window.createWebviewPanel("cortex.notes", "Cortex Notes", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    notesPanel.webview.html = getNotesHtml(notesPanel.webview, context.extensionUri, nonce());
    notesPanel.onDidDispose(() => {
      notesPanel = undefined;
      notesPanelReady = false;
    });
    notesPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        notesPanelReady = true;
        await postNotesList(pendingNotesSearch);
        pendingNotesSearch = undefined;
        await postNotesMode(pendingNotesMode);
        return;
      }
      if (message?.type === "notes:save" && isNoteDocumentInput(message.input)) {
        const panel = notesPanel;
        const saved = await service.saveNote(message.input);
        if (panel && notesPanel === panel) {
          await panel.webview.postMessage({
            type: "notes:saved",
            note: saved
          });
        }
        await refreshNotesPanel();
        await fireDue(service, reminderStatusBar, "live");
        await scheduleAll(service, reminderStatusBar);
        return;
      }
      if (message?.type === "notes:delete" && typeof message.code === "string" && message.code.trim()) {
        await service.deleteNote(message.code.trim());
        await refreshNotesPanel();
        await fireDue(service, reminderStatusBar, "live");
        await scheduleAll(service, reminderStatusBar);
      }
    });
  }

  async function openLogsPanel() {
    if (logsPanel) {
      logsPanel.reveal(vscode.ViewColumn.One);
      if (logsPanelReady) {
        await postLogsList();
      }
      return;
    }

    logsPanelReady = false;
    logsPanel = vscode.window.createWebviewPanel("cortex.logs", "Cortex Logs", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    logsPanel.webview.html = getLogsHtml(logsPanel.webview, context.extensionUri, nonce());
    logsPanel.onDidDispose(() => {
      logsPanel = undefined;
      logsPanelReady = false;
    });
    logsPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready" || message?.type === "logs:refresh") {
        logsPanelReady = true;
        await postLogsList();
      }
    });
  }

  async function openScriptFlowPanel(request: ScriptFlowRequest, options?: { forceReload?: boolean }) {
    pendingScriptFlowRequest = request;
    if (options?.forceReload && scriptFlowPanel) {
      const panel = scriptFlowPanel;
      scriptFlowPanel = undefined;
      scriptFlowPanelReady = false;
      panel.dispose();
    }

    if (scriptFlowPanel) {
      scriptFlowPanel.reveal(vscode.ViewColumn.One);
      if (scriptFlowPanelReady) {
        await postScriptFlowInit(request);
      }
      return;
    }

    scriptFlowPanelReady = false;
    scriptFlowPanel = vscode.window.createWebviewPanel("cortex.scriptFlow", "Cortex Script Flow", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    scriptFlowPanel.webview.html = getScriptFlowHtml(scriptFlowPanel.webview, context.extensionUri, nonce());
    scriptFlowPanel.onDidDispose(() => {
      scriptFlowPanel = undefined;
      scriptFlowPanelReady = false;
      currentScriptFlowSnapshot = undefined;
    });
    scriptFlowPanel.webview.onDidReceiveMessage(async (message) => {
      if (!isScriptFlowWebviewMessage(message)) {
        return;
      }
      if (message.type === "ready") {
        scriptFlowPanelReady = true;
        await postScriptFlowInit(pendingScriptFlowRequest);
        return;
      }
      if (message.type === "scriptFlow:refresh") {
        await openScriptFlowPanel(pendingScriptFlowRequest, { forceReload: true });
        return;
      }
      if (message.type === "scriptFlow:selectNode") {
        const selectedNode = currentScriptFlowSnapshot?.nodes.find((node) => node.id === message.nodeId);
        if (!selectedNode) {
          return;
        }
        await service.recordInteraction("script_flow_node_select", {
          nodeId: selectedNode.id,
          kind: selectedNode.kind
        });
      }
    });
  }

  async function pickNoteCode(options: {
    title: string;
    placeHolder: string;
    emptyMessage: string;
  }): Promise<string | undefined> {
    const notes = await service.listNotes();
    if (notes.length === 0) {
      void vscode.window.showInformationMessage(options.emptyMessage);
      return undefined;
    }

    const items: NoteQuickPickItem[] = [...notes]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((note) => ({
        label: note.code,
        description: note.title,
        ...(note.body ? { detail: note.body } : {}),
        code: note.code
      }));
    const picked = await vscode.window.showQuickPick(items, {
      title: options.title,
      placeHolder: options.placeHolder,
      matchOnDescription: true,
      matchOnDetail: true
    });
    return picked?.code;
  }

  async function openGraph(selectedTaskCode?: string) {
    if (!graphPanel) {
      graphPanel = vscode.window.createWebviewPanel("cortex.graph", "Cortex PERT Graph", vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
      });
      graphPanel.webview.html = getGraphHtml(graphPanel.webview, context.extensionUri, nonce());
      graphPanel.onDidDispose(() => {
        graphPanel = undefined;
      });
      graphPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === "ready" || message.type === "refresh") {
          await refreshView();
          return;
        }
        if (message.type === "selectPlan") {
          if (typeof message.code === "string" && message.code.trim()) {
            await service.updateFilterState({
              selectedPlanCode: message.code.trim(),
              selectedProjects: [],
              selectedTaskCode: undefined
            });
            await refreshView();
            return;
          }
          await vscode.commands.executeCommand("cortex.selectPlan");
          return;
        }
        if (message.type === "clearPlan") {
          await service.updateFilterState({
            selectedPlanCode: undefined,
            selectedTaskCode: undefined
          });
          await refreshView();
          return;
        }
        if (message.type === "selectionChanged") {
          await service.updateFilterState({ selectedTaskCode: message.selectedTaskCode });
          return;
        }
        if (message.type === "selectTask") {
          await service.updateFilterState({ selectedTaskCode: message.code });
          return;
        }
        if (message.type === "updateFilter") {
          await service.updateFilterState({
            searchQuery: typeof message.filter?.search === "string" && message.filter.search.trim() ? message.filter.search.trim() : undefined,
            selectedProjects: Array.isArray(message.filter?.project) ? message.filter.project : [],
            selectedGroups: Array.isArray(message.filter?.group) ? message.filter.group : [],
            selectedTags: Array.isArray(message.filter?.tags) ? message.filter.tags : [],
            selectedStatuses: Array.isArray(message.filter?.status) ? message.filter.status : [],
            selectedSeverities: Array.isArray(message.filter?.severity) ? message.filter.severity : [],
            selectedTaskCode: undefined
          });
          await refreshView();
          return;
        }
        if (message.type === "clearFilters") {
          const current = service.getFilterState();
          await service.updateFilterState({
            ...DEFAULT_FILTER_STATE,
            graphOrientation: current.graphOrientation,
            showMiniMap: current.showMiniMap,
            selectedPlanCode: current.selectedPlanCode
          });
          await refreshView();
          return;
        }
        if (message.type === "editTask") {
          await editTask(message.code);
          return;
        }
        if (message.type === "orientationChanged") {
          await service.updateFilterState({ graphOrientation: message.orientation });
          return;
        }
        if (message.type === "viewportChanged") {
          await service.updateFilterState({ zoom: message.zoom, pan: message.pan });
          return;
        }
        if (message.type === "miniMapToggled") {
          await service.updateFilterState({ showMiniMap: Boolean(message.showMiniMap) });
        }
      });
    }

    graphPanel.reveal(vscode.ViewColumn.One);
    await postSnapshot(selectedTaskCode);
  }

  async function openTasks() {
    await vscode.commands.executeCommand("workbench.view.extension.cortex");
  }

  async function switchPanel() {
    const items: PanelQuickPickItem[] = [
      { label: "Tasks", description: "Focus the Task Navigator sidebar", command: "cortex.openTasks" },
      { label: "Graph", description: "Open the PERT graph panel", command: "cortex.openGraph" },
      { label: "Notes", description: "Open the notes panel", command: "cortex.openNotes" },
      { label: "Logs", description: "Open the logs panel", command: "cortex.openLogs" },
      { label: "Script Flow", description: "Open the Script Flow panel", command: "cortex.openScriptFlow" }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: "Switch Cortex panel",
      placeHolder: "Choose where to go"
    });
    if (!picked) {
      return;
    }
    await vscode.commands.executeCommand(picked.command);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("cortex.openTasks", openTasks),
    vscode.commands.registerCommand("cortex.switchPanel", switchPanel),
    vscode.commands.registerCommand("cortex.openGraph", async (arg?: string | { kind?: string; task?: { code?: string } }) => {
      const code = typeof arg === "string" ? arg : arg?.kind === "task" ? arg.task?.code : undefined;
      return openGraph(code);
    }),
    vscode.commands.registerCommand("cortex.refresh", refreshView),
    vscode.commands.registerCommand("cortex.showOptions", async () => {
      const items: OptionsQuickPickItem[] = [
        { label: "Tasks", description: "Focus the Task Navigator sidebar", command: "cortex.openTasks" },
        { label: "Graph", description: "Open the PERT graph panel", command: "cortex.openGraph" },
        { label: "Notes", description: "Open the notes panel", command: "cortex.openNotes" },
        { label: "Logs", description: "Open the logs panel", command: "cortex.openLogs" },
        { label: "Script Flow", description: "Open the Script Flow panel", command: "cortex.openScriptFlow" },
        { label: "Search query", description: "Update search text", command: "cortex.setSearchQuery" },
        { label: "Tag filter", description: "Select task tags", command: "cortex.setTagFilter" },
        { label: "Project filter", description: "Select projects", command: "cortex.setProjectFilter" },
        { label: "Group filter", description: "Select groups", command: "cortex.setGroupFilter" },
        { label: "Action plan", description: "Select an action plan", command: "cortex.selectPlan" },
        { label: "Mongo database", description: "Select Mongo connection", command: "cortex.selectDatabase" },
        { label: "Bootstrap sample DB", description: "Create or seed local sample data", command: "cortex.bootstrapDatabase" },
        { label: "Clear filters", description: "Reset filters and plan selection", command: "cortex.clearFilters" },
        { label: "Dependency cycles", description: "Open cycle report", command: "cortex.listCycles" }
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "Cortex Options",
        placeHolder: "Run a Cortex command"
      });
      if (!picked) {
        return;
      }
      await vscode.commands.executeCommand(picked.command);
    }),
    vscode.commands.registerCommand("cortex.openNotes", async (arg?: string | { search?: string }) => {
      const search = typeof arg === "string" ? arg : typeof arg?.search === "string" ? arg.search : undefined;
      await openNotesPanel({
        mode: "list",
        ...(search ? { search } : {})
      });
    }),
    vscode.commands.registerCommand("cortex.openLogs", async () => {
      await openLogsPanel();
    }),
    vscode.commands.registerCommand("cortex.openScriptFlow", async () => {
      await openScriptFlowPanel({ scope: "file" });
    }),
    vscode.commands.registerCommand("cortex.openScriptFlowForSelection", async () => {
      await openScriptFlowPanel({ scope: "selection" });
    }),
    vscode.commands.registerCommand("cortex.newNote", async () => {
      await openNotesPanel({ mode: "new" });
    }),
    vscode.commands.registerCommand("cortex.editNote", async (arg?: string | { code?: string }) => {
      const requestedCode = typeof arg === "string" ? arg : typeof arg?.code === "string" ? arg.code : undefined;
      const code =
        requestedCode ??
        (await pickNoteCode({
          title: "Select a note to edit",
          placeHolder: "Choose a note code",
          emptyMessage: "No notes available to edit."
        }));
      if (!code) {
        return;
      }
      await openNotesPanel({ mode: { type: "edit", code } });
    }),
    vscode.commands.registerCommand("cortex.deleteNote", async (arg?: string | { code?: string }) => {
      const requestedCode = typeof arg === "string" ? arg : typeof arg?.code === "string" ? arg.code : undefined;
      const code =
        requestedCode ??
        (await pickNoteCode({
          title: "Select a note to delete",
          placeHolder: "Choose a note code",
          emptyMessage: "No notes available to delete."
        }));
      if (!code) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(`Delete note ${code}?`, { modal: true }, "Delete");
      if (confirmed !== "Delete") {
        return;
      }

      const deleted = await service.deleteNote(code);
      if (!deleted) {
        void vscode.window.showWarningMessage(`Note ${code} not found.`);
        return;
      }

      await refreshNotesPanel();
      await fireDue(service, reminderStatusBar, "live");
      await scheduleAll(service, reminderStatusBar);
      void vscode.window.showInformationMessage(`Note ${code} deleted.`);
    }),
    vscode.commands.registerCommand("cortex.snoozeReminder", async (arg?: string | { code?: string }) => {
      const requestedCode = typeof arg === "string" ? arg : typeof arg?.code === "string" ? arg.code : undefined;
      const code = requestedCode ?? (await pickPendingReminderCode());
      if (!code) {
        return;
      }

      const updated = await service.rescheduleReminder(code, new Date(Date.now() + 60 * 60 * 1000).toISOString());
      if (!updated) {
        void vscode.window.showWarningMessage(`Note ${code} not found.`);
        return;
      }

      await service.recordInteraction("note_reminder_snoozed", {
        code,
        source: "command"
      });
      await refreshNotesPanel();
      await scheduleAll(service, reminderStatusBar);
      void vscode.window.showInformationMessage(`Reminder for ${code} moved by 1 hour.`);
    }),
    vscode.commands.registerCommand("cortex.setSearchQuery", async () => {
      const current = service.getFilterState().searchQuery ?? "";
      const search = await vscode.window.showInputBox({
        prompt: "Search by task code or text",
        value: current
      });
      await service.updateFilterState({ searchQuery: search || undefined });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.setTagFilter", async () => {
      const tasks = await service.loadTasks();
      const tags = [...new Set(tasks.flatMap((task) => task.tags))].sort((left, right) => left.localeCompare(right));
      const picked = await vscode.window.showQuickPick(tags, {
        title: "Select task tags",
        canPickMany: true
      });
      await service.updateFilterState({ selectedTags: picked ?? [] });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.setProjectFilter", async () => {
      const tasks = await service.loadTasks();
      const projects = [...new Set(tasks.map((task) => task.project).filter(Boolean))].sort((left, right) =>
        String(left).localeCompare(String(right))
      ) as string[];
      if (projects.length === 0) {
        void vscode.window.showInformationMessage("No tasks with project field found yet.");
        return;
      }
      const picked = await vscode.window.showQuickPick(projects, {
        title: "Select projects",
        canPickMany: true
      });
      await service.updateFilterState({ selectedProjects: picked ?? [] });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.setGroupFilter", async () => {
      const tasks = await service.loadTasks();
      const groups = [...new Set(tasks.map((task) => task.lane).filter(Boolean))].sort((left, right) =>
        String(left).localeCompare(String(right))
      ) as string[];
      if (groups.length === 0) {
        void vscode.window.showInformationMessage("No task groups/lane values found yet.");
        return;
      }
      const picked = await vscode.window.showQuickPick(groups, {
        title: "Select groups",
        canPickMany: true
      });
      await service.updateFilterState({ selectedGroups: picked ?? [] });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.selectPlan", async () => {
      const plans = await service.loadPlans();
      const items: PlanQuickPickItem[] = [
        { label: "$(close) Clear plan filter" },
        ...plans.map((plan) => ({
          label: plan.code,
          description: plan.title,
          detail: `${plan.progress.done}/${plan.progress.total} done · ${plan.status}`,
          planCode: plan.code
        }))
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an action plan to focus the graph"
      });
      if (picked === undefined) {
        return;
      }
      await service.updateFilterState({ selectedPlanCode: picked.planCode });
      await refreshView();
    }),
    vscode.commands.registerCommand("cortex.selectDatabase", async () => {
      const previous = service.getConnectionSettings();
      const picked = await pickConnectionSettings(service);
      if (!picked) {
        return;
      }
      try {
        await service.updateConnectionSettings(picked);
        const inspection = await service.inspectCollection();
        treeProvider.refresh();
        await postSnapshot();
        void vscode.window.showInformationMessage(formatCollectionMessage("Cortex connected", picked, inspection));
      } catch (error) {
        await service.updateConnectionSettings(previous);
        void vscode.window.showErrorMessage(`Cortex could not connect to ${picked.mongoDbName}.${picked.mongoTasksCollection}: ${String(error)}`);
      }
    }),
    vscode.commands.registerCommand("cortex.bootstrapDatabase", async () => {
      const picked = await pickConnectionSettings(service, {
        title: "Create or seed a local Mongo database"
      });
      if (!picked) {
        return;
      }

      await service.bootstrapSampleDatabase(picked);
      const inspection = await service.inspectCollection(picked);
      treeProvider.refresh();
      await postSnapshot();
      void vscode.window.showInformationMessage(formatCollectionMessage("Sample tasks created", picked, inspection));
    }),
    vscode.commands.registerCommand("cortex.editTask", async (arg?: string | { kind?: string; task?: { code?: string } }) => {
      const code = typeof arg === "string" ? arg : arg?.kind === "task" ? arg.task?.code : undefined;
      await editTask(code ?? service.getFilterState().selectedTaskCode);
    }),
    vscode.commands.registerCommand("cortex.clearFilters", async () => {
      const current = service.getFilterState();
      await service.updateFilterState({
        ...DEFAULT_FILTER_STATE,
        graphOrientation: current.graphOrientation,
        showMiniMap: current.showMiniMap,
        selectedPlanCode: undefined
      });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.listCycles", async () => {
      const graph = buildTaskGraph(await service.loadTasks());
      if (graph.cycles.length === 0) {
        void vscode.window.showInformationMessage("No dependency cycles detected.");
        return;
      }
      const output = vscode.window.createOutputChannel("Cortex Cycles");
      output.clear();
      output.appendLine("Detected dependency cycles:");
      for (const cycle of graph.cycles) {
        output.appendLine(`- ${cycle.path.join(" -> ")}`);
      }
      output.show(true);
    })
  );

  treeView.onDidChangeSelection(async (event) => {
    const selected = event.selection[0] as TaskTreeNode | undefined;
    if (selected?.kind === "task") {
      await openGraph(selected.task.code);
    }
  });

  treeProvider.refresh();

  async function editTask(selectedTaskCode?: string) {
    if (!selectedTaskCode) {
      void vscode.window.showInformationMessage("Select a task first.");
      return;
    }

    const task = await service.getTask(selectedTaskCode);
    if (!task) {
      void vscode.window.showWarningMessage(`Task ${selectedTaskCode} not found.`);
      return;
    }

    const edited = await promptForTaskEdits(task);
    if (!edited) {
      return;
    }

    await service.saveTask(edited);
    treeProvider.refresh();
    await postSnapshot(edited.code);
    void vscode.window.showInformationMessage(`Task ${edited.code} updated.`);
  }
}

export async function deactivate() {
  disposeReminderTimers();
  await activeService?.dispose();
  activeService = undefined;
}

function buildSnapshotFilter(state: ReturnType<ExtensionTaskService["getFilterState"]>): TaskFilter {
  return {
    ...(state.selectedPlanCode ? { planCode: state.selectedPlanCode } : {}),
    ...(state.selectedProjects.length > 0 ? { project: state.selectedProjects } : {}),
    ...(state.selectedGroups.length > 0 ? { group: state.selectedGroups } : {}),
    ...(state.searchQuery ? { search: state.searchQuery } : {})
  };
}

function buildFilterCatalog(tasks: TaskRecord[]): FilterCatalog {
  return {
    projects: [...new Set(tasks.map((task) => task.project).filter(Boolean))].map(String).sort((left, right) => left.localeCompare(right)),
    groups: [...new Set(tasks.map((task) => task.lane).filter(Boolean))].map(String).sort((left, right) => left.localeCompare(right)),
    tags: [...new Set(tasks.flatMap((task) => task.tags))].sort((left, right) => left.localeCompare(right)),
    statuses: [...new Set(tasks.map((task) => task.status))].sort((left, right) => left.localeCompare(right)),
    severities: [...new Set(tasks.map((task) => task.severity))].sort((left, right) => left.localeCompare(right))
  };
}

function buildPlanTasks(plans: readonly { code: string }[], tasks: readonly TaskRecord[]) {
  const knownPlans = new Set(plans.map((plan) => plan.code));
  const grouped: Record<string, Array<{
    code: string;
    durationEstimate?: number;
    label: string;
    lane?: string;
    severity: TaskRecord["severity"];
    status: TaskRecord["status"];
  }>> = {};

  for (const task of tasks) {
    const planCode = task.planCode;
    if (!planCode || !knownPlans.has(planCode)) {
      continue;
    }
    const bucket = (grouped[planCode] ??= []);
    bucket.push({
      code: task.code,
      ...(typeof task.durationEstimate === "number" ? { durationEstimate: task.durationEstimate } : {}),
      label: task.shortTask,
      ...(task.lane ? { lane: task.lane } : {}),
      severity: task.severity,
      status: task.status
    });
  }

  for (const code of Object.keys(grouped)) {
    const bucket = grouped[code];
    if (bucket) {
      grouped[code] = bucket.sort((left, right) => left.code.localeCompare(right.code));
    }
  }

  return grouped;
}

function sanitizeFilterState(
  state: ReturnType<ExtensionTaskService["getFilterState"]>,
  catalog: FilterCatalog,
  planCodes: ReadonlySet<string>
): ReturnType<ExtensionTaskService["getFilterState"]> {
  const nextState = {
    ...state,
    selectedProjects: state.selectedProjects.filter((value) => catalog.projects.includes(value)),
    selectedGroups: state.selectedGroups.filter((value) => catalog.groups.includes(value)),
    selectedTags: state.selectedTags.filter((value) => catalog.tags.includes(value)),
    selectedStatuses: state.selectedStatuses.filter((value) => catalog.statuses.includes(value)),
    selectedSeverities: state.selectedSeverities.filter((value) => catalog.severities.includes(value))
  };

  if (state.selectedPlanCode && !planCodes.has(state.selectedPlanCode)) {
    delete nextState.selectedPlanCode;
  }

  return nextState;
}

function sameFilterState(
  left: ReturnType<ExtensionTaskService["getFilterState"]>,
  right: ReturnType<ExtensionTaskService["getFilterState"]>
) {
  return (
    left.searchQuery === right.searchQuery &&
    left.graphOrientation === right.graphOrientation &&
    left.showMiniMap === right.showMiniMap &&
    left.selectedTaskCode === right.selectedTaskCode &&
    left.selectedPlanCode === right.selectedPlanCode &&
    left.zoom === right.zoom &&
    left.pan.x === right.pan.x &&
    left.pan.y === right.pan.y &&
    sameArray(left.selectedProjects, right.selectedProjects) &&
    sameArray(left.selectedGroups, right.selectedGroups) &&
    sameArray(left.selectedTags, right.selectedTags) &&
    sameArray(left.selectedStatuses, right.selectedStatuses) &&
    sameArray(left.selectedSeverities, right.selectedSeverities)
  );
}

function resolveSelectedPlanCode(
  tasks: TaskRecord[],
  state: ReturnType<ExtensionTaskService["getFilterState"]>,
  planCodes: ReadonlySet<string>,
  nextSelectedTaskCode?: string
) {
  if (nextSelectedTaskCode) {
    const selectedTask = tasks.find((task) => task.code === nextSelectedTaskCode || task.id === nextSelectedTaskCode);
    const selectedTaskPlanCode = selectedTask?.planCode;
    return selectedTaskPlanCode && planCodes.has(selectedTaskPlanCode) ? selectedTaskPlanCode : undefined;
  }

  const current = state.selectedPlanCode;
  if (!current || !planCodes.has(current)) {
    return undefined;
  }

  if (state.selectedProjects.length > 0) {
    const hasProjectOutsidePlan = tasks.some((task) => task.project && state.selectedProjects.includes(task.project));
    const hasProjectInsidePlan = tasks.some(
      (task) => task.planCode === current && task.project && state.selectedProjects.includes(task.project)
    );
    if (hasProjectOutsidePlan && !hasProjectInsidePlan) {
      return undefined;
    }
  }

  return current;
}

function resolveSelectedTaskCode(
  tasks: TaskRecord[],
  state: ReturnType<ExtensionTaskService["getFilterState"]>,
  selectedPlanCode?: string,
  nextSelectedTaskCode?: string
) {
  const taskCode = nextSelectedTaskCode ?? state.selectedTaskCode;
  if (!taskCode) {
    return undefined;
  }

  const selectedTask = tasks.find((task) => task.code === taskCode || task.id === taskCode);
  if (!selectedTask) {
    return undefined;
  }

  if (selectedPlanCode && selectedTask.planCode !== selectedPlanCode) {
    return undefined;
  }

  return taskCode;
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function pickConnectionSettings(
  service: ExtensionTaskService,
  options?: {
    title?: string;
  }
): Promise<ConnectionSettings | undefined> {
  const current = service.getConnectionSettings();
  const mongoUrl =
    (await vscode.window.showInputBox({
      prompt: options?.title ?? "Mongo connection string",
      value: current.mongoUrl,
      ignoreFocusOut: true
    })) ?? current.mongoUrl;

  const databaseOptions = await safeList(service.listDatabaseNames.bind(service));
  const dbPick = await vscode.window.showQuickPick(
    [
      ...databaseOptions.map((database) => ({
        label: database,
        description: "existing database"
      })),
      {
        label: "$(add) Create / type a new database",
        description: "manual entry"
      }
    ],
    {
      title: "Select Mongo database",
      placeHolder: current.mongoDbName,
      ignoreFocusOut: true
    }
  );
  if (!dbPick) {
    return undefined;
  }

  const mongoDbName =
    dbPick.label === "$(add) Create / type a new database"
      ? ((await vscode.window.showInputBox({
          prompt: "Mongo database name",
          value: current.mongoDbName,
          ignoreFocusOut: true
        })) ?? current.mongoDbName)
      : dbPick.label;

  const collectionOptions = await safeList(() =>
    service.listCollectionNames({
      mongoUrl,
      mongoDbName,
      mongoTasksCollection: current.mongoTasksCollection
    })
  );
  const collectionPick = await vscode.window.showQuickPick(
    [
      ...collectionOptions.map((collection) => ({
        label: collection,
        description: "existing collection"
      })),
      {
        label: "$(add) Create / type a new collection",
        description: "manual entry"
      }
    ],
    {
      title: "Select tasks collection",
      placeHolder: current.mongoTasksCollection,
      ignoreFocusOut: true
    }
  );
  if (!collectionPick) {
    return undefined;
  }

  const mongoTasksCollection =
    collectionPick.label === "$(add) Create / type a new collection"
      ? ((await vscode.window.showInputBox({
          prompt: "Mongo tasks collection",
          value: current.mongoTasksCollection,
          ignoreFocusOut: true
        })) ?? current.mongoTasksCollection)
      : collectionPick.label;

  return {
    mongoUrl,
    mongoDbName,
    mongoTasksCollection,
    mongoPlansCollection: current.mongoPlansCollection
  };
}

async function buildScriptFlowDelivery(
  request: ScriptFlowRequest,
  extensionUri: vscode.Uri
): Promise<ScriptFlowDelivery> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return {
      type: "unsupported"
    };
  }

  const documentPath = editor.document.uri.fsPath;
  const language = resolveScriptFlowLanguage(documentPath);

  if (request.scope === "selection" && editor.selection.isEmpty) {
    return {
      type: "error",
      error: "Select a code range before opening Script Flow for the current selection."
    };
  }

  if (normalizeFsPath(documentPath) !== normalizeFsPath(path.join(extensionUri.fsPath, SCRIPT_FLOW_FIXTURE_RELATIVE_PATH))) {
    return {
      type: "unsupported",
      language: language ?? editor.document.languageId
    };
  }

  try {
    const snapshot = await loadScriptFlowFixtureSnapshot(extensionUri);
    return {
      type: "snapshot",
      snapshot
    };
  } catch (error) {
    return {
      type: "error",
      error: String(error)
    };
  }
}

async function loadScriptFlowFixtureSnapshot(extensionUri: vscode.Uri): Promise<ScriptFlowSnapshot> {
  const snapshotPath = path.join(extensionUri.fsPath, SCRIPT_FLOW_FIXTURE_SNAPSHOT_RELATIVE_PATH);
  const raw = await fs.readFile(snapshotPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isScriptFlowSnapshot(parsed)) {
    throw new Error(`Invalid Script Flow fixture snapshot: ${snapshotPath}`);
  }
  return parsed;
}

function resolveScriptFlowLanguage(fsPath: string): ScriptFlowLanguage | undefined {
  return SCRIPT_FLOW_LANGUAGE_BY_EXTENSION[path.extname(fsPath).toLowerCase()];
}

function normalizeFsPath(fsPath: string) {
  return path.normalize(fsPath).replace(/\\/g, "/").toLowerCase();
}

function formatCollectionMessage(
  prefix: string,
  settings: ConnectionSettings,
  inspection: { documentCount: number; validTaskCount: number; skippedCount: number }
) {
  if (inspection.documentCount === 0) {
    return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} is empty.`;
  }
  if (inspection.validTaskCount === 0) {
    return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} has ${inspection.documentCount} docs but 0 valid Cortex tasks.`;
  }
  if (inspection.skippedCount > 0) {
    return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} loaded ${inspection.validTaskCount} tasks and ignored ${inspection.skippedCount} non-task docs.`;
  }
  return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} loaded ${inspection.validTaskCount} tasks.`;
}

async function safeList(loader: () => Promise<string[]>) {
  try {
    return await loader();
  } catch (error) {
    void vscode.window.showWarningMessage(`Cortex could not list options automatically: ${String(error)}`);
    return [];
  }
}

async function promptForTaskEdits(task: TaskRecord): Promise<TaskDocumentInput | undefined> {
  const shortTask = await vscode.window.showInputBox({
    prompt: `Title for ${task.code}`,
    value: task.shortTask,
    ignoreFocusOut: true
  });
  if (!shortTask) {
    return undefined;
  }

  const detail =
    (await vscode.window.showInputBox({
      prompt: `Detail for ${task.code}`,
      value: task.detail,
      ignoreFocusOut: true
    })) ?? task.detail;

  const statusPick = await vscode.window.showQuickPick([...TASK_STATUSES] as TaskDocumentInput["status"][], {
    title: `Status for ${task.code}`,
    placeHolder: task.status,
    ignoreFocusOut: true
  });
  if (!statusPick) {
    return undefined;
  }
  const status = statusPick as TaskDocumentInput["status"];

  const severityPick = await vscode.window.showQuickPick([...TASK_SEVERITIES] as TaskDocumentInput["severity"][], {
    title: `Severity for ${task.code}`,
    placeHolder: task.severity,
    ignoreFocusOut: true
  });
  if (!severityPick) {
    return undefined;
  }
  const severity = severityPick as TaskDocumentInput["severity"];

  const project =
    (await vscode.window.showInputBox({
      prompt: `Project for ${task.code}`,
      value: task.project ?? "",
      ignoreFocusOut: true
    })) ?? task.project;
  const agent =
    (await vscode.window.showInputBox({
      prompt: `Agent for ${task.code}`,
      value: task.agent,
      ignoreFocusOut: true
    })) ?? task.agent;
  const lane =
    (await vscode.window.showInputBox({
      prompt: `Group / lane for ${task.code}`,
      value: task.lane ?? "",
      ignoreFocusOut: true
    })) ?? task.lane;
  const durationRaw =
    (await vscode.window.showInputBox({
      prompt: `Estimated duration in hours for ${task.code}`,
      value: task.durationEstimate?.toString() ?? "",
      ignoreFocusOut: true
    })) ?? "";
  const tagsRaw =
    (await vscode.window.showInputBox({
      prompt: `Tags for ${task.code} (comma separated)`,
      value: task.tags.join(", "),
      ignoreFocusOut: true
    })) ?? task.tags.join(", ");
  const dependsOnRaw =
    (await vscode.window.showInputBox({
      prompt: `Dependencies for ${task.code} (comma separated task codes)`,
      value: task.dependsOn.join(", "),
      ignoreFocusOut: true
    })) ?? task.dependsOn.join(", ");
  const sourceRef =
    (await vscode.window.showInputBox({
      prompt: `Source / reference for ${task.code}`,
      value: task.sourceRef ?? "",
      ignoreFocusOut: true
    })) ?? task.sourceRef;
  const durationEstimate = parseOptionalNumber(durationRaw);
  if (durationRaw.trim() && durationEstimate === undefined) {
    void vscode.window.showWarningMessage("Duration estimate must be a valid number.");
    return undefined;
  }

  return {
    code: task.code,
    ...(project?.trim() ? { project: project.trim() } : {}),
    short_task: shortTask.trim(),
    detail: detail.trim(),
    status,
    agent: agent.trim(),
    severity,
    tags: splitCsv(tagsRaw),
    depends_on: splitCsv(dependsOnRaw),
    ...(typeof durationEstimate === "number" ? { duration_estimate: durationEstimate } : {}),
    ...(lane?.trim() ? { lane: lane.trim() } : {}),
    ...(typeof task.orderHint === "number" ? { order_hint: task.orderHint } : {}),
    ...(sourceRef?.trim() ? { source_ref: sourceRef.trim() } : {}),
    created_at: task.createdAt,
    updated_at: new Date().toISOString()
  };
}

async function pickPendingReminderCode() {
  const notes = await activeService?.listNotes();
  const reminderNotes = (notes ?? []).filter((note) => note.remindAt && !note.remindedAt);
  if (reminderNotes.length === 0) {
    void vscode.window.showInformationMessage("No pending reminders available to snooze.");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    reminderNotes
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((note) => ({
        label: note.code,
        description: note.title,
        detail: note.remindAt
      })),
    {
      title: "Select a reminder to snooze",
      placeHolder: "Choose a note code",
      matchOnDescription: true,
      matchOnDetail: true
    }
  );

  return picked?.label;
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isNoteDocumentInput(value: unknown): value is NoteDocumentInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<NoteDocumentInput>;
  return typeof candidate.code === "string" && candidate.code.trim().length > 0 && typeof candidate.title === "string" && candidate.title.trim().length > 0;
}
