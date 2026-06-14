import type {
  NoteDocumentInput,
  TaskFilter,
  TaskRecord,
} from "@cortex/core";

import type { ExtensionFilterState } from "./state.js";
import type { PlanStatusFilter } from "./tree.js";

export interface FilterCatalog {
  projects: string[];
  groups: string[];
  tags: string[];
  statuses: string[];
  severities: string[];
}

export const PLAN_STATUS_FILTER_KEY = "cortex.planStatusFilter";

export function buildSnapshotFilter(
  state: ExtensionFilterState,
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

export function buildFilterCatalog(tasks: TaskRecord[]): FilterCatalog {
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

export function buildPlanTasks(
  plans: readonly { code: string }[],
  tasks: readonly TaskRecord[],
) {
  const knownPlans = new Set(plans.map((plan) => plan.code));
  const grouped: Record<
    string,
    Array<{
      code: string;
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

export function sanitizeFilterState(
  state: ExtensionFilterState,
  catalog: FilterCatalog,
  planCodes: ReadonlySet<string>,
): ExtensionFilterState {
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

export function sameFilterState(
  left: ExtensionFilterState,
  right: ExtensionFilterState,
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

export function resolveSelectedPlanCode(
  tasks: TaskRecord[],
  state: ExtensionFilterState,
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

export function resolveSelectedTaskCode(
  tasks: TaskRecord[],
  state: ExtensionFilterState,
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

export function normalizePlanStatusFilter(
  value: PlanStatusFilter | undefined,
): PlanStatusFilter {
  return value === "done" ? "done" : "active";
}

export function titleForPlanStatusFilter(filter: PlanStatusFilter) {
  return filter === "done" ? "Cortex · Cerrados" : "Cortex · En curso";
}

export function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isNoteDocumentInput(value: unknown): value is NoteDocumentInput {
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
