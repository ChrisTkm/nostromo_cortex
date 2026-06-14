import * as vscode from "vscode";

import type { ExtensionTaskService } from "../service.js";
import { DEFAULT_FILTER_STATE } from "../state.js";
import type { CortexTreeProvider } from "../tree.js";

type PlanQuickPickItem = vscode.QuickPickItem & {
  planCode?: string | undefined;
};

export async function handleSetSearchQuery(
  service: ExtensionTaskService,
  treeProvider: CortexTreeProvider,
  postSnapshot: () => Promise<void>,
) {
  const current = service.getFilterState().searchQuery ?? "";
  const search = await vscode.window.showInputBox({
    prompt: "Search by task code or text",
    value: current,
  });
  await service.updateFilterState({ searchQuery: search || undefined });
  treeProvider.refresh();
  await postSnapshot();
}

export async function handleSetTagFilter(
  service: ExtensionTaskService,
  treeProvider: CortexTreeProvider,
  postSnapshot: () => Promise<void>,
) {
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
}

export async function handleSetProjectFilter(
  service: ExtensionTaskService,
  treeProvider: CortexTreeProvider,
  postSnapshot: () => Promise<void>,
) {
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
}

export async function handleSetGroupFilter(
  service: ExtensionTaskService,
  treeProvider: CortexTreeProvider,
  postSnapshot: () => Promise<void>,
) {
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
}

export async function handleSelectPlan(
  service: ExtensionTaskService,
  treeProvider: CortexTreeProvider,
  postSnapshot: () => Promise<void>,
) {
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
  treeProvider.refresh();
  await postSnapshot();
}

export async function handleClearFilters(
  service: ExtensionTaskService,
  treeProvider: CortexTreeProvider,
  postSnapshot: () => Promise<void>,
) {
  const current = service.getFilterState();
  await service.updateFilterState({
    ...DEFAULT_FILTER_STATE,
    graphOrientation: current.graphOrientation,
    showMiniMap: current.showMiniMap,
    selectedPlanCode: undefined,
  });
  treeProvider.refresh();
  await postSnapshot();
}
