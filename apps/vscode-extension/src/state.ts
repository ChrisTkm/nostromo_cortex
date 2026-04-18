import type { TaskSeverity, TaskStatus } from "@cortex/core";

export interface ExtensionFilterState {
  searchQuery?: string;
  selectedTags: string[];
  selectedProjects: string[];
  selectedGroups: string[];
  selectedStatuses: TaskStatus[];
  selectedSeverities: TaskSeverity[];
  graphOrientation: "LR" | "TB";
  showMiniMap: boolean;
  selectedTaskCode?: string;
  selectedPlanCode?: string;
  zoom: number;
  pan: { x: number; y: number };
}

export const DEFAULT_FILTER_STATE: ExtensionFilterState = {
  selectedTags: [],
  selectedProjects: [],
  selectedGroups: [],
  selectedStatuses: [],
  selectedSeverities: [],
  graphOrientation: "LR",
  showMiniMap: true,
  zoom: 1,
  pan: { x: 0, y: 0 }
};
