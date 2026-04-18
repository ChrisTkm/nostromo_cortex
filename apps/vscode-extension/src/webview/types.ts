import type { ActionPlanRecord, GraphSnapshot, SnapshotNode, TaskFilter, TaskSeverity, TaskStatus } from "@cortex/core";

export type { ActionPlanRecord, GraphSnapshot, SnapshotNode, TaskFilter, TaskSeverity, TaskStatus };

export type PlanTaskSummary = {
  code: string;
  durationEstimate?: number;
  label: string;
  lane?: string;
  severity: TaskSeverity;
  status: TaskStatus;
};

export type GraphDirection = "LR" | "TB";

export type FilterCatalog = {
  projects: string[];
  groups: string[];
  tags: string[];
  statuses: TaskStatus[];
  severities: TaskSeverity[];
};

export type SnapshotMessage = {
  type: "snapshot";
  snapshot: GraphSnapshot;
  plans: ActionPlanRecord[];
  planTasks: Record<string, PlanTaskSummary[]>;
  totals: {
    totalTaskCount: number;
  };
  state: {
    orientation: GraphDirection;
    showMiniMap: boolean;
    selectedTaskCode?: string;
    zoom?: number;
    pan?: { x: number; y: number };
  };
  filters: TaskFilter;
  catalog: FilterCatalog;
};
