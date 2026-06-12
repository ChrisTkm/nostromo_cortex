import type { TaskDocumentInput, TaskRecord } from "@cortex/core";

export const TASK_STATUSES_LOCAL = ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "FAILED"] as const;
export const TASK_SEVERITIES_LOCAL = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type CatalogAgent = {
  slug: string;
  displayName: string;
  iconUri: string;
};

export type TaskEditorCatalog = {
  taskCodes: string[];
  agents: CatalogAgent[];
};

export type TaskEditorMessage =
  | { type: "taskEditor:load"; task: TaskRecord; catalog: TaskEditorCatalog }
  | { type: "taskEditor:saved"; task: TaskRecord };

export type TaskEditorDraft = {
  code: string;
  shortTask: string;
  detail: string;
  status: (typeof TASK_STATUSES_LOCAL)[number];
  severity: (typeof TASK_SEVERITIES_LOCAL)[number];
  project: string;
  agent: string;
  lane: string;
  durationEstimate: string;
  tags: string;
  dependsOn: string;
  sourceRef: string;
  prompt: string;
  acceptance: string;
  outOfScope: string;
};

export type { TaskDocumentInput, TaskRecord };
