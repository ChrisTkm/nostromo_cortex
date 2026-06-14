import {
  buildTaskGraph,
  TASK_SEVERITIES,
  TASK_STATUSES,
  type TaskDocumentInput,
  type TaskRecord,
} from "@cortex/core";
import * as os from "node:os";
import * as vscode from "vscode";

import { disposeReminderTimers, fireDue, scheduleAll } from "./reminders.js";
import { buildMdxGraphSnapshot } from "./mdGraph/indexer.js";
import type { MdxGraphSnapshot } from "./mdGraph/types.js";
import { ExtensionTaskService } from "./service.js";

import {
  isScriptFlowWebviewMessage,
  sendError,
  sendSnapshot,
  sendUnsupported,
} from "./scriptFlow/bridge.js";
import type { ScriptFlowSnapshot } from "./scriptFlow/types.js";
import { DEFAULT_FILTER_STATE } from "./state.js";
import {
  buildFilterCatalog,
  buildPlanTasks,
  buildSnapshotFilter,
  isNoteDocumentInput,
  normalizePlanStatusFilter,
  PLAN_STATUS_FILTER_KEY,
  resolveSelectedPlanCode,
  resolveSelectedTaskCode,
  sameFilterState,
  sanitizeFilterState,
  splitCsv,
  parseOptionalNumber,
  titleForPlanStatusFilter,
} from "./filterState.js";
import {
  canConnectToMongoUrl,
  formatCollectionMessage,
  migrateLegacyMongoUrlSetting,
  MONGO_URL_SECRET_KEY,
  pickConnectionSettings,
  safeList,
} from "./commands/connection.js";
import {
  handleClearFilters,
  handleSelectPlan,
  handleSetGroupFilter,
  handleSetProjectFilter,
  handleSetSearchQuery,
  handleSetTagFilter,
} from "./commands/filters.js";
import {
  pickNoteCode as pickNoteCodeFromNotes,
  pickPendingReminderCode as pickPendingReminderCodeFromNotes,
  type NoteQuickPickItem,
  type NotesPanelMode,
  type NotesPanelRequest,
} from "./commands/notes.js";
import {
  resolveArchivePlanCode,
  postArchiveList as postArchiveListToPanel,
} from "./commands/archive.js";

import type {
  ScriptFlowDelivery,
  ScriptFlowRequest,
  ScriptFlowScope,
} from "./commands/scriptFlow.js";
import { buildScriptFlowDelivery } from "./commands/scriptFlow.js";
import {
  CortexTreeProvider,
  type PlanStatusFilter,
  type TaskTreeNode,
} from "./tree.js";
import { getArchiveHtml } from "./webview/archive/getHtml.js";
import { getGraphHtml } from "./webview/html.js";
import { getLogsHtml } from "./webview/logs/getHtml.js";
import { getMdxGraphHtml } from "./webview/md-graph/getHtml.js";
import { getNotesHtml } from "./webview/notes/getHtml.js";
import { getScriptFlowHtml } from "./webview/script-flow/getHtml.js";

type OptionsQuickPickItem = vscode.QuickPickItem & { command: string };
type PanelQuickPickItem = vscode.QuickPickItem & { command: string };
let activeService: ExtensionTaskService | undefined;

function nonce() {
  return Math.random().toString(36).slice(2);
}

function setWebviewPanelIcon(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  iconName: string,
) {
  panel.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "icons",
    iconName,
  );
}

