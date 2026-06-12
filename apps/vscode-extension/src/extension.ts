import {
  buildTaskGraph,
  criticalPathEstimate,
  createMongoAiAgentStore,
  type ActionPlanDocument,
  type NoteDocumentInput,
  type TaskDocumentInput,
  type TaskFilter,
  type TaskRecord,
} from "@cortex/core";
import { MongoClient } from "mongodb";
import path from "node:path";
import * as vscode from "vscode";

import { disposeReminderTimers, fireDue, scheduleAll } from "./reminders.js";
import { buildBrainSnapshot, createBrainCache } from "./brain/indexer.js";
import type { BrainCache } from "./brain/indexer.js";
import { createDebouncedRefresh } from "./brain/watcher.js";
import type { BrainSnapshot } from "./brain/types.js";
import {
  ExtensionTaskService,
  webviewPlanPatchToDocumentPatch,
} from "./service.js";
import { clampAutoRefreshSeconds, clampLogsLimit } from "./logs/autoRefresh.js";
import {
  analyzeScriptFlowDocument,
  clearScriptFlowCache,
  resolveScriptFlowLanguage,
} from "./scriptFlow/analyzers/index.js";
import {
  clearCrossFileCache,
  expandCrossFileImports,
} from "./scriptFlow/crossFileResolver.js";
import { SCRIPT_FLOW_GLOSSARY_MD } from "./scriptFlow/glossary.js";
import {
  isScriptFlowWebviewMessage,
  sendError,
  sendSnapshot,
  sendUnsupported,
} from "./scriptFlow/bridge.js";
import type { ScriptFlowSnapshot } from "./scriptFlow/types.js";
import { DEFAULT_FILTER_STATE } from "./state.js";
import {
  CortexTreeProvider,
  type GroupTreeNode,
  type PlanStatusFilter,
  type TaskTreeNode,
} from "./tree.js";
import { getArchiveHtml } from "./webview/archive/getHtml.js";
import { getGraphHtml } from "./webview/html.js";
import { getLogsHtml } from "./webview/logs/getHtml.js";
import { getBrainHtml } from "./webview/brain/getHtml.js";
import { getNotesHtml } from "./webview/notes/getHtml.js";
import { getScriptFlowHtml } from "./webview/script-flow/getHtml.js";
import { getTaskEditorHtml } from "./webview/task-editor/getHtml.js";
import { getPlanEditorHtml } from "./webview/plan-editor/getHtml.js";
import type { CatalogAgent } from "./webview/components/AgentSelect.js";
import { getLedgerHtml } from "./webview/ledger/getHtml.js";
import { getPlansHtml } from "./webview/plans/getHtml.js";

type ConnectionSettings = ReturnType<
  ExtensionTaskService["getConnectionSettings"]
>;
type NoteQuickPickItem = vscode.QuickPickItem & { code: string };
type NotesPanelMode = "list" | "new" | { type: "edit"; code: string };
type NotesPanelRequest = {
  mode: NotesPanelMode;
  search?: string;
};
type PlanQuickPickItem = vscode.QuickPickItem & {
  planCode?: string | undefined;
};
type OptionsQuickPickItem = vscode.QuickPickItem & { command: string };
type PanelQuickPickItem = vscode.QuickPickItem & { command: string };
type ScriptFlowScope = "file" | "selection";
type ScriptFlowRequest = {
  scope: ScriptFlowScope;
  documentUri?: vscode.Uri;
  selection?: vscode.Range;
};
type FilterCatalog = {
  projects: string[];
  groups: string[];
  tags: string[];
  statuses: string[];
  severities: string[];
};
type ScriptFlowDelivery =
  | {
      type: "snapshot";
      snapshot: ScriptFlowSnapshot;
      parseMs: number;
      documentUri: vscode.Uri;
    }
  | { type: "error"; error: string }
  | { type: "unsupported"; language?: string };

