export interface ExtensionFilterState {
  searchQuery?: string;
  selectedTags: string[];
  selectedProjects: string[];
  selectedGroups: string[];
  graphOrientation: "LR" | "TB";
  selectedTaskCode?: string;
  zoom: number;
  pan: { x: number; y: number };
}

export const DEFAULT_FILTER_STATE: ExtensionFilterState = {
  selectedTags: [],
  selectedProjects: [],
  selectedGroups: [],
  graphOrientation: "LR",
  zoom: 1,
  pan: { x: 0, y: 0 }
};