export async function activate(context: vscode.ExtensionContext) {
  await migrateLegacyMongoUrlSetting(context);
  const service = new ExtensionTaskService(context);
  activeService = service;
  service.logger.debug("activate", {
    extensionMode: vscode.ExtensionMode[context.extensionMode],
  });
  let initOk = false;
  try {
    await service.initialize();
    service.logger.debug("initialize succeeded", {});
    initOk = true;
  } catch (err) {
    service.logger.error("initialize failed (non-fatal)", { error: String(err) });
  }

  showOnboardingIfNeeded(context, service, initOk);

  const reminderStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    30,
  );
  reminderStatusBar.name = "Cortex Note Reminders";
  context.subscriptions.push(reminderStatusBar, {
    dispose: disposeReminderTimers,
  });
  await fireDue(service, reminderStatusBar, "startup");
  await scheduleAll(service, reminderStatusBar);

  let planStatusFilter = normalizePlanStatusFilter(
    context.workspaceState.get<PlanStatusFilter>(
      PLAN_STATUS_FILTER_KEY,
      "active",
    ),
  );
  const treeProvider = new CortexTreeProvider(service, planStatusFilter);
  const treeView = vscode.window.createTreeView("cortex.overview", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeView.title = titleForPlanStatusFilter(planStatusFilter);
  context.subscriptions.push(treeView);

  let graphPanel: vscode.WebviewPanel | undefined;
  let logsPanel: vscode.WebviewPanel | undefined;
  let logsPanelReady = false;
  let mdxGraphPanel: vscode.WebviewPanel | undefined;
  let mdxGraphPanelReady = false;
  let currentMdxGraphRoot: vscode.Uri | undefined;
  let currentMdxGraphSnapshot: MdxGraphSnapshot | undefined;
  let archivePanel: vscode.WebviewPanel | undefined;
  let archivePanelReady = false;
  let notesPanel: vscode.WebviewPanel | undefined;
  let notesPanelReady = false;
  let scriptFlowPanel: vscode.WebviewPanel | undefined;
  let scriptFlowPanelReady = false;
  let currentScriptFlowSnapshot: ScriptFlowSnapshot | undefined;
  let currentScriptFlowDocumentUri: vscode.Uri | undefined;
  let currentGraphOrphans: Array<{ taskCode: string; missing: string }> = [];
  const cortexOutput = vscode.window.createOutputChannel("Cortex");
  let pendingNotesMode: NotesPanelMode = "list";
  let pendingNotesSearch: string | undefined;
  let pendingScriptFlowRequest: ScriptFlowRequest = { scope: "file" };
  context.subscriptions.push(cortexOutput);

  async function postSnapshot(selectedTaskCode?: string) {
    if (!graphPanel) {
      return;
    }

    const persistedState = service.getFilterState();
    service.logger.debug("postSnapshot filterState", {
      filterState: persistedState,
    });
    const bundle = await service.loadBundle();
    service.logger.debug("postSnapshot tasks/plans", {
      taskCount: bundle.tasks.length,
      planCount: bundle.plans.length,
    });
    const availablePlanCodes = new Set(bundle.plans.map((plan) => plan.code));
    const selectedPlanCode = resolveSelectedPlanCode(
      bundle.tasks,
      persistedState,
      availablePlanCodes,
      selectedTaskCode,
    );
    const nextSelectedTaskCode = resolveSelectedTaskCode(
      bundle.tasks,
      persistedState,
      selectedPlanCode,
      selectedTaskCode,
    );
    const selectedPlan = selectedPlanCode
      ? (bundle.plans.find((plan) => plan.code === selectedPlanCode) ?? null)
      : null;
    const catalog = buildFilterCatalog(
      selectedPlanCode
        ? bundle.tasks.filter((task) => task.planCode === selectedPlanCode)
        : bundle.tasks,
    );
    const state = sanitizeFilterState(
      {
        ...persistedState,
        selectedPlanCode,
        selectedTaskCode: nextSelectedTaskCode,
      },
      catalog,
      availablePlanCodes,
    );
    if (!sameFilterState(persistedState, state)) {
      await service.updateFilterState(state);
    }

    const snapshotFilter = buildSnapshotFilter(state);
    service.logger.debug("postSnapshot snapshotFilter", {
      snapshotFilter,
    });
    const snapshot = await service.loadSnapshot(
      snapshotFilter,
      bundle,
      selectedPlan,
    );
    currentGraphOrphans = snapshot.warnings?.orphans ?? [];
    service.logger.debug("postSnapshot snapshot nodes/edges", {
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
    });

    const payload = {
      type: "snapshot",
      snapshot,
      plans: bundle.plans,
      planTasks: buildPlanTasks(bundle.plans, bundle.tasks),
      totals: {
        totalTaskCount: bundle.tasks.length,
      },
      state: {
        orientation: state.graphOrientation,
        showMiniMap: state.showMiniMap,
        selectedTaskCode: state.selectedTaskCode,
        zoom: state.zoom,
        pan: state.pan,
      },
      connection: service.getConnectionSettings(),
      filters: snapshotFilter,
      catalog,
    };

    graphPanel.webview.postMessage(payload);
    await service.recordInteraction("graph_snapshot", {
      mongo_query_count: 2,
      snapshot_node_count: snapshot.nodes.length,
      snapshot_edge_count: snapshot.edges.length,
      payload_size_bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      chained_tool_calls: 1,
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
      ...(search?.trim() ? { search: search.trim() } : {}),
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
      logs,
    });
  }

  function postArchiveList() {
    return postArchiveListToPanel(service, () => archivePanel);
  }

  async function postMdxGraphSnapshot(rootUri: vscode.Uri) {
    const panel = mdxGraphPanel;
    if (!panel) {
      return;
    }

    try {
      const maxFiles = vscode.workspace
        .getConfiguration("cortex")
        .get<number>("mdxGraphMaxFiles", 800);
      const snapshot = await buildMdxGraphSnapshot(rootUri, maxFiles);
      if (mdxGraphPanel !== panel) {
        return;
      }
      currentMdxGraphRoot = rootUri;
      currentMdxGraphSnapshot = snapshot;
      await panel.webview.postMessage({
        type: "mdxGraph:snapshot",
        snapshot,
      });
    } catch (error) {
      await panel.webview.postMessage({
        type: "mdxGraph:error",
        error: String(error),
      });
    }
  }

  async function postNotesMode(mode: NotesPanelMode) {
    const panel = notesPanel;
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "open",
      mode,
    });
  }

  async function postScriptFlowInit(request: ScriptFlowRequest) {
    const panel = scriptFlowPanel;
    if (!panel) {
      return;
    }

    currentScriptFlowSnapshot = undefined;
    currentScriptFlowDocumentUri = undefined;
    const delivery = await buildScriptFlowDelivery(request);
    if (scriptFlowPanel !== panel) {
      return;
    }

    if (delivery.type === "snapshot") {
      currentScriptFlowSnapshot = delivery.snapshot;
      currentScriptFlowDocumentUri = delivery.documentUri;
      await sendSnapshot(panel.webview, delivery.snapshot);
      await service.recordInteraction("script_flow_open", {
        lang: delivery.snapshot.metadata.language,
        nodeCount: delivery.snapshot.nodes.length,
        edgeCount: delivery.snapshot.edges.length,
        parseMs: delivery.parseMs,
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
    notesPanel = vscode.window.createWebviewPanel(
      "cortex.notes",
      "Cortex Notes",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    setWebviewPanelIcon(context, notesPanel, "cortex-notes.svg");
    notesPanel.webview.html = getNotesHtml(
      notesPanel.webview,
      context.extensionUri,
      nonce(),
    );
    notesPanel.onDidDispose(() => {
      notesPanel = undefined;
      notesPanelReady = false;
    });
    notesPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        const wasReady = notesPanelReady;
        notesPanelReady = true;
        await postNotesList(pendingNotesSearch);
        pendingNotesSearch = undefined;
        if (!wasReady) {
          await postNotesMode(pendingNotesMode);
        }
        return;
      }
      if (
        message?.type === "notes:save" &&
        isNoteDocumentInput(message.input)
      ) {
        const panel = notesPanel;
        const saved = await service.saveNote(message.input);
        if (panel && notesPanel === panel) {
          await panel.webview.postMessage({
            type: "notes:saved",
            note: saved,
          });
        }
        await refreshNotesPanel();
        await fireDue(service, reminderStatusBar, "live");
        await scheduleAll(service, reminderStatusBar);
        return;
      }
      if (
        message?.type === "notes:delete" &&
        typeof message.code === "string" &&
        message.code.trim()
      ) {
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
    logsPanel = vscode.window.createWebviewPanel(
      "cortex.logs",
      "Cortex Logs",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    setWebviewPanelIcon(context, logsPanel, "cortex-logs.svg");
    logsPanel.webview.html = getLogsHtml(
      logsPanel.webview,
      context.extensionUri,
      nonce(),
    );
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

  async function openArchivePanel() {
    if (archivePanel) {
      archivePanel.reveal(vscode.ViewColumn.One);
      if (archivePanelReady) {
        await postArchiveList();
      }
      return;
    }

    archivePanelReady = false;
    archivePanel = vscode.window.createWebviewPanel(
      "cortex.archive",
      "Cortex Archive",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    setWebviewPanelIcon(context, archivePanel, "cortex-archive.svg");
    archivePanel.webview.html = getArchiveHtml(
      archivePanel.webview,
      context.extensionUri,
      nonce(),
    );
    archivePanel.onDidDispose(() => {
      archivePanel = undefined;
      archivePanelReady = false;
    });
    archivePanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready" || message?.type === "archive:refresh") {
        archivePanelReady = true;
        await postArchiveList();
        return;
      }
      if (
        message?.type === "archive:openJson" &&
        typeof message.jsonPath === "string" &&
        message.jsonPath.trim()
      ) {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(message.jsonPath.trim()),
        );
        await vscode.window.showTextDocument(document);
      }
    });
  }

  async function openMdxGraphPanel(
    rootUri?: vscode.Uri,
    options?: { promptWhenMissing?: boolean },
  ) {
    const selectedRoot =
      rootUri ??
      currentMdxGraphRoot ??
      (await resolveConfiguredBrainRoot()) ??
      (options?.promptWhenMissing === false
        ? undefined
        : await pickMdxGraphRoot());
    if (!selectedRoot) {
      return;
    }

    if (mdxGraphPanel) {
      mdxGraphPanel.reveal(vscode.ViewColumn.One);
      if (mdxGraphPanelReady) {
        await postMdxGraphSnapshot(selectedRoot);
      } else {
        currentMdxGraphRoot = selectedRoot;
      }
      return;
    }

    currentMdxGraphRoot = selectedRoot;
    mdxGraphPanelReady = false;
    mdxGraphPanel = vscode.window.createWebviewPanel(
      "cortex.brain",
      "Cortex Brain",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    setWebviewPanelIcon(context, mdxGraphPanel, "cortex-pert.svg");
    mdxGraphPanel.webview.html = getMdxGraphHtml(
      mdxGraphPanel.webview,
      context.extensionUri,
      nonce(),
    );
    mdxGraphPanel.onDidDispose(() => {
      mdxGraphPanel = undefined;
      mdxGraphPanelReady = false;
      currentMdxGraphSnapshot = undefined;
    });
    mdxGraphPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        mdxGraphPanelReady = true;
        if (currentMdxGraphRoot) {
          await postMdxGraphSnapshot(currentMdxGraphRoot);
        }
        return;
      }
      if (message?.type === "mdxGraph:refresh") {
        if (currentMdxGraphRoot) {
          await postMdxGraphSnapshot(currentMdxGraphRoot);
        }
        return;
      }
      if (message?.type === "mdxGraph:pickFolder") {
        const picked = await pickMdxGraphRoot();
        if (picked) {
          await postMdxGraphSnapshot(picked);
        }
        return;
      }
      if (
        message?.type === "mdxGraph:openNode" &&
        typeof message.nodeId === "string"
      ) {
        const node = currentMdxGraphSnapshot?.nodes.find(
          (candidate) => candidate.id === message.nodeId,
        );
        if (node?.kind === "doc" && node.path) {
          const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(node.path),
          );
          await vscode.window.showTextDocument(
            document,
            vscode.ViewColumn.Beside,
          );
        }
      }
    });
  }

  async function openScriptFlowPanel(
    request: ScriptFlowRequest,
    options?: { forceReload?: boolean },
  ) {
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
    scriptFlowPanel = vscode.window.createWebviewPanel(
      "cortex.scriptFlow",
      "Cortex Script Flow",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    setWebviewPanelIcon(context, scriptFlowPanel, "cortex-script-flow.svg");
    scriptFlowPanel.webview.html = getScriptFlowHtml(
      scriptFlowPanel.webview,
      context.extensionUri,
      nonce(),
    );
    scriptFlowPanel.onDidDispose(() => {
      scriptFlowPanel = undefined;
      scriptFlowPanelReady = false;
      currentScriptFlowSnapshot = undefined;
      currentScriptFlowDocumentUri = undefined;
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
        await openScriptFlowPanel(pendingScriptFlowRequest, {
          forceReload: true,
        });
        return;
      }
      if (message.type === "scriptFlow:drawerClick") {
        await service.recordInteraction("script_flow_drawer_click", {
          section: message.section,
        });
        return;
      }
      if (message.type === "scriptFlow:selectNode") {
        const selectedNode = currentScriptFlowSnapshot?.nodes.find(
          (node) => node.id === message.nodeId,
        );
        if (!selectedNode) {
          return;
        }
        await service.recordInteraction("script_flow_node_select", {
          nodeId: selectedNode.id,
          kind: selectedNode.kind,
        });
        if (!currentScriptFlowDocumentUri || !selectedNode.range) {
          return;
        }
        await vscode.window.showTextDocument(currentScriptFlowDocumentUri, {
          selection: new vscode.Range(
            new vscode.Position(
              selectedNode.range.startLine - 1,
              selectedNode.range.startCol - 1,
            ),
            new vscode.Position(
              selectedNode.range.endLine - 1,
              selectedNode.range.endCol - 1,
            ),
          ),
        });
      }
    });
  }

  function pickNoteCode(options: {
    title: string;
    placeHolder: string;
    emptyMessage: string;
  }): Promise<string | undefined> {
    return pickNoteCodeFromNotes(service, options);
  }

  async function openGraph(selectedTaskCode?: string) {
    if (!graphPanel) {
      graphPanel = vscode.window.createWebviewPanel(
        "cortex.graph",
        "Cortex PERT Graph",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      setWebviewPanelIcon(context, graphPanel, "cortex-pert.svg");
      graphPanel.webview.html = getGraphHtml(
        graphPanel.webview,
        context.extensionUri,
        nonce(),
      );
      graphPanel.onDidDispose(() => {
        graphPanel = undefined;
      });
      graphPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === "ready" || message.type === "refresh") {
          await refreshView();
          return;
        }
        if (message.type === "showOrphanWarnings") {
          cortexOutput.clear();
          for (const orphan of currentGraphOrphans) {
            cortexOutput.appendLine(
              `WARN orphan dep: task=${orphan.taskCode} missing=${orphan.missing}`,
            );
          }
          cortexOutput.show(true);
          return;
        }
        if (message.type === "selectPlan") {
          if (typeof message.code === "string" && message.code.trim()) {
            await service.updateFilterState({
              selectedPlanCode: message.code.trim(),
              selectedProjects: [],
              selectedTaskCode: undefined,
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
            selectedTaskCode: undefined,
          });
          await refreshView();
          return;
        }
        if (message.type === "selectionChanged") {
          await service.updateFilterState({
            selectedTaskCode: message.selectedTaskCode,
          });
          return;
        }
        if (message.type === "selectTask") {
          await service.updateFilterState({ selectedTaskCode: message.code });
          return;
        }
        if (message.type === "updateFilter") {
          await service.updateFilterState({
            searchQuery:
              typeof message.filter?.search === "string" &&
              message.filter.search.trim()
                ? message.filter.search.trim()
                : undefined,
            selectedProjects: Array.isArray(message.filter?.project)
              ? message.filter.project
              : [],
            selectedGroups: Array.isArray(message.filter?.group)
              ? message.filter.group
              : [],
            selectedTags: Array.isArray(message.filter?.tags)
              ? message.filter.tags
              : [],
            selectedStatuses: Array.isArray(message.filter?.status)
              ? message.filter.status
              : [],
            selectedSeverities: Array.isArray(message.filter?.severity)
              ? message.filter.severity
              : [],
            selectedTaskCode: undefined,
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
            selectedPlanCode: current.selectedPlanCode,
          });
          await refreshView();
          return;
        }
        if (message.type === "editTask") {
          await editTask(message.code);
          return;
        }
        if (message.type === "orientationChanged") {
          await service.updateFilterState({
            graphOrientation: message.orientation,
          });
          return;
        }
        if (message.type === "viewportChanged") {
          await service.updateFilterState({
            zoom: message.zoom,
            pan: message.pan,
          });
          return;
        }
        if (message.type === "miniMapToggled") {
          await service.updateFilterState({
            showMiniMap: Boolean(message.showMiniMap),
          });
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
      {
        label: "Tasks",
        description: "Focus the Task Navigator sidebar",
        command: "cortex.openTasks",
      },
      {
        label: "Graph",
        description: "Open the PERT graph panel",
        command: "cortex.openGraph",
      },
      {
        label: "Notes",
        description: "Open the notes panel",
        command: "cortex.openNotes",
      },
      {
        label: "Logs",
        description: "Open the logs panel",
        command: "cortex.openLogs",
      },
      {
        label: "Archive",
        description: "Open the archived plans panel",
        command: "cortex.openArchive",
      },
      {
        label: "Brain",
        description: "Scan a markdown folder into a graph",
        command: "cortex.openBrain",
      },
      {
        label: "Script Flow",
        description: "Open the Script Flow panel",
        command: "cortex.openScriptFlow",
      },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: "Switch Cortex panel",
      placeHolder: "Choose where to go",
    });
    if (!picked) {
      return;
    }
    await vscode.commands.executeCommand(picked.command);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("cortex.openTasks", openTasks),
    vscode.commands.registerCommand("cortex.switchPanel", switchPanel),
    vscode.commands.registerCommand(
      "cortex.openGraph",
      async (arg?: string | { kind?: string; task?: { code?: string } }) => {
        const code =
          typeof arg === "string"
            ? arg
            : arg?.kind === "task"
              ? arg.task?.code
              : undefined;
        return openGraph(code);
      },
    ),
    vscode.commands.registerCommand("cortex.refresh", refreshView),
    vscode.commands.registerCommand(
      "cortex.togglePlanStatusFilter",
      async () => {
        planStatusFilter = planStatusFilter === "active" ? "done" : "active";
        await context.workspaceState.update(
          PLAN_STATUS_FILTER_KEY,
          planStatusFilter,
        );
        treeProvider.setPlanStatusFilter(planStatusFilter);
        treeView.title = titleForPlanStatusFilter(planStatusFilter);
      },
    ),
    vscode.commands.registerCommand("cortex.showOptions", async () => {
      const items: OptionsQuickPickItem[] = [
        {
          label: "Tasks",
          description: "Focus the Task Navigator sidebar",
          command: "cortex.openTasks",
        },
        {
          label: "Graph",
          description: "Open the PERT graph panel",
          command: "cortex.openGraph",
        },
        {
          label: "Notes",
          description: "Open the notes panel",
          command: "cortex.openNotes",
        },
        {
          label: "Logs",
          description: "Open the logs panel",
          command: "cortex.openLogs",
        },
        {
          label: "Archive",
          description: "Open the archived plans panel",
          command: "cortex.openArchive",
        },
        {
          label: "Brain",
          description: "Scan a markdown folder into a graph",
          command: "cortex.openBrain",
        },
        {
          label: "Script Flow",
          description: "Open the Script Flow panel",
          command: "cortex.openScriptFlow",
        },
        {
          label: "Search query",
          description: "Update search text",
          command: "cortex.setSearchQuery",
        },
        {
          label: "Tag filter",
          description: "Select task tags",
          command: "cortex.setTagFilter",
        },
        {
          label: "Project filter",
          description: "Select projects",
          command: "cortex.setProjectFilter",
        },
        {
          label: "Group filter",
          description: "Select groups",
          command: "cortex.setGroupFilter",
        },
        {
          label: "Action plan",
          description: "Select an action plan",
          command: "cortex.selectPlan",
        },
        {
          label: "Mongo database",
          description: "Select Mongo connection",
          command: "cortex.selectDatabase",
        },
        {
          label: "Bootstrap sample DB",
          description: "Create or seed local sample data",
          command: "cortex.bootstrapDatabase",
        },
        {
          label: "Clear filters",
          description: "Reset filters and plan selection",
          command: "cortex.clearFilters",
        },
        {
          label: "Dependency cycles",
          description: "Open cycle report",
          command: "cortex.listCycles",
        },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "Cortex Options",
        placeHolder: "Run a Cortex command",
      });
      if (!picked) {
        return;
      }
      await vscode.commands.executeCommand(picked.command);
    }),
    vscode.commands.registerCommand(
      "cortex.openNotes",
      async (arg?: string | { search?: string }) => {
        const search =
          typeof arg === "string"
            ? arg
            : typeof arg?.search === "string"
              ? arg.search
              : undefined;
        await openNotesPanel({
          mode: "list",
          ...(search ? { search } : {}),
        });
      },
    ),
    vscode.commands.registerCommand("cortex.openLogs", async () => {
      await openLogsPanel();
    }),
    vscode.commands.registerCommand("cortex.openArchive", async () => {
      await openArchivePanel();
    }),
    vscode.commands.registerCommand("cortex.openBrain", async () => {
      await openMdxGraphPanel(undefined, { promptWhenMissing: true });
    }),
    vscode.commands.registerCommand("cortex.openMdxGraph", async () => {
      await vscode.commands.executeCommand("cortex.openBrain");
    }),
    vscode.commands.registerCommand("cortex.openScriptFlow", async () => {
      const editor = vscode.window.activeTextEditor;
      await openScriptFlowPanel({
        scope: "file",
        ...(editor ? { documentUri: editor.document.uri } : {}),
      });
    }),
    vscode.commands.registerCommand(
      "cortex.openScriptFlowForSelection",
      async () => {
        const editor = vscode.window.activeTextEditor;
        await openScriptFlowPanel({
          scope: "selection",
          ...(editor
            ? {
                documentUri: editor.document.uri,
                selection: new vscode.Range(
                  editor.selection.start,
                  editor.selection.end,
                ),
              }
            : {}),
        });
      },
    ),
    vscode.commands.registerCommand("cortex.newNote", async () => {
      await openNotesPanel({ mode: "new" });
    }),
    vscode.commands.registerCommand(
      "cortex.editNote",
      async (arg?: string | { code?: string }) => {
        const requestedCode =
          typeof arg === "string"
            ? arg
            : typeof arg?.code === "string"
              ? arg.code
              : undefined;
        const code =
          requestedCode ??
          (await pickNoteCode({
            title: "Select a note to edit",
            placeHolder: "Choose a note code",
            emptyMessage: "No notes available to edit.",
          }));
        if (!code) {
          return;
        }
        await openNotesPanel({ mode: { type: "edit", code } });
      },
    ),
    vscode.commands.registerCommand(
      "cortex.deleteNote",
      async (arg?: string | { code?: string }) => {
        const requestedCode =
          typeof arg === "string"
            ? arg
            : typeof arg?.code === "string"
              ? arg.code
              : undefined;
        const code =
          requestedCode ??
          (await pickNoteCode({
            title: "Select a note to delete",
            placeHolder: "Choose a note code",
            emptyMessage: "No notes available to delete.",
          }));
        if (!code) {
          return;
        }

        const confirmed = await vscode.window.showWarningMessage(
          `Delete note ${code}?`,
          { modal: true },
          "Delete",
        );
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
      },
    ),
    vscode.commands.registerCommand(
      "cortex.snoozeReminder",
      async (arg?: string | { code?: string }) => {
        const requestedCode =
          typeof arg === "string"
            ? arg
            : typeof arg?.code === "string"
              ? arg.code
              : undefined;
        const code = requestedCode ?? (await pickPendingReminderCode());
        if (!code) {
          return;
        }

        const updated = await service.rescheduleReminder(
          code,
          new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        );
        if (!updated) {
          void vscode.window.showWarningMessage(`Note ${code} not found.`);
          return;
        }

        await service.recordInteraction("note_reminder_snoozed", {
          code,
          source: "command",
        });
        await refreshNotesPanel();
        await scheduleAll(service, reminderStatusBar);
        void vscode.window.showInformationMessage(
          `Reminder for ${code} moved by 1 hour.`,
        );
      },
    ),
    vscode.commands.registerCommand("cortex.setSearchQuery", () =>
      handleSetSearchQuery(service, treeProvider, postSnapshot),
    ),
    vscode.commands.registerCommand("cortex.setTagFilter", () =>
      handleSetTagFilter(service, treeProvider, postSnapshot),
    ),
    vscode.commands.registerCommand("cortex.setProjectFilter", () =>
      handleSetProjectFilter(service, treeProvider, postSnapshot),
    ),
    vscode.commands.registerCommand("cortex.setGroupFilter", () =>
      handleSetGroupFilter(service, treeProvider, postSnapshot),
    ),
    vscode.commands.registerCommand("cortex.selectPlan", () =>
      handleSelectPlan(service, treeProvider, postSnapshot),
    ),
    vscode.commands.registerCommand(
      "cortex.archivePlan",
      async (
        arg?: string | { planCode?: string; kind?: string; label?: string },
      ) => {
        const planCode = await resolveArchivePlanCode(service, arg);
        if (!planCode) {
          return;
        }

        const plan = await service.getPlan(planCode);
        if (!plan) {
          void vscode.window.showErrorMessage(`Plan ${planCode} not found.`);
          return;
        }
        if (String(plan.status).toUpperCase() !== "DONE") {
          void vscode.window.showErrorMessage(`Plan ${planCode} is not DONE.`);
          return;
        }

        try {
          const result = await service.archivePlan(planCode);
          treeProvider.refresh();
          await postSnapshot();
          const picked = await vscode.window.showInformationMessage(
            `Plan ${result.planCode} archived (${result.taskCount} tasks, ${result.noteCount} notes).`,
            "Open JSON",
          );
          if (picked === "Open JSON") {
            await vscode.commands.executeCommand(
              "vscode.open",
              vscode.Uri.file(result.jsonPath),
            );
          }
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Could not archive plan ${planCode}: ${String(error)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand("cortex.setMongoUrl", async () => {
      const current = service.getConnectionSettings();
      const input = await vscode.window.showInputBox({
        prompt: "Mongo connection string",
        value: current.mongoUrl,
        ignoreFocusOut: true,
      });
      const mongoUrl = input?.trim();
      if (!mongoUrl) {
        return;
      }

      if (!/^mongodb(\+srv)?:\/\/.+/.test(mongoUrl)) {
        void vscode.window.showErrorMessage(
          "URL inválida: debe empezar con mongodb:// o mongodb+srv://",
        );
        return;
      }

      if (!(await canConnectToMongoUrl(mongoUrl))) {
        const picked = await vscode.window.showWarningMessage(
          "No se pudo conectar. ¿Guardar igual?",
          "Guardar",
          "Cancelar",
        );
        if (picked !== "Guardar") {
          return;
        }
      }

      await service.saveMongoUrl(mongoUrl);
      treeProvider.refresh();
      void vscode.window.showInformationMessage("Mongo URL guardada.");
    }),
    vscode.commands.registerCommand("cortex.clearMongoUrl", async () => {
      await service.clearMongoUrl();
      treeProvider.refresh();
      await postSnapshot();
      void vscode.window.showInformationMessage("Cortex Mongo URL cleared.");
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
        void vscode.window.showInformationMessage(
          formatCollectionMessage("Cortex connected", picked, inspection),
        );
      } catch (error) {
        await service.updateConnectionSettings(previous);
        void vscode.window.showErrorMessage(
          `Cortex could not connect to ${picked.mongoDbName}.${picked.mongoTasksCollection}: ${String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand("cortex.bootstrapDatabase", async () => {
      const picked = await pickConnectionSettings(service, {
        title: "Create or seed a local Mongo database",
      });
      if (!picked) {
        return;
      }

      await service.bootstrapSampleDatabase(picked);
      const inspection = await service.inspectCollection(picked);
      treeProvider.refresh();
      await postSnapshot();
      void vscode.window.showInformationMessage(
        formatCollectionMessage("Sample tasks created", picked, inspection),
      );
    }),
    vscode.commands.registerCommand(
      "cortex.editTask",
      async (arg?: string | { kind?: string; task?: { code?: string } }) => {
        const code =
          typeof arg === "string"
            ? arg
            : arg?.kind === "task"
              ? arg.task?.code
              : undefined;
        await editTask(code ?? service.getFilterState().selectedTaskCode);
      },
    ),
    vscode.commands.registerCommand("cortex.clearFilters", () =>
      handleClearFilters(service, treeProvider, postSnapshot),
    ),
    vscode.commands.registerCommand("cortex.listCycles", async () => {
      const graph = buildTaskGraph(await service.loadTasks());
      if (graph.cycles.length === 0) {
        void vscode.window.showInformationMessage(
          "No dependency cycles detected.",
        );
        return;
      }
      const output = vscode.window.createOutputChannel("Cortex Cycles");
      output.clear();
      output.appendLine("Detected dependency cycles:");
      for (const cycle of graph.cycles) {
        output.appendLine(`- ${cycle.path.join(" -> ")}`);
      }
      output.show(true);
    }),
    vscode.commands.registerCommand("cortex.installSkills", async () => {
      const source = vscode.Uri.joinPath(context.extensionUri, "skills");
      const target = vscode.Uri.joinPath(
        vscode.Uri.file(os.homedir()),
        ".claude",
        "skills",
      );
      try {
        try {
          await vscode.workspace.fs.stat(target);
        } catch {
          await vscode.workspace.fs.createDirectory(target);
        }
        for (const skill of ["plan", "tareas"]) {
          const srcDir = vscode.Uri.joinPath(source, skill);
          const dstDir = vscode.Uri.joinPath(target, skill);
          await vscode.workspace.fs.createDirectory(dstDir);
          for (const file of ["SKILL.md", "skill.yaml"]) {
            const srcFile = vscode.Uri.joinPath(srcDir, file);
            const content = await vscode.workspace.fs.readFile(srcFile);
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(dstDir, file),
              content,
            );
          }
        }
        void vscode.window.showInformationMessage(
          "Skills plan/tareas installed to ~/.claude/skills/",
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to install skills: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
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
      void vscode.window.showWarningMessage(
        `Task ${selectedTaskCode} not found.`,
      );
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

const ONBOARDING_DONE_KEY = "cortex.onboardingDone";

function showOnboardingIfNeeded(
  context: vscode.ExtensionContext,
  service: ExtensionTaskService,
  initOk: boolean,
) {
  if (!context.globalState || context.globalState.get<boolean>(ONBOARDING_DONE_KEY)) {
    return;
  }

  const setUrl = "Set Mongo URL";
  const sampleDb = "Create Sample Database";
  const dismiss = "Dismiss";

  const message = initOk
    ? "Cortex is connected to MongoDB. Start by creating a sample database or configuring your own connection."
    : "Cortex needs a MongoDB connection. Set your Mongo URL or create a sample database to get started.";
  const buttons = initOk ? [sampleDb, dismiss] : [setUrl, sampleDb, dismiss];

  void context.globalState.update(ONBOARDING_DONE_KEY, true);
  if (typeof vscode.window.showInformationMessage === "function") {
    void vscode.window.showInformationMessage(message, ...buttons).then((pick) => {
      if (pick === setUrl) {
        void vscode.commands.executeCommand("cortex.setMongoUrl");
      } else if (pick === sampleDb) {
        void vscode.commands.executeCommand("cortex.bootstrapDatabase");
      }
    });
  }
}

async function pickMdxGraphRoot() {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Scan folder",
    title: "Choose a Markdown / MDX knowledge folder",
  });
  return picked?.[0];
}

async function resolveConfiguredBrainRoot() {
  const configured = vscode.workspace
    .getConfiguration("cortex")
    .get<string>("brainRootPath")
    ?.trim();
  if (!configured) {
    return undefined;
  }
  const uri = vscode.Uri.file(configured);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.Directory ? uri : undefined;
  } catch {
    void vscode.window.showWarningMessage(
      `Cortex Brain root not found: ${configured}`,
    );
    return undefined;
  }
}



async function promptForTaskEdits(
  task: TaskRecord,
): Promise<TaskDocumentInput | undefined> {
  const shortTask = await vscode.window.showInputBox({
    prompt: `Title for ${task.code}`,
    value: task.shortTask,
    ignoreFocusOut: true,
  });
  if (!shortTask) {
    return undefined;
  }

  const detail =
    (await vscode.window.showInputBox({
      prompt: `Detail for ${task.code}`,
      value: task.detail,
      ignoreFocusOut: true,
    })) ?? task.detail;

  const statusPick = await vscode.window.showQuickPick(
    [...TASK_STATUSES] as TaskDocumentInput["status"][],
    {
      title: `Status for ${task.code}`,
      placeHolder: task.status,
      ignoreFocusOut: true,
    },
  );
  if (!statusPick) {
    return undefined;
  }
  const status = statusPick as TaskDocumentInput["status"];

  const severityPick = await vscode.window.showQuickPick(
    [...TASK_SEVERITIES] as TaskDocumentInput["severity"][],
    {
      title: `Severity for ${task.code}`,
      placeHolder: task.severity,
      ignoreFocusOut: true,
    },
  );
  if (!severityPick) {
    return undefined;
  }
  const severity = severityPick as TaskDocumentInput["severity"];

  const project =
    (await vscode.window.showInputBox({
      prompt: `Project for ${task.code}`,
      value: task.project ?? "",
      ignoreFocusOut: true,
    })) ?? task.project;
  const agent =
    (await vscode.window.showInputBox({
      prompt: `Agent for ${task.code}`,
      value: task.agent,
      ignoreFocusOut: true,
    })) ?? task.agent;
  const lane =
    (await vscode.window.showInputBox({
      prompt: `Group / lane for ${task.code}`,
      value: task.lane ?? "",
      ignoreFocusOut: true,
    })) ?? task.lane;
  const durationRaw =
    (await vscode.window.showInputBox({
      prompt: `Estimated duration in hours for ${task.code}`,
      value: task.durationEstimate?.toString() ?? "",
      ignoreFocusOut: true,
    })) ?? "";
  const tagsRaw =
    (await vscode.window.showInputBox({
      prompt: `Tags for ${task.code} (comma separated)`,
      value: task.tags.join(", "),
      ignoreFocusOut: true,
    })) ?? task.tags.join(", ");
  const dependsOnRaw =
    (await vscode.window.showInputBox({
      prompt: `Dependencies for ${task.code} (comma separated task codes)`,
      value: task.dependsOn.join(", "),
      ignoreFocusOut: true,
    })) ?? task.dependsOn.join(", ");
  const sourceRef =
    (await vscode.window.showInputBox({
      prompt: `Source / reference for ${task.code}`,
      value: task.sourceRef ?? "",
      ignoreFocusOut: true,
    })) ?? task.sourceRef;
  const durationEstimate = parseOptionalNumber(durationRaw);
  if (durationRaw.trim() && durationEstimate === undefined) {
    void vscode.window.showWarningMessage(
      "Duration estimate must be a valid number.",
    );
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
    ...(typeof durationEstimate === "number"
      ? { duration_estimate: durationEstimate }
      : {}),
    ...(lane?.trim() ? { lane: lane.trim() } : {}),
    ...(typeof task.orderHint === "number"
      ? { order_hint: task.orderHint }
      : {}),
    ...(sourceRef?.trim() ? { source_ref: sourceRef.trim() } : {}),
    created_at: task.createdAt,
    updated_at: new Date().toISOString(),
  };
}

async function pickPendingReminderCode() {
  if (!activeService) {
    return undefined;
  }
  return pickPendingReminderCodeFromNotes(activeService);
}