let activeService: ExtensionTaskService | undefined;
const PLAN_STATUS_FILTER_KEY = "cortex.planStatusFilter";
const MONGO_URL_SECRET_KEY = "cortex.mongoUrl";

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
  try {
    await service.initialize();
    service.logger.debug("initialize succeeded", {});
  } catch (err) {
    await service.dispose();
    activeService = undefined;
    service.logger.error("initialize failed", { error: String(err) });
    throw err;
  }

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
  let lastLogsHasMore = false;
  let logsChangeStreamCleanup: (() => Promise<void>) | null = null;
  let brainPanel: vscode.WebviewPanel | undefined;
  let brainPanelReady = false;
  let currentBrainRoot: vscode.Uri | undefined;
  let currentBrainSnapshot: BrainSnapshot | undefined;
  let brainCache: BrainCache | undefined;
  let brainWatcher: vscode.FileSystemWatcher | undefined;
  const brainRefresh = createDebouncedRefresh(() => {
    if (brainPanel && currentBrainRoot) {
      void postBrainSnapshot(currentBrainRoot);
    }
  }, 500);
  let archivePanel: vscode.WebviewPanel | undefined;
  let archivePanelReady = false;
  let notesPanel: vscode.WebviewPanel | undefined;
  let notesPanelReady = false;
  let scriptFlowPanel: vscode.WebviewPanel | undefined;
  let scriptFlowPanelReady = false;
  let taskEditorPanel: vscode.WebviewPanel | undefined;
  let taskEditorPanelReady = false;
  let ledgerPanel: vscode.WebviewPanel | undefined;
  let ledgerPanelReady = false;
  let plansPanel: vscode.WebviewPanel | undefined;
  let plansPanelReady = false;
  let currentScriptFlowSnapshot: ScriptFlowSnapshot | undefined;
  let currentScriptFlowDocumentUri: vscode.Uri | undefined;
  let currentGraphOrphans: Array<{ taskCode: string; missing: string }> = [];

  function isPathWithinRoot(
    rawPath: string,
    root: vscode.Uri | undefined,
  ): boolean {
    if (!root || typeof rawPath !== "string" || !rawPath.trim()) return false;
    const candidate = path.normalize(rawPath.trim());
    const rootPath = path.normalize(root.fsPath);
    const relative = path.relative(rootPath, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
    return true;
  }
  let pendingTaskEditorLoad:
    | { task: TaskRecord; catalogCodes: string[]; agents: CatalogAgent[] }
    | undefined;
  let planEditorPanel: vscode.WebviewPanel | undefined;
  let planEditorPanelReady = false;
  const cortexOutput = vscode.window.createOutputChannel("Cortex");
  let pendingNotesMode: NotesPanelMode = "list";
  let pendingNotesSearch: string | undefined;
  let pendingScriptFlowRequest: ScriptFlowRequest = { scope: "file" };
  context.subscriptions.push(cortexOutput, { dispose: disposeBrainWatcher });

  async function postSnapshot(selectedTaskCode?: string) {
    if (!graphPanel) {
      return;
    }

    const agentIconBase = graphPanel.webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "icons"))
      .toString();

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

    const criticalPath = criticalPathEstimate(bundle.tasks);
    service.logger.debug("criticalPath", {
      available: criticalPath.available,
      totalDuration: criticalPath.totalDuration,
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
        groupByLane: state.groupByLane,
        selectedTaskCode: state.selectedTaskCode,
        zoom: state.zoom,
        pan: state.pan,
      },
      agentIconBase,
      connection: (({ mongoUrl: _omit, ...safe }) => safe)(
        service.getConnectionSettings(),
      ),
      filters: snapshotFilter,
      criticalPath,
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

    const limit = computeLogsLimit();
    const logs = await service.listLogs(limit);
    if (logsPanel !== panel) {
      return;
    }
    lastLogsHasMore = logs.length === limit;
    await panel.webview.postMessage({
      type: "logs:list",
      logs,
      autoRefreshSeconds: clampAutoRefreshSeconds(
        vscode.workspace
          .getConfiguration("cortex")
          .get<number>("logsAutoRefreshSeconds", 0),
      ),
      hasMore: lastLogsHasMore,
    });
  }

  async function postLogsOlder(beforeTimestamp: string) {
    const panel = logsPanel;
    if (!panel) {
      return;
    }
    const limit = computeLogsLimit();
    const logs = await service.listLogs(limit, beforeTimestamp);
    if (logsPanel !== panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "logs:append",
      logs,
      hasMore: logs.length === limit,
    });
  }

  function computeLogsLimit(): number {
    return clampLogsLimit(
      vscode.workspace.getConfiguration("cortex").get<number>("logsLimit", 500),
    );
  }

  async function postArchiveList() {
    const panel = archivePanel;
    if (!panel) {
      return;
    }

    const plans = await service.listArchivedPlans();
    if (archivePanel !== panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "archive:list",
      plans,
      archivePath: service.getArchivePath(),
    });
  }

  async function postBrainSnapshot(rootUri: vscode.Uri) {
    const panel = brainPanel;
    if (!panel) {
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration("cortex");
      const maxFiles = config.get<number>("brainMaxFiles", 800);
      const accountPatternRaw = config.get<string>("brainAccountPattern", "");
      let accountPattern: RegExp | null = null;
      if (accountPatternRaw) {
        try {
          accountPattern = new RegExp(accountPatternRaw, "g");
        } catch {
          /* invalid regex — fall back to no pattern */
        }
      }
      const snapshot = await buildBrainSnapshot(rootUri, {
        maxFiles,
        accountPattern,
        cache: brainCache,
      });
      if (brainPanel !== panel) {
        return;
      }
      currentBrainRoot = rootUri;
      currentBrainSnapshot = snapshot;
      await panel.webview.postMessage({
        type: "brain:snapshot",
        snapshot,
      });
    } catch (error) {
      await panel.webview.postMessage({
        type: "brain:error",
        error: String(error),
      });
    }
  }

  function setupBrainWatcher(rootUri: vscode.Uri) {
    disposeBrainWatcher();
    const pattern = new vscode.RelativePattern(rootUri, "**/*.{md,mdx}");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(() => brainRefresh.schedule());
    watcher.onDidChange(() => brainRefresh.schedule());
    watcher.onDidDelete(() => brainRefresh.schedule());
    brainWatcher = watcher;
  }

  function disposeBrainWatcher() {
    brainRefresh.cancel();
    if (brainWatcher) {
      brainWatcher.dispose();
      brainWatcher = undefined;
    }
  }

  function clearBrainCache() {
    brainCache?.clear();
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

  const CORTEX_LOG_CONTRACT_MD = `# Cortex log execution contract

Python producers that write to the Cortex \`logs\` Mongo collection should emit one
document per log event with this shape:

\`\`\`json
{
  "execution_id": "uuid4 or null",
  "timestamp": "UTC datetime",
  "tag": "BEGIN | END | READ | INSERT | ERROR | WARNING | INFO | ...",
  "class": "LoaderClass",
  "method": "method_name",
  "title": "short human label",
  "message": "longer human message",
  "level": "INFO | WARNING | ERROR"
}
\`\`\`

\`execution_id\` is generated by \`begin_execution(class_name, method_name)\` and
stored in a \`contextvars.ContextVar\`, so logs emitted inside the same sync or
async execution span inherit it automatically. \`end_execution(execution_id,
status)\` closes the span and clears the context when it owns the active
execution.

Older logs without \`execution_id\` are valid. The Logs webview renders them in an
\`ungrouped\` section after grouped executions.
`;

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

    let logsPollTimer: ReturnType<typeof setInterval> | undefined;
    let logsPollSecs = 0;

    function startLogsPoll(seconds: number) {
      stopLogsPoll();
      if (seconds > 0 && logsPanel) {
        logsPollSecs = seconds;
        logsPollTimer = setInterval(() => {
          postLogsList();
        }, seconds * 1000);
      }
    }

    function stopLogsPoll() {
      if (logsPollTimer !== undefined) {
        clearInterval(logsPollTimer);
        logsPollTimer = undefined;
      }
      logsPollSecs = 0;
    }

    function refreshLogsPollFromConfig() {
      const cfg = vscode.workspace.getConfiguration("cortex");
      const raw = cfg.get<number>("logsAutoRefreshSeconds", 0);
      const secs = clampAutoRefreshSeconds(raw);
      if (secs !== logsPollSecs) {
        startLogsPoll(secs);
      }
    }

    async function setupLogsChangeStream() {
      if (logsChangeStreamCleanup) {
        await logsChangeStreamCleanup();
        logsChangeStreamCleanup = null;
      }
      const source = service.getLogsSource();
      if (source.subscribe) {
        const cleanup = await source.subscribe((appendedLogs) => {
          if (logsPanel) {
            logsPanel.webview.postMessage({
              type: "logs:append",
              logs: appendedLogs,
              hasMore: lastLogsHasMore,
            });
          }
        });
        if (cleanup) {
          logsChangeStreamCleanup = cleanup;
          stopLogsPoll();
        } else {
          refreshLogsPollFromConfig();
        }
      }
    }

    setupLogsChangeStream();

    const configWatcher = vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (e.affectsConfiguration("cortex.logsAutoRefreshSeconds")) {
          if (logsChangeStreamCleanup) {
            return;
          }
          refreshLogsPollFromConfig();
        }
        if (
          e.affectsConfiguration("cortex.logsSource") ||
          e.affectsConfiguration("cortex.logsFilePath") ||
          e.affectsConfiguration("cortex.logsLimit")
        ) {
          postLogsList();
        }
        if (e.affectsConfiguration("cortex.logsChangeStreams")) {
          await setupLogsChangeStream();
          postLogsList();
        }
        if (e.affectsConfiguration("cortex.brainAccountPattern")) {
          clearBrainCache();
          if (brainPanel && currentBrainRoot) {
            postBrainSnapshot(currentBrainRoot);
          }
        }
      },
    );

    const viewStateWatcher = logsPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        postLogsList();
        refreshLogsPollFromConfig();
      } else {
        stopLogsPoll();
      }
    });

    logsPanel.onDidDispose(() => {
      stopLogsPoll();
      configWatcher.dispose();
      viewStateWatcher.dispose();
      logsPanel = undefined;
      logsPanelReady = false;
      if (logsChangeStreamCleanup) {
        logsChangeStreamCleanup();
        logsChangeStreamCleanup = null;
      }
    });
    logsPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready" || message?.type === "logs:refresh") {
        logsPanelReady = true;
        await postLogsList();
        refreshLogsPollFromConfig();
        return;
      }
      if (
        message?.type === "logs:copy" &&
        typeof message.value === "string" &&
        message.value.length > 0
      ) {
        await vscode.env.clipboard.writeText(message.value);
        return;
      }
      if (message?.type === "logs:openContract") {
        const doc = await vscode.workspace.openTextDocument({
          content: CORTEX_LOG_CONTRACT_MD,
          language: "markdown",
        });
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }
      if (
        message?.type === "logs:export" &&
        (message.format === "csv" || message.format === "json") &&
        typeof message.content === "string" &&
        typeof message.defaultFilename === "string" &&
        message.defaultFilename.length > 0
      ) {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(message.defaultFilename),
          filters:
            message.format === "csv" ? { CSV: ["csv"] } : { JSON: ["json"] },
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(message.content, "utf8"),
          );
        }
        return;
      }
      if (
        message?.type === "logs:loadOlder" &&
        typeof message.beforeTimestamp === "string" &&
        message.beforeTimestamp.length > 0
      ) {
        await postLogsOlder(message.beforeTimestamp);
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
      if (message?.type === "archive:openFolder") {
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(service.getArchivePath()),
        );
        return;
      }
      if (
        message?.type === "archive:restorePlan" &&
        typeof message.planCode === "string" &&
        message.planCode.trim()
      ) {
        await vscode.commands.executeCommand(
          "cortex.restorePlan",
          message.planCode.trim(),
        );
        return;
      }
      if (
        message?.type === "archive:deletePlan" &&
        typeof message.planCode === "string" &&
        message.planCode.trim()
      ) {
        await vscode.commands.executeCommand(
          "cortex.deleteArchivedPlan",
          message.planCode.trim(),
        );
        return;
      }
      if (
        message?.type === "archive:openJson" &&
        typeof message.jsonPath === "string" &&
        message.jsonPath.trim()
      ) {
        const trimmed = message.jsonPath.trim();
        if (!service.isJsonPathInArchive(trimmed)) {
          service.logger.warn(
            "archive:openJson rejected: path outside archive root",
            { jsonPath: trimmed },
          );
          return;
        }
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(trimmed),
        );
        await vscode.window.showTextDocument(document);
      }
    });
  }

  async function openBrainPanel(
    rootUri?: vscode.Uri,
    options?: { promptWhenMissing?: boolean },
  ) {
    const selectedRoot =
      rootUri ??
      currentBrainRoot ??
      (await resolveConfiguredBrainRoot()) ??
      (options?.promptWhenMissing === false
        ? undefined
        : await pickBrainRoot());
    if (!selectedRoot) {
      return;
    }

    if (brainPanel) {
      brainPanel.reveal(vscode.ViewColumn.One);
      if (selectedRoot.fsPath !== currentBrainRoot?.fsPath) {
        clearBrainCache();
        setupBrainWatcher(selectedRoot);
      }
      if (brainPanelReady) {
        await postBrainSnapshot(selectedRoot);
      } else {
        currentBrainRoot = selectedRoot;
      }
      return;
    }

    currentBrainRoot = selectedRoot;
    if (!brainCache) brainCache = createBrainCache();
    setupBrainWatcher(selectedRoot);
    brainPanelReady = false;
    brainPanel = vscode.window.createWebviewPanel(
      "cortex.brain",
      "Cortex Brain",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    setWebviewPanelIcon(context, brainPanel, "cortex-pert.svg");
    brainPanel.webview.html = getBrainHtml(
      brainPanel.webview,
      context.extensionUri,
      nonce(),
    );
    brainPanel.onDidDispose(() => {
      disposeBrainWatcher();
      brainCache?.clear();
      brainCache = undefined;
      brainPanel = undefined;
      brainPanelReady = false;
      currentBrainSnapshot = undefined;
    });
    brainPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        brainPanelReady = true;
        if (currentBrainRoot) {
          await postBrainSnapshot(currentBrainRoot);
        }
        return;
      }
      if (message?.type === "brain:refresh") {
        if (currentBrainRoot) {
          await postBrainSnapshot(currentBrainRoot);
        }
        return;
      }
      if (message?.type === "brain:pickFolder") {
        const picked = await pickBrainRoot();
        if (picked) {
          clearBrainCache();
          currentBrainRoot = picked;
          setupBrainWatcher(picked);
          await postBrainSnapshot(picked);
        }
        return;
      }
      if (
        message?.type === "brain:openNode" &&
        typeof message.nodeId === "string"
      ) {
        const node = currentBrainSnapshot?.nodes.find(
          (candidate) => candidate.id === message.nodeId,
        );
        if (node?.kind === "doc" && node.path) {
          if (!isPathWithinRoot(node.path, currentBrainRoot)) {
            service.logger.warn(
              "brain:openNode rejected: path outside current MDX root",
              {
                nodeId: message.nodeId,
                path: node.path,
                root: currentBrainRoot?.fsPath,
              },
            );
            return;
          }
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

  async function openLedgerPanel() {
    if (ledgerPanel) {
      ledgerPanel.reveal(vscode.ViewColumn.One);
      if (ledgerPanelReady) {
        await postLedgerSnapshot();
      }
      return;
    }

    ledgerPanelReady = false;
    ledgerPanel = vscode.window.createWebviewPanel(
      "cortex.ledger",
      "Cortex Ledger",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    setWebviewPanelIcon(context, ledgerPanel, "ledge.svg");
    ledgerPanel.webview.html = getLedgerHtml(
      ledgerPanel.webview,
      context.extensionUri,
      nonce(),
    );

    ledgerPanel.onDidDispose(() => {
      ledgerPanel = undefined;
      ledgerPanelReady = false;
    });

    ledgerPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready" || message?.type === "ledger:refresh") {
        ledgerPanelReady = true;
        await postLedgerSnapshot();
        return;
      }
    });
  }

  async function postLedgerSnapshot() {
    const panel = ledgerPanel;
    if (!panel) return;
    try {
      const [runs, agents] = await Promise.all([
        service.queryAgentRuns(),
        service.listAiAgents(),
      ]);
      if (ledgerPanel !== panel) return;
      const resolvedAgents = agents.map((a) => ({
        slug: a.slug,
        name: a.displayName ?? a.slug,
        iconUri: a.iconPath
          ? panel.webview
              .asWebviewUri(agentIconUri(context.extensionUri, a.iconPath))
              .toString()
          : "",
      }));
      await panel.webview.postMessage({
        type: "ledger:snapshot",
        runs,
        agents: resolvedAgents,
      });
    } catch (err) {
      if (ledgerPanel !== panel) return;
      await panel.webview.postMessage({
        type: "ledger:error",
        message: String(err),
      });
    }
  }

  async function openPlansPanel() {
    if (plansPanel) {
      plansPanel.reveal(vscode.ViewColumn.One);
      if (plansPanelReady) {
        await postPlansSnapshot();
      }
      return;
    }

    plansPanelReady = false;
    plansPanel = vscode.window.createWebviewPanel(
      "cortex.plans",
      "Cortex Planes",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    setWebviewPanelIcon(context, plansPanel, "plans.svg");
    plansPanel.webview.html = getPlansHtml(
      plansPanel.webview,
      context.extensionUri,
      nonce(),
    );

    plansPanel.onDidDispose(() => {
      plansPanel = undefined;
      plansPanelReady = false;
    });

    plansPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready" || message?.type === "plans:refresh") {
        plansPanelReady = true;
        await postPlansSnapshot();
        return;
      }

      if (message?.type === "plans:open") {
        const code: string = message.code;
        cortexOutput.appendLine(`[Plans] Open plan: ${code}`);
        await openPlanEditorPanel(code);
        return;
      }

      if (message?.type === "plans:create") {
        const plan = message.plan as Record<string, unknown>;
        const tasks = message.tasks as Record<string, unknown>[];
        cortexOutput.appendLine(
          `[Plans] Create plan: ${String(plan.code)} with ${tasks.length} tasks`,
        );
        try {
          const planDoc: ActionPlanDocument = {
            code: String(plan.code),
            title: String(plan.title),
            description: String(plan.description ?? ""),
            goal: String(plan.goal ?? ""),
            context: String(plan.context ?? ""),
            status: "PLANNING",
            project: plan.project ? String(plan.project) : undefined,
            tags: Array.isArray(plan.tags) ? plan.tags.map(String) : [],
            progress: {
              total: tasks.length,
              pending: tasks.length,
              in_progress: 0,
              blocked: 0,
              done: 0,
              failed: 0,
            },
            current_task_code: null,
            assigned_agent: plan.assignedAgent
              ? String(plan.assignedAgent)
              : undefined,
            author: plan.author ? String(plan.author) : undefined,
            notes: `[${new Date().toISOString()}] Plan creado desde wizard PE-02`,
            completed_at: null,
          };
          const taskDocs: TaskDocumentInput[] = tasks.map(
            (t: Record<string, unknown>) => ({
              code: String(t.code),
              short_task: String(t.short_task ?? ""),
              detail: String(t.detail ?? ""),
              status: "PENDING",
              agent: String(t.agent ?? "any"),
              severity: String(t.severity ?? "MEDIUM"),
              tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
              depends_on: [],
              duration_estimate:
                typeof t.duration_estimate === "number"
                  ? t.duration_estimate
                  : undefined,
              lane: t.lane ? String(t.lane) : undefined,
              plan_code: String(plan.code),
              prompt: undefined,
              acceptance: undefined,
              out_of_scope: undefined,
            }),
          );
          const result = await service.createPlanWithTasks(planDoc, taskDocs);
          if (plansPanel === panel) {
            await panel.webview.postMessage({
              type: "plans:created",
              plan: result.plan,
              taskCount: result.taskCount,
            });
          }
          await postPlansSnapshot();
        } catch (err) {
          cortexOutput.appendLine(`[Plans] Create plan error: ${String(err)}`);
          if (plansPanel === panel) {
            await panel.webview.postMessage({
              type: "plans:error",
              message: String(err),
            });
          }
        }
        return;
      }

      if (message?.type === "plans:archive") {
        const code = message.code as string;
        try {
          await service.archivePlan(code);
        } catch (err) {
          void vscode.window.showWarningMessage(`Archive failed: ${String(err)}`);
        }
        await postPlansSnapshot();
        return;
      }

      if (message?.type === "plans:delete") {
        const code = message.code as string;
        const plan = await service.getPlan(code);
        if (!plan) {
          void vscode.window.showWarningMessage(`Plan ${code} not found.`);
          return;
        }
        const tasks = await service.loadPlanTasks(code);
        const confirmed = await vscode.window.showWarningMessage(
          `Eliminar plan ${code} y sus ${tasks.length} tasks? Esta acci\u00f3n no se puede deshacer.`,
          { modal: true },
          "Confirmar",
        );
        if (confirmed !== "Confirmar") return;
        try {
          await service.deletePlanWithTasks(code);
          if (planEditorPanel && planEditorPanel.title === `Plan: ${code}`) {
            planEditorPanel.dispose();
          }
        } catch (err) {
          void vscode.window.showWarningMessage(`Delete failed: ${String(err)}`);
        }
        await postPlansSnapshot();
        return;
      }
    });
  }

  async function postPlansSnapshot() {
    const panel = plansPanel;
    if (!panel) return;
    try {
      const [plans, rawAgents] = await Promise.all([
        service.loadPlans(),
        service.listAiAgents(),
      ]);
      if (plansPanel !== panel) return;
      const catalogAgents = mapAgentsForWebview(
        rawAgents,
        panel.webview,
        context,
      );
      const agents = rawAgents.map((a) => ({
        slug: a.slug,
        displayName: a.displayName ?? a.slug,
        iconPath: a.iconPath
          ? panel.webview
              .asWebviewUri(agentIconUri(context.extensionUri, a.iconPath))
              .toString()
          : null,
      }));
      await panel.webview.postMessage({
        type: "plans:snapshot",
        plans,
        agents,
        catalogAgents,
      });
    } catch (err) {
      if (plansPanel !== panel) return;
      await panel.webview.postMessage({
        type: "plans:error",
        message: String(err),
      });
    }
  }

  async function openPlanEditorPanel(planCode: string) {
    const plan = await service.getPlan(planCode);
    if (!plan) {
      void vscode.window.showWarningMessage(`Plan ${planCode} not found.`);
      return;
    }

    if (planEditorPanel) {
      planEditorPanel.reveal(vscode.ViewColumn.Beside);
      if (planEditorPanelReady) {
        await postPlanEditorSnapshot(planCode);
      }
      return;
    }

    planEditorPanelReady = false;
    planEditorPanel = vscode.window.createWebviewPanel(
      "cortex.planEditor",
      `Plan: ${plan.code}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    setWebviewPanelIcon(context, planEditorPanel, "plans.svg");
    planEditorPanel.webview.html = getPlanEditorHtml(
      planEditorPanel.webview,
      context.extensionUri,
      nonce(),
    );

    planEditorPanel.onDidDispose(() => {
      planEditorPanel = undefined;
      planEditorPanelReady = false;
    });

    planEditorPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        planEditorPanelReady = true;
        await postPlanEditorSnapshot(planCode);
        return;
      }

      if (message?.type === "planEditor:save") {
        const patch = webviewPlanPatchToDocumentPatch(
          message.patch as Record<string, unknown>,
        );
        const patchWithTimestamps = {
          ...patch,
          updated_at: new Date().toISOString(),
        };
        const updated = await service.updatePlan(planCode, patchWithTimestamps);
        if (!updated) {
          void vscode.window.showWarningMessage(
            `Plan ${planCode} save failed.`,
          );
          return;
        }
        const rawAgents = await service.listAiAgents();
        const agents = mapAgentsForWebview(
          rawAgents,
          planEditorPanel?.webview,
          context,
        );
        await planEditorPanel?.webview.postMessage({
          type: "planEditor:saved",
          plan: updated,
          agents,
        });
        await postPlansSnapshot();
        void vscode.window.showInformationMessage(`Plan ${planCode} updated.`);
        return;
      }

      if (message?.type === "planEditor:appendNote") {
        const text = message.text as string;
        if (!text) return;
        const updated = await service.appendPlanNote(planCode, text);
        if (!updated) {
          void vscode.window.showWarningMessage(
            `Plan ${planCode} append note failed.`,
          );
          return;
        }
        const rawAgents = await service.listAiAgents();
        const agents = mapAgentsForWebview(
          rawAgents,
          planEditorPanel?.webview,
          context,
        );
        await planEditorPanel?.webview.postMessage({
          type: "planEditor:appended",
          plan: updated,
          agents,
        });
        void vscode.window.showInformationMessage(
          `Note appended to ${planCode}.`,
        );
        return;
      }

      if (message?.type === "planEditor:viewGraph") {
        const pCode = message.planCode as string;
        cortexOutput.appendLine(`[PlanEditor] View graph for plan: ${pCode}`);
        await service.updateFilterState({ selectedPlanCode: pCode });
        await openGraph();
        await refreshView();
        return;
      }

      if (message?.type === "planEditor:bulkStatus") {
        const codes = message.codes as string[];
        const status = message.status as string;
        try {
          await service.bulkUpdateTaskStatus(planCode, codes, status);
          await postPlanEditorSnapshot(planCode);
          await postPlansSnapshot();
        } catch (err) {
          void vscode.window.showWarningMessage(
            `Bulk status update failed: ${String(err)}`,
          );
        }
        return;
      }

      if (message?.type === "planEditor:bulkAgent") {
        const codes = message.codes as string[];
        const agent = message.agent as string;
        try {
          await service.bulkUpdateTaskAgent(planCode, codes, agent);
          await postPlanEditorSnapshot(planCode);
          await postPlansSnapshot();
        } catch (err) {
          void vscode.window.showWarningMessage(
            `Bulk agent update failed: ${String(err)}`,
          );
        }
        return;
      }

      if (message?.type === "planEditor:bulkMove") {
        const codes = message.codes as string[];
        const targetPlanCode = message.targetPlanCode as string;
        try {
          await service.bulkMoveTasksToPlan(codes, targetPlanCode);
          await postPlanEditorSnapshot(planCode);
          await postPlansSnapshot();
        } catch (err) {
          void vscode.window.showWarningMessage(
            `Bulk move failed: ${String(err)}`,
          );
        }
        return;
      }

      if (message?.type === "planEditor:bulkDelete") {
        const codes = message.codes as string[];
        const confirmed = await vscode.window.showWarningMessage(
          `Delete ${codes.length} task(s) from ${planCode}? This cannot be undone.`,
          { modal: true },
          "Confirmar",
        );
        if (confirmed !== "Confirmar") return;
        try {
          await service.bulkDeleteTasks(planCode, codes);
          await postPlanEditorSnapshot(planCode);
          await postPlansSnapshot();
        } catch (err) {
          void vscode.window.showWarningMessage(
            `Bulk delete failed: ${String(err)}`,
          );
        }
        return;
      }
    });
  }

  async function postPlanEditorSnapshot(planCode: string) {
    const panel = planEditorPanel;
    if (!panel) return;
    try {
      const [plan, rawAgents, tasks, allPlans] = await Promise.all([
        service.getPlan(planCode),
        service.listAiAgents(),
        service.loadPlanTasks(planCode),
        service.loadPlans(),
      ]);
      if (planEditorPanel !== panel) return;
      if (!plan) {
        await panel.webview.postMessage({
          type: "planEditor:error",
          message: `Plan ${planCode} not found.`,
        });
        return;
      }
      const agents = mapAgentsForWebview(rawAgents, panel.webview, context);
      await panel.webview.postMessage({
        type: "planEditor:load",
        plan,
        agents,
        tasks,
        allPlans,
      });
    } catch (err) {
      if (planEditorPanel !== panel) return;
      await panel.webview.postMessage({
        type: "planEditor:error",
        message: String(err),
      });
    }
  }

  async function openScriptFlowPanel(request: ScriptFlowRequest) {
    pendingScriptFlowRequest = request;

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
        await postScriptFlowInit(pendingScriptFlowRequest);
        return;
      }
      if (message.type === "scriptFlow:openGlossary") {
        const doc = await vscode.workspace.openTextDocument({
          content: SCRIPT_FLOW_GLOSSARY_MD,
          language: "markdown",
        });
        await vscode.window.showTextDocument(doc, { preview: false });
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
        code: note.code,
      }));
    const picked = await vscode.window.showQuickPick(items, {
      title: options.title,
      placeHolder: options.placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return picked?.code;
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
        if (message.type === "toggleGroupByLane") {
          await service.updateFilterState({
            groupByLane: Boolean(message.groupByLane),
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
      {
        label: "Ledger",
        description: "Open the runs ledger panel",
        command: "cortex.openLedger",
      },
      {
        label: "Planes",
        description: "Open the plans panel",
        command: "cortex.openPlans",
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
          label: "Ledger",
          description: "Open the runs ledger panel",
          command: "cortex.openLedger",
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
      await openBrainPanel(undefined, { promptWhenMissing: true });
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
    vscode.commands.registerCommand("cortex.setSearchQuery", async () => {
      const current = service.getFilterState().searchQuery ?? "";
      const search = await vscode.window.showInputBox({
        prompt: "Search by task code or text",
        value: current,
      });
      await service.updateFilterState({ searchQuery: search || undefined });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.setTagFilter", async () => {
      const tasks = await service.loadTasks();
      const tags = [...new Set(tasks.flatMap((task) => task.tags))].sort(
        (left, right) => left.localeCompare(right),
      );
      const picked = await vscode.window.showQuickPick(tags, {
        title: "Select task tags",
        canPickMany: true,
      });
      await service.updateFilterState({ selectedTags: picked ?? [] });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.setProjectFilter", async () => {
      const tasks = await service.loadTasks();
      const projects = [
        ...new Set(tasks.map((task) => task.project).filter(Boolean)),
      ].sort((left, right) =>
        String(left).localeCompare(String(right)),
      ) as string[];
      if (projects.length === 0) {
        void vscode.window.showInformationMessage(
          "No tasks with project field found yet.",
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(projects, {
        title: "Select projects",
        canPickMany: true,
      });
      await service.updateFilterState({ selectedProjects: picked ?? [] });
      treeProvider.refresh();
      await postSnapshot();
    }),
    vscode.commands.registerCommand("cortex.setGroupFilter", async () => {
      const tasks = await service.loadTasks();
      const groups = [
        ...new Set(tasks.map((task) => task.lane).filter(Boolean)),
      ].sort((left, right) =>
        String(left).localeCompare(String(right)),
      ) as string[];
      if (groups.length === 0) {
        void vscode.window.showInformationMessage(
          "No task groups/lane values found yet.",
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(groups, {
        title: "Select groups",
        canPickMany: true,
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
          planCode: plan.code,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an action plan to focus the graph",
      });
      if (picked === undefined) {
        return;
      }
      await service.updateFilterState({ selectedPlanCode: picked.planCode });
      await refreshView();
    }),
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
    vscode.commands.registerCommand(
      "cortex.restorePlan",
      async (
        arg?: string | { planCode?: string; kind?: string; label?: string },
      ) => {
        const planCode = await resolveArchivePlanCode(service, arg);
        if (!planCode) {
          return;
        }

        const confirmed = await vscode.window.showWarningMessage(
          `Restore plan ${planCode}? This will move the archived data back to the active collections. The JSON snapshot on disk will be kept as a backup.`,
          { modal: true },
          "Restore",
        );
        if (confirmed !== "Restore") return;

        try {
          const result = await service.restorePlan(planCode);
          treeProvider.refresh();
          await postSnapshot();
          await postArchiveList();
          void vscode.window.showInformationMessage(
            `Plan ${result.planCode} restored (${result.taskCount} tasks, ${result.noteCount} notes). JSON snapshot kept on disk.`,
          );
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Could not restore plan ${planCode}: ${String(error)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "cortex.deleteArchivedPlan",
      async (
        arg?: string | { planCode?: string; kind?: string; label?: string },
      ) => {
        const planCode = await resolveArchivePlanCode(service, arg);
        if (!planCode) return;

        const KEEP = "Delete (keep JSON)";
        const ALL = "Delete all (incl. JSON)";
        const choice = await vscode.window.showWarningMessage(
          `Delete archived plan ${planCode} permanently? This removes the archived_plans/tasks/notes documents from Mongo. The JSON snapshot can be kept on disk as a backup or deleted with the data.`,
          { modal: true },
          KEEP,
          ALL,
        );
        if (choice !== KEEP && choice !== ALL) return;
        const keepJson = choice === KEEP;

        try {
          const result = await service.deleteArchivedPlan(planCode, {
            keepJson,
          });
          treeProvider.refresh();
          await postSnapshot();
          await postArchiveList();
          void vscode.window.showInformationMessage(
            `Archived plan ${result.planCode} deleted (${result.taskCount} tasks, ${result.noteCount} notes${result.jsonDeleted ? ", JSON deleted" : ", JSON kept"}).`,
          );
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Could not delete archived plan ${planCode}: ${String(error)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand("cortex.exportArchive", async () => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const defaultUri = vscode.Uri.file(
        path.join(
          service.getArchivePath(),
          `cortex-archive-export-${stamp}.zip`,
        ),
      );
      const target = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { "ZIP archive": ["zip"] },
        title: "Export Cortex Archive",
      });
      if (!target) return;

      try {
        const result = await service.exportArchive(target.fsPath);
        void vscode.window.showInformationMessage(
          `Exported ${result.planCount} archived plan(s) to ${result.zipPath}.`,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Could not export archive: ${String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand("cortex.importArchive", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "ZIP archive": ["zip"] },
        title: "Import Cortex Archive",
      });
      if (!picked || picked.length === 0) return;

      try {
        const result = await service.importArchive(picked[0].fsPath);
        treeProvider.refresh();
        await postSnapshot();
        await postArchiveList();
        const parts = [
          `${result.imported.length} imported`,
          result.skipped.length > 0 ? `${result.skipped.length} skipped` : null,
          result.failed.length > 0 ? `${result.failed.length} failed` : null,
        ]
          .filter(Boolean)
          .join(", ");
        void vscode.window.showInformationMessage(`Archive import: ${parts}.`);
        if (result.failed.length > 0) {
          service.logger.warn("importArchive failures", {
            failed: result.failed,
          });
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Could not import archive: ${String(error)}`,
        );
      }
    }),
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
    vscode.commands.registerCommand(
      "cortex.newTask",
      async (arg?: {
        kind?: string;
        task?: { code?: string; planCode?: string; lane?: string };
        planCode?: string;
      }) => {
        await createNewTask(arg);
      },
    ),
    vscode.commands.registerCommand("cortex.clearFilters", async () => {
      const current = service.getFilterState();
      await service.updateFilterState({
        ...DEFAULT_FILTER_STATE,
        graphOrientation: current.graphOrientation,
        showMiniMap: current.showMiniMap,
        selectedPlanCode: undefined,
      });
      treeProvider.refresh();
      await postSnapshot();
    }),
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
    vscode.commands.registerCommand(
      "cortex.markDone",
      async (
        arg?: TaskTreeNode | { kind?: string; task?: { code?: string } },
      ) => {
        await markTaskStatus(arg, "DONE");
      },
    ),
    vscode.commands.registerCommand(
      "cortex.markInProgress",
      async (
        arg?: TaskTreeNode | { kind?: string; task?: { code?: string } },
      ) => {
        await markTaskStatus(arg, "IN_PROGRESS");
      },
    ),
    vscode.commands.registerCommand(
      "cortex.markBlocked",
      async (
        arg?: TaskTreeNode | { kind?: string; task?: { code?: string } },
      ) => {
        await markTaskStatus(arg, "BLOCKED");
      },
    ),
    vscode.commands.registerCommand("cortex.setAiAgentIcon", async () => {
      const settings = service.getConnectionSettings();
      const store = createMongoAiAgentStore({
        mongoUrl: settings.mongoUrl,
        dbName: settings.mongoDbName,
        collectionName: "ai_agents",
      });

      try {
        const agents = await store.listAgents();
        if (agents.length === 0) {
          void vscode.window.showInformationMessage(
            "No AI agents found in the database. Run seed first.",
          );
          return;
        }

        const pick = await vscode.window.showQuickPick(
          agents.map((a) => ({
            label: a.displayName,
            description: a.slug,
            detail: a.iconPath ? `Icon: ${a.iconPath}` : "No icon set",
          })),
          { placeHolder: "Select an AI agent to set its icon" },
        );

        if (!pick) return;

        const agent = agents.find((a) => a.slug === pick.description);
        if (!agent) return;

        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "SVG files": ["svg"] },
          title: `Select icon for ${agent.displayName}`,
        });

        if (!uris || uris.length === 0) return;

        const srcPath = uris[0].fsPath;
        const extPath = vscode.extensions.getExtension(
          "cortex.vscode-extension",
        )?.extensionPath;
        if (!extPath) {
          void vscode.window.showErrorMessage(
            "Could not resolve extension path.",
          );
          return;
        }

        const iconDir = path.join(extPath, "media", "icons");
        const iconName = `${agent.slug}.svg`;
        const destPath = path.join(iconDir, iconName);

        const fs = await import("node:fs/promises");
        await fs.mkdir(iconDir, { recursive: true });
        await fs.copyFile(srcPath, destPath);

        await store.updateIcon(agent.slug, iconName);
        void vscode.window.showInformationMessage(
          `Icon for ${agent.displayName} updated to ${iconName}`,
        );
      } finally {
        await store.close();
      }
    }),
    vscode.commands.registerCommand("cortex.openLedger", async () => {
      await openLedgerPanel();
    }),
    vscode.commands.registerCommand("cortex.openPlans", async () => {
      await openPlansPanel();
    }),
    vscode.commands.registerCommand(
      "cortex.openPlanEditor",
      async (args?: { code?: string }) => {
        const code = args?.code;
        if (!code) {
          void vscode.window.showInformationMessage("Plan code required.");
          return;
        }
        await openPlanEditorPanel(code);
      },
    ),
  );

  treeView.onDidChangeSelection(async (event) => {
    const selected = event.selection[0] as TaskTreeNode | undefined;
    if (selected?.kind === "task") {
      await openGraph(selected.task.code);
    }
  });

  treeProvider.refresh();

  async function markTaskStatus(
    arg: TaskTreeNode | { kind?: string; task?: { code?: string } } | undefined,
    newStatus: TaskRecord["status"],
  ) {
    const code =
      arg?.kind === "task"
        ? (arg as TaskTreeNode).task.code
        : service.getFilterState().selectedTaskCode;
    if (!code) {
      void vscode.window.showInformationMessage("Select a task first.");
      return;
    }

    const task = await service.getTask(code);
    if (!task) {
      void vscode.window.showWarningMessage(`Task ${code} not found.`);
      return;
    }

    await service.saveTask({
      code: task.code,
      short_task: task.shortTask,
      detail: task.detail,
      status: newStatus,
      agent: task.agent,
      severity: task.severity,
      created_at: task.createdAt,
      updated_at: new Date().toISOString(),
    });
    treeProvider.refresh();
    await postSnapshot(task.code);
    void vscode.window.showInformationMessage(
      `Task ${task.code} marked as ${newStatus.toLowerCase().replace("_", " ")}.`,
    );
  }

  async function createNewTask(arg?: {
    kind?: string;
    task?: { code?: string; planCode?: string; lane?: string };
    planCode?: string;
  }) {
    const filterState = service.getFilterState();

    // Resolve context from arg (tree selection) or active filter state
    let contextPlanCode: string | undefined;
    let contextLane: string | undefined;

    if (arg?.kind === "task" && arg.task) {
      contextPlanCode = arg.task.planCode;
      contextLane = arg.task.lane;
    } else if (arg?.kind === "group") {
      contextPlanCode = arg.planCode;
    } else {
      contextPlanCode = filterState.selectedPlanCode;
      if (filterState.selectedTaskCode) {
        const selectedTask = await service.getTask(
          filterState.selectedTaskCode,
        );
        contextLane = selectedTask?.lane;
      }
    }

    // Load bundle once for both code uniqueness check and plan list
    const bundle = await service.loadBundle();
    const existingCodes = new Set(bundle.tasks.map((t) => t.code));

    // Step 1 – code
    const codeRaw = await vscode.window.showInputBox({
      title: "New Cortex task",
      prompt: "Task code (must be unique)",
      placeHolder: "TASK-123",
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return "Code cannot be empty.";
        }
        if (existingCodes.has(trimmed)) {
          return `Code "${trimmed}" already exists.`;
        }
        return undefined;
      },
    });
    const code = codeRaw?.trim();
    if (!code) {
      return;
    }

    // Belt-and-suspenders uniqueness guard (validates after confirm)
    if (existingCodes.has(code)) {
      void vscode.window.showWarningMessage(
        `Task code "${code}" already exists.`,
      );
      return;
    }

    // Step 2 – title
    const shortTaskRaw = await vscode.window.showInputBox({
      title: "New Cortex task",
      prompt: `Title for ${code}`,
      placeHolder: "Short task description",
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim() ? undefined : "Title cannot be empty.",
    });
    const shortTask = shortTaskRaw?.trim();
    if (!shortTask) {
      return;
    }

    // Step 3 – plan (optional)
    const plans = await service.loadPlans();
    type PlanPickItem = vscode.QuickPickItem & { planCode?: string };
    const noPlanItem: PlanPickItem = { label: "$(close) No plan" };
    const planItems: PlanPickItem[] = plans.map((plan) => ({
      label: plan.code,
      description: plan.title,
      detail: `${plan.progress.done}/${plan.progress.total} done · ${plan.status}`,
      planCode: plan.code,
    }));

    // Surface the contextually active plan first
    if (contextPlanCode) {
      planItems.sort((a, b) => {
        if (a.planCode === contextPlanCode) {
          return -1;
        }
        if (b.planCode === contextPlanCode) {
          return 1;
        }
        return 0;
      });
    }

    const pickedPlan = await vscode.window.showQuickPick<PlanPickItem>(
      [noPlanItem, ...planItems],
      {
        title: `Plan for ${code}`,
        placeHolder: contextPlanCode
          ? `Active: ${contextPlanCode}`
          : "Select a plan (optional)",
        ignoreFocusOut: true,
      },
    );
    if (pickedPlan === undefined) {
      return;
    }

    // Read default agent from settings
    const defaultAgent =
      vscode.workspace
        .getConfiguration("cortex")
        .get<string>("defaultAgent")
        ?.trim() || "any";

    const now = new Date().toISOString();
    await service.saveTask({
      code,
      short_task: shortTask,
      detail: "",
      status: "PENDING",
      severity: "MEDIUM",
      agent: defaultAgent,
      tags: [],
      depends_on: [],
      ...(pickedPlan.planCode ? { plan_code: pickedPlan.planCode } : {}),
      ...(contextLane ? { lane: contextLane } : {}),
      created_at: now,
      updated_at: now,
    });

    treeProvider.refresh();
    await postSnapshot(code);
    void vscode.window.showInformationMessage(`Task ${code} created.`);
  }

  async function openTaskEditorPanel(
    task: TaskRecord,
    catalogCodes: string[],
    agents: CatalogAgent[],
  ) {
    pendingTaskEditorLoad = { task, catalogCodes, agents };

    if (taskEditorPanel) {
      taskEditorPanel.reveal(vscode.ViewColumn.Beside);
      if (taskEditorPanelReady) {
        await taskEditorPanel.webview.postMessage({
          type: "taskEditor:load",
          task,
          catalog: { taskCodes: catalogCodes, agents },
        });
        pendingTaskEditorLoad = undefined;
      }
      return;
    }

    taskEditorPanelReady = false;
    taskEditorPanel = vscode.window.createWebviewPanel(
      "cortex.taskEditor",
      `Edit: ${task.code}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    taskEditorPanel.webview.html = getTaskEditorHtml(
      taskEditorPanel.webview,
      context.extensionUri,
      nonce(),
    );

    taskEditorPanel.onDidDispose(() => {
      taskEditorPanel = undefined;
      taskEditorPanelReady = false;
      pendingTaskEditorLoad = undefined;
    });

    taskEditorPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        taskEditorPanelReady = true;
        if (pendingTaskEditorLoad) {
          await taskEditorPanel?.webview.postMessage({
            type: "taskEditor:load",
            task: pendingTaskEditorLoad.task,
            catalog: {
              taskCodes: pendingTaskEditorLoad.catalogCodes,
              agents: pendingTaskEditorLoad.agents,
            },
          });
          pendingTaskEditorLoad = undefined;
        }
        return;
      }

      if (
        message?.type === "taskEditor:save" &&
        isTaskDocumentInput(message.input)
      ) {
        await service.saveTask(message.input);
        treeProvider.refresh();
        await postSnapshot(message.input.code);
        void vscode.window.showInformationMessage(
          `Task ${message.input.code} updated.`,
        );
        taskEditorPanel?.dispose();
        return;
      }

      if (message?.type === "taskEditor:cancel") {
        taskEditorPanel?.dispose();
      }
    });
  }

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

    const bundle = await service.loadBundle();
    const catalogCodes = bundle.tasks.map((t) => t.code);

    const rawAgents = await service.listAiAgents();
    const agents = mapAgentsForWebview(
      rawAgents,
      taskEditorPanel?.webview,
      context,
    );

    await openTaskEditorPanel(task, catalogCodes, agents);
  }
}

export async function deactivate() {
  disposeReminderTimers();
  await activeService?.dispose();
  activeService = undefined;
  clearScriptFlowCache();
  clearCrossFileCache();
}

function buildSnapshotFilter(
  state: ReturnType<ExtensionTaskService["getFilterState"]>,
): TaskFilter {
  return {
    ...(state.selectedPlanCode ? { planCode: state.selectedPlanCode } : {}),
    ...(state.selectedProjects.length > 0
      ? { project: state.selectedProjects }
      : {}),
    ...(state.selectedGroups.length > 0 ? { group: state.selectedGroups } : {}),
    ...(state.searchQuery ? { search: state.searchQuery } : {}),
  };
}

function buildFilterCatalog(tasks: TaskRecord[]): FilterCatalog {
  return {
    projects: [...new Set(tasks.map((task) => task.project).filter(Boolean))]
      .map(String)
      .sort((left, right) => left.localeCompare(right)),
    groups: [...new Set(tasks.map((task) => task.lane).filter(Boolean))]
      .map(String)
      .sort((left, right) => left.localeCompare(right)),
    tags: [...new Set(tasks.flatMap((task) => task.tags))].sort((left, right) =>
      left.localeCompare(right),
    ),
    statuses: [...new Set(tasks.map((task) => task.status))].sort(
      (left, right) => left.localeCompare(right),
    ),
    severities: [...new Set(tasks.map((task) => task.severity))].sort(
      (left, right) => left.localeCompare(right),
    ),
  };
}

function buildPlanTasks(
  plans: readonly { code: string }[],
  tasks: readonly TaskRecord[],
) {
  const knownPlans = new Set(plans.map((plan) => plan.code));
  const grouped: Record<
    string,
    Array<{
      code: string;
      dependsOn: string[];
      durationEstimate?: number;
      label: string;
      lane?: string;
      severity: TaskRecord["severity"];
      status: TaskRecord["status"];
    }>
  > = {};

  for (const task of tasks) {
    const planCode = task.planCode;
    if (!planCode || !knownPlans.has(planCode)) {
      continue;
    }
    const bucket = (grouped[planCode] ??= []);
    bucket.push({
      code: task.code,
      dependsOn: task.dependsOn ?? [],
      ...(typeof task.durationEstimate === "number"
        ? { durationEstimate: task.durationEstimate }
        : {}),
      label: task.shortTask,
      ...(task.lane ? { lane: task.lane } : {}),
      severity: task.severity,
      status: task.status,
    });
  }

  for (const code of Object.keys(grouped)) {
    const bucket = grouped[code];
    if (bucket) {
      grouped[code] = bucket.sort((left, right) =>
        left.code.localeCompare(right.code),
      );
    }
  }

  return grouped;
}

function sanitizeFilterState(
  state: ReturnType<ExtensionTaskService["getFilterState"]>,
  catalog: FilterCatalog,
  planCodes: ReadonlySet<string>,
): ReturnType<ExtensionTaskService["getFilterState"]> {
  const nextState = {
    ...state,
    selectedProjects: state.selectedProjects.filter((value) =>
      catalog.projects.includes(value),
    ),
    selectedGroups: state.selectedGroups.filter((value) =>
      catalog.groups.includes(value),
    ),
    selectedTags: state.selectedTags.filter((value) =>
      catalog.tags.includes(value),
    ),
    selectedStatuses: state.selectedStatuses.filter((value) =>
      catalog.statuses.includes(value),
    ),
    selectedSeverities: state.selectedSeverities.filter((value) =>
      catalog.severities.includes(value),
    ),
  };

  if (state.selectedPlanCode && !planCodes.has(state.selectedPlanCode)) {
    delete nextState.selectedPlanCode;
  }

  return nextState;
}

function sameFilterState(
  left: ReturnType<ExtensionTaskService["getFilterState"]>,
  right: ReturnType<ExtensionTaskService["getFilterState"]>,
) {
  return (
    left.searchQuery === right.searchQuery &&
    left.graphOrientation === right.graphOrientation &&
    left.showMiniMap === right.showMiniMap &&
    left.groupByLane === right.groupByLane &&
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
  nextSelectedTaskCode?: string,
) {
  if (nextSelectedTaskCode) {
    const selectedTask = tasks.find(
      (task) =>
        task.code === nextSelectedTaskCode || task.id === nextSelectedTaskCode,
    );
    const selectedTaskPlanCode = selectedTask?.planCode;
    return selectedTaskPlanCode && planCodes.has(selectedTaskPlanCode)
      ? selectedTaskPlanCode
      : undefined;
  }

  const current = state.selectedPlanCode;
  if (!current || !planCodes.has(current)) {
    return undefined;
  }

  if (state.selectedProjects.length > 0) {
    const hasProjectOutsidePlan = tasks.some(
      (task) => task.project && state.selectedProjects.includes(task.project),
    );
    const hasProjectInsidePlan = tasks.some(
      (task) =>
        task.planCode === current &&
        task.project &&
        state.selectedProjects.includes(task.project),
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
  nextSelectedTaskCode?: string,
) {
  const taskCode = nextSelectedTaskCode ?? state.selectedTaskCode;
  if (!taskCode) {
    return undefined;
  }

  const selectedTask = tasks.find(
    (task) => task.code === taskCode || task.id === taskCode,
  );
  if (!selectedTask) {
    return undefined;
  }

  if (selectedPlanCode && selectedTask.planCode !== selectedPlanCode) {
    return undefined;
  }

  return taskCode;
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizePlanStatusFilter(
  value: PlanStatusFilter | undefined,
): PlanStatusFilter {
  return value === "done" ? "done" : "active";
}

function titleForPlanStatusFilter(filter: PlanStatusFilter) {
  return filter === "done" ? "Cortex · Cerrados" : "Cortex · En curso";
}

async function resolveArchivePlanCode(
  service: ExtensionTaskService,
  arg?: string | { planCode?: string; kind?: string; label?: string },
) {
  if (typeof arg === "string" && arg.trim()) {
    return arg.trim();
  }

  const candidate = arg as Partial<GroupTreeNode> | undefined;
  if (candidate?.planCode?.trim()) {
    return candidate.planCode.trim();
  }

  const donePlans = (await service.loadPlans())
    .filter((plan) => String(plan.status).toUpperCase() === "DONE")
    .sort((left, right) => left.code.localeCompare(right.code));
  if (donePlans.length === 0) {
    void vscode.window.showInformationMessage(
      "No DONE plans available to archive.",
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    donePlans.map((plan) => ({
      label: plan.code,
      description: plan.title,
      detail: `${plan.progress.done}/${plan.progress.total} done`,
      planCode: plan.code,
    })),
    {
      title: "Archive DONE plan",
      placeHolder: "Select a completed plan to archive",
    },
  );
  return picked?.planCode;
}

async function pickBrainRoot() {
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

async function migrateLegacyMongoUrlSetting(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("cortex");
  const legacyMongoUrl = config.get<string>("mongoUrl")?.trim();
  if (!legacyMongoUrl || (await context.secrets.get(MONGO_URL_SECRET_KEY))) {
    return;
  }

  await context.secrets.store(MONGO_URL_SECRET_KEY, legacyMongoUrl);
  await Promise.all([
    config.update("mongoUrl", undefined, vscode.ConfigurationTarget.Workspace),
    config.update("mongoUrl", undefined, vscode.ConfigurationTarget.Global),
  ]);
  void vscode.window.showInformationMessage(
    "Cortex migrated the Mongo URL to secure storage. Use 'Cortex: Set Mongo URL' to update it.",
  );
}

async function canConnectToMongoUrl(url: string) {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function pickConnectionSettings(
  service: ExtensionTaskService,
  options?: {
    title?: string;
  },
): Promise<ConnectionSettings | undefined> {
  const current = service.getConnectionSettings();
  const mongoUrl =
    (await vscode.window.showInputBox({
      prompt: options?.title ?? "Mongo connection string",
      value: current.mongoUrl,
      ignoreFocusOut: true,
    })) ?? current.mongoUrl;

  const databaseOptions = await safeList(
    service.listDatabaseNames.bind(service),
  );
  const dbPick = await vscode.window.showQuickPick(
    [
      ...databaseOptions.map((database) => ({
        label: database,
        description: "existing database",
      })),
      {
        label: "$(add) Create / type a new database",
        description: "manual entry",
      },
    ],
    {
      title: "Select Mongo database",
      placeHolder: current.mongoDbName,
      ignoreFocusOut: true,
    },
  );
  if (!dbPick) {
    return undefined;
  }

  const mongoDbName =
    dbPick.label === "$(add) Create / type a new database"
      ? ((await vscode.window.showInputBox({
          prompt: "Mongo database name",
          value: current.mongoDbName,
          ignoreFocusOut: true,
        })) ?? current.mongoDbName)
      : dbPick.label;

  const collectionOptions = await safeList(() =>
    service.listCollectionNames({
      mongoUrl,
      mongoDbName,
      mongoTasksCollection: current.mongoTasksCollection,
    }),
  );
  const collectionPick = await vscode.window.showQuickPick(
    [
      ...collectionOptions.map((collection) => ({
        label: collection,
        description: "existing collection",
      })),
      {
        label: "$(add) Create / type a new collection",
        description: "manual entry",
      },
    ],
    {
      title: "Select tasks collection",
      placeHolder: current.mongoTasksCollection,
      ignoreFocusOut: true,
    },
  );
  if (!collectionPick) {
    return undefined;
  }

  const mongoTasksCollection =
    collectionPick.label === "$(add) Create / type a new collection"
      ? ((await vscode.window.showInputBox({
          prompt: "Mongo tasks collection",
          value: current.mongoTasksCollection,
          ignoreFocusOut: true,
        })) ?? current.mongoTasksCollection)
      : collectionPick.label;

  return {
    mongoUrl,
    mongoDbName,
    mongoTasksCollection,
    mongoPlansCollection: current.mongoPlansCollection,
  };
}

async function buildScriptFlowDelivery(
  request: ScriptFlowRequest,
): Promise<ScriptFlowDelivery> {
  const resolved = await resolveScriptFlowDocument(request);
  if (resolved.kind === "error") {
    return { type: "error", error: resolved.error };
  }
  if (resolved.kind === "none") {
    return { type: "unsupported" };
  }
  const document = resolved.document;

  const documentPath = document.uri.fsPath;
  const language = resolveScriptFlowLanguage(documentPath);

  if (
    request.scope === "selection" &&
    (!request.selection || request.selection.isEmpty)
  ) {
    return {
      type: "error",
      error:
        "Select a code range before opening Script Flow for the current selection.",
    };
  }

  if (!language) {
    return {
      type: "unsupported",
      language: document.languageId,
    };
  }

  try {
    const source =
      request.scope === "selection" && request.selection
        ? document.getText(request.selection)
        : document.getText();
    const startedAt = Date.now();
    let snapshot = await analyzeScriptFlowDocument({
      documentPath,
      source,
    });
    if (!snapshot) {
      return {
        type: "unsupported",
        language,
      };
    }
    const maxDepth = vscode.workspace
      .getConfiguration("cortex")
      .get<number>("scriptFlowMaxDepth", 0);
    if (
      maxDepth > 0 &&
      language === "typescript" &&
      request.scope !== "selection"
    ) {
      try {
        snapshot = await expandCrossFileImports(snapshot, document.uri, {
          maxDepth: Math.min(maxDepth, 5),
        });
      } catch {
        // fall through to base snapshot
      }
    }
    return {
      type: "snapshot",
      snapshot,
      parseMs: Date.now() - startedAt,
      documentUri: document.uri,
    };
  } catch (error) {
    return {
      type: "error",
      error: String(error),
    };
  }
}

type ResolveScriptFlowDocumentResult =
  | { kind: "document"; document: vscode.TextDocument }
  | { kind: "error"; error: string }
  | { kind: "none" };

async function resolveScriptFlowDocument(
  request: ScriptFlowRequest,
): Promise<ResolveScriptFlowDocumentResult> {
  if (request.documentUri) {
    const fsPath = request.documentUri.fsPath;
    if (typeof fsPath !== "string" || !path.isAbsolute(fsPath)) {
      return {
        kind: "error",
        error: `Invalid document URI: ${request.documentUri.toString()}`,
      };
    }
    try {
      const document = await vscode.workspace.openTextDocument(
        request.documentUri,
      );
      return { kind: "document", document };
    } catch (error) {
      return {
        kind: "error",
        error: `Could not open ${fsPath}: ${String(error)}`,
      };
    }
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document) {
    return { kind: "document", document: editor.document };
  }
  return { kind: "none" };
}

function formatCollectionMessage(
  prefix: string,
  settings: ConnectionSettings,
  inspection: {
    documentCount: number;
    validTaskCount: number;
    skippedCount: number;
  },
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
    void vscode.window.showWarningMessage(
      `Cortex could not list options automatically: ${String(error)}`,
    );
    return [];
  }
}

async function pickPendingReminderCode() {
  const notes = await activeService?.listNotes();
  const reminderNotes = (notes ?? []).filter(
    (note) => note.remindAt && !note.remindedAt,
  );
  if (reminderNotes.length === 0) {
    void vscode.window.showInformationMessage(
      "No pending reminders available to snooze.",
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    reminderNotes
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((note) => ({
        label: note.code,
        description: note.title,
        detail: note.remindAt,
      })),
    {
      title: "Select a reminder to snooze",
      placeHolder: "Choose a note code",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  return picked?.label;
}

function isNoteDocumentInput(value: unknown): value is NoteDocumentInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<NoteDocumentInput>;
  return (
    typeof candidate.code === "string" &&
    candidate.code.trim().length > 0 &&
    typeof candidate.title === "string" &&
    candidate.title.trim().length > 0
  );
}

/**
 * El catalogo ai_agents guarda icon_path como filename pelado (p.ej.
 * "big-pickle.svg", ver cortex.setAiAgentIcon); los SVG viven en media/icons/.
 */
function agentIconUri(extensionUri: vscode.Uri, iconPath: string): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "media", "icons", iconPath);
}

function mapAgentsForWebview(
  rawAgents: Array<{
    slug: string;
    displayName?: string;
    iconPath?: string | null;
  }>,
  webview: vscode.Webview | undefined,
  context: vscode.ExtensionContext,
): CatalogAgent[] {
  const agents: CatalogAgent[] = rawAgents.map((a) => ({
    slug: a.slug,
    displayName: a.displayName ?? a.slug,
    iconUri:
      a.iconPath && webview
        ? webview
            .asWebviewUri(agentIconUri(context.extensionUri, a.iconPath))
            .toString()
        : "",
  }));

  const knownSlugs = new Set(agents.map((a) => a.slug));
  const synthetic: CatalogAgent[] = [
    { slug: "any", displayName: "Any", iconUri: "" },
    { slug: "human", displayName: "Human", iconUri: "" },
  ].filter((s) => !knownSlugs.has(s.slug));
  agents.push(...synthetic);

  return agents;
}

function isTaskDocumentInput(value: unknown): value is TaskDocumentInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TaskDocumentInput>;
  return (
    typeof candidate.code === "string" &&
    candidate.code.trim().length > 0 &&
    typeof candidate.short_task === "string" &&
    candidate.short_task.trim().length > 0 &&
    typeof candidate.status === "string" &&
    typeof candidate.severity === "string"
  );
}
