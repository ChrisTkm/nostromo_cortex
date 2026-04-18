import { buildTaskGraph, TASK_SEVERITIES, TASK_STATUSES, type TaskDocumentInput, type TaskFilter, type TaskRecord } from "@cortex/core";
import * as vscode from "vscode";

import { ExtensionTaskService } from "./service.js";
import { DEFAULT_FILTER_STATE } from "./state.js";
import { CortexTreeProvider, type TaskTreeNode } from "./tree.js";
import { getGraphHtml } from "./webview/html.js";

type ConnectionSettings = ReturnType<ExtensionTaskService["getConnectionSettings"]>;
type PlanQuickPickItem = vscode.QuickPickItem & { planCode?: string };
type OptionsQuickPickItem = vscode.QuickPickItem & { command: string };
type FilterCatalog = {
  projects: string[];
  groups: string[];
  tags: string[];
  statuses: string[];
  severities: string[];
};

function nonce() {
  return Math.random().toString(36).slice(2);
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("[cortex] activate() called");
  const service = new ExtensionTaskService(context);
  try {
    await service.initialize();
    console.log("[cortex] service.initialize() ok");
  } catch (err) {
    console.error("[cortex] service.initialize() FAILED", err);
    throw err;
  }

  const treeProvider = new CortexTreeProvider(service);
  const treeView = vscode.window.createTreeView("cortex.overview", {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);

  let graphPanel: vscode.WebviewPanel | undefined;

async function postSnapshot(selectedTaskCode?: string) {
    if (!graphPanel) {
      return;
    }

    const persistedState = service.getFilterState();
    console.log("[cortex] postSnapshot — filterState:", JSON.stringify(persistedState));
    const allTasks = await service.loadTasks();
    const plans = await service.loadPlans();
    console.log("[cortex] postSnapshot — tasks:", allTasks.length, "plans:", plans.length);
    const availablePlanCodes = new Set(plans.map((plan) => plan.code));
    const selectedPlanCode = resolveSelectedPlanCode(allTasks, persistedState, availablePlanCodes, selectedTaskCode);
    const catalog = buildFilterCatalog(
      selectedPlanCode ? allTasks.filter((task) => task.planCode === selectedPlanCode) : allTasks
    );
    const state = sanitizeFilterState(
      {
        ...persistedState,
        selectedPlanCode
      },
      catalog,
      availablePlanCodes
    );
    if (!sameFilterState(persistedState, state)) {
      await service.updateFilterState(state);
    }

    const snapshotFilter = buildSnapshotFilter(state);
    console.log("[cortex] postSnapshot — snapshotFilter:", JSON.stringify(snapshotFilter));
    const snapshot = await service.loadSnapshot(snapshotFilter);
    console.log("[cortex] postSnapshot — snapshot nodes:", snapshot.nodes.length, "edges:", snapshot.edges.length);

    const payload = {
      type: "snapshot",
      snapshot,
      plans,
      planTasks: buildPlanTasks(plans, allTasks),
      totals: {
        totalTaskCount: allTasks.length
      },
      state: {
        orientation: state.graphOrientation,
        showMiniMap: state.showMiniMap,
        selectedTaskCode: selectedTaskCode ?? state.selectedTaskCode,
        zoom: state.zoom,
        pan: state.pan
      },
      connection: service.getConnectionSettings(),
      filters: snapshotFilter,
      catalog
    };

    graphPanel.webview.postMessage(payload);
    await service.recordInteraction("graph_snapshot", {
      mongo_query_count: 3,
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
              selectedTaskCode: undefined,
              selectedProjects: []
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
    if (selectedTaskCode) {
      await service.updateFilterState({ selectedTaskCode });
    }
    await postSnapshot(selectedTaskCode);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("cortex.openGraph", async (arg?: string | { kind?: string; task?: { code?: string } }) => {
      const code = typeof arg === "string" ? arg : arg?.kind === "task" ? arg.task?.code : undefined;
      return openGraph(code);
    }),
    vscode.commands.registerCommand("cortex.refresh", refreshView),
    vscode.commands.registerCommand("cortex.showOptions", async () => {
      const items: OptionsQuickPickItem[] = [
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
        { label: "$(close) Clear plan filter", planCode: undefined },
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

export function deactivate() {}

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
    if (!task.planCode || !knownPlans.has(task.planCode)) {
      continue;
    }
    grouped[task.planCode] ??= [];
    grouped[task.planCode].push({
      code: task.code,
      ...(typeof task.durationEstimate === "number" ? { durationEstimate: task.durationEstimate } : {}),
      label: task.shortTask,
      ...(task.lane ? { lane: task.lane } : {}),
      severity: task.severity,
      status: task.status
    });
  }

  for (const code of Object.keys(grouped)) {
    grouped[code] = grouped[code].sort((left, right) => left.code.localeCompare(right.code));
  }

  return grouped;
}

function sanitizeFilterState(
  state: ReturnType<ExtensionTaskService["getFilterState"]>,
  catalog: FilterCatalog,
  planCodes: ReadonlySet<string>
): ReturnType<ExtensionTaskService["getFilterState"]> {
  return {
    ...state,
    ...(state.selectedPlanCode && !planCodes.has(state.selectedPlanCode) ? { selectedPlanCode: undefined } : {}),
    selectedProjects: state.selectedProjects.filter((value) => catalog.projects.includes(value)),
    selectedGroups: state.selectedGroups.filter((value) => catalog.groups.includes(value)),
    selectedTags: state.selectedTags.filter((value) => catalog.tags.includes(value)),
    selectedStatuses: state.selectedStatuses.filter((value) => catalog.statuses.includes(value)),
    selectedSeverities: state.selectedSeverities.filter((value) => catalog.severities.includes(value))
  };
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
  const current = state.selectedPlanCode;
  if (!current || !planCodes.has(current)) {
    return undefined;
  }

  const taskCode = nextSelectedTaskCode ?? state.selectedTaskCode;
  if (taskCode) {
    const selectedTask = tasks.find((task) => task.code === taskCode || task.id === taskCode);
    if (selectedTask && selectedTask.planCode !== current) {
      return undefined;
    }
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

  const status = await vscode.window.showQuickPick([...TASK_STATUSES], {
    title: `Status for ${task.code}`,
    placeHolder: task.status,
    ignoreFocusOut: true
  });
  if (!status) {
    return undefined;
  }

  const severity = await vscode.window.showQuickPick([...TASK_SEVERITIES], {
    title: `Severity for ${task.code}`,
    placeHolder: task.severity,
    ignoreFocusOut: true
  });
  if (!severity) {
    return undefined;
  }

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
