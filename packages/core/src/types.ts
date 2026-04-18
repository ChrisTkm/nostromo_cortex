export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "FAILED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PLAN_STATUSES = ["PLANNING", "IN_PROGRESS", "COMPLETED", "PAUSED", "ARCHIVED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const TASK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TaskSeverity = (typeof TASK_SEVERITIES)[number];

export interface PlanProgress {
  total: number;
  pending: number;
  in_progress: number;
  blocked: number;
  done: number;
  failed: number;
}

export interface ActionPlanDocument {
  _id?: unknown;
  code: string;
  title: string;
  description: string;
  goal: string;
  context: string;
  status: PlanStatus;
  project?: string | null;
  tags?: string[];
  progress: PlanProgress;
  current_task_code?: string | null;
  notes?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  completed_at?: string | Date | null;
}

export interface ActionPlanRecord {
  id?: string;
  code: string;
  title: string;
  description: string;
  goal: string;
  context: string;
  status: PlanStatus;
  project?: string;
  tags: string[];
  progress: PlanProgress;
  currentTaskCode?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface TaskDocumentInput {
  _id?: unknown;
  code: string;
  project?: string | null;
  short_task: string;
  detail: string;
  status: TaskStatus;
  agent: string;
  severity: TaskSeverity;
  tags?: string[];
  depends_on?: string[];
  duration_estimate?: number | null;
  lane?: string | null;
  order_hint?: number | null;
  source_ref?: string | null;
  plan_code?: string | null;
  prompt?: string | null;
  acceptance?: string | null;
  out_of_scope?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface TaskRecord {
  id?: string;
  code: string;
  project?: string;
  shortTask: string;
  detail: string;
  status: TaskStatus;
  agent: string;
  severity: TaskSeverity;
  tags: string[];
  dependsOn: string[];
  durationEstimate?: number;
  lane?: string;
  orderHint?: number;
  sourceRef?: string;
  planCode?: string;
  prompt?: string;
  acceptance?: string;
  outOfScope?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilter {
  project?: string[];
  group?: string[];
  status?: TaskStatus[];
  agent?: string[];
  severity?: TaskSeverity[];
  tags?: string[];
  codes?: string[];
  search?: string;
  readyOnly?: boolean;
  blockedOnly?: boolean;
  planCode?: string;
}

export interface TaskGraphNode extends TaskRecord {
  blockedByCount: number;
  downstreamCount: number;
  ready: boolean;
}

export interface TaskGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface CycleInfo {
  path: string[];
  message: string;
}

export interface TaskGraph {
  tasks: TaskRecord[];
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  adjacency: Map<string, string[]>;
  reverseAdjacency: Map<string, string[]>;
  topologicalOrder: string[];
  cycles: CycleInfo[];
  metrics: {
    nodeCount: number;
    edgeCount: number;
    readyCount: number;
    blockedCount: number;
    doneCount: number;
  };
}

export interface SnapshotNode {
  id: string;
  code: string;
  project?: string;
  label: string;
  detail: string;
  status: TaskStatus;
  severity: TaskSeverity;
  agent: string;
  lane?: string;
  durationEstimate?: number;
  orderHint?: number;
  sourceRef?: string;
  planCode?: string;
  prompt?: string;
  acceptance?: string;
  outOfScope?: string;
  createdAt: string;
  updatedAt: string;
  dependsOn: string[];
  ready: boolean;
  blockedByCount: number;
  downstreamCount: number;
  tags: string[];
  tooltip: string;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphSnapshot {
  generatedAt: string;
  filters: TaskFilter;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  stats: {
    taskCount: number;
    edgeCount: number;
    readyCount: number;
    blockedCount: number;
    cycleCount: number;
    doneCount: number;
    inProgressCount: number;
    pendingCount: number;
    failedCount: number;
    totalEstimatedDuration: number;
    readyEstimatedDuration: number;
  };
  cycles: CycleInfo[];
  planContext?: ActionPlanRecord;
}

export interface CriticalPathResult {
  available: boolean;
  totalDuration?: number;
  path?: string[];
  coverage: {
    withEstimate: number;
    withoutEstimate: number;
  };
  reason?: string;
}

export interface ListTasksOptions {
  limit?: number;
}

export interface TaskStore {
  listTasks(): Promise<TaskRecord[]>;
  getTask(codeOrId: string): Promise<TaskRecord | null>;
  upsertTasks(tasks: TaskDocumentInput[]): Promise<number>;
}
