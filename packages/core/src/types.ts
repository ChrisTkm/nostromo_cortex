export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "FAILED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TaskSeverity = (typeof TASK_SEVERITIES)[number];

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
