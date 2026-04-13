import { buildTaskGraph, TASK_SEVERITIES, TASK_STATUSES, type TaskDocumentInput, type TaskRecord } from "@cortex/core";
import * as vscode from "vscode";

import { ExtensionTaskService } from "./service.js";
import { DEFAULT_FILTER_STATE } from "./state.js";
import { CortexTreeProvider, type TaskTreeNode } from "./tree.js";
import { getGraphHtml } from "./webview/html.js";

type ConnectionSettings = ReturnType<ExtensionTaskService["getConnectionSettings"]>;

function nonce() {
  return Math.random().toString(36).slice(2);
}

export async function activate(context: vscode.ExtensionContext) {
  const service = new ExtensionTaskService(context);
  await service.initialize();

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

    const state = service.getFilterState();
    const snapshot = await service.loadSnapshot({
      ...(state.selectedProjects.length > 0 ? { project: state.selectedProjects } : {}),
      ...(state.selectedGroups.length > 0 ? { group: state.selectedGroups } : {}),
      ...(state.searchQuery ? { search: state.searchQuery } : {}),
      ...(state.selectedTags.length > 0 ? { tags: state.selectedTags } : {})
    });

    const payload = {
      type: "snapshot",
      snapshot,
      state: {
        orientation: state.graphOrientation,
        selectedTaskCode: selectedTaskCode ?? state.selectedTaskCode,
        zoom: state.zoom,
        pan: state.pan
      },
      connection: service.getConnectionSettings(),
      filters: {
        selectedProjects: state.selectedProjects,
        selectedGroups: state.selectedGroups,
        selectedTags: state.selectedTags,
        searchQuery: state.searchQuery
      }
    };

    graphPanel.webview.postMessage(payload);
    await service.recordInteraction("graph_snapshot", {
      mongo_query_count: 1,
      snapshot_node_count: snapshot.nodes.length,
      snapshot_edge_count: snapshot.edges.length,
      payload_size_bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      chained_tool_calls: 1
    });
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
          await postSnapshot();
          treeProvider.refresh();
          return;
        }
        if (message.type === "selectionChanged") {
          await service.updateFilterState({ selectedTaskCode: message.selectedTaskCode });
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
    vscode.commands.registerCommand("cortex.openGraph", async (selectedTaskCode?: string) => openGraph(selectedTaskCode)),
    vscode.commands.registerCommand("cortex.refresh", async () => {
      treeProvider.refresh();
      await postSnapshot();
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
    vscode.commands.registerCommand("cortex.editTask", async (selectedTaskCode?: string) => {
      await editTask(selectedTaskCode ?? service.getFilterState().selectedTaskCode);
    }),
    vscode.commands.registerCommand("cortex.clearFilters", async () => {
      await service.updateFilterState(DEFAULT_FILTER_STATE);
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
    mongoTasksCollection
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
