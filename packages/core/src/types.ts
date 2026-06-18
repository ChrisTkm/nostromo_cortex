export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "FAILED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PLAN_STATUSES = ["PLANNING", "IN_PROGRESS", "DONE", "COMPLETED", "PAUSED", "ARCHIVED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const TASK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TaskSeverity = (typeof TASK_SEVERITIES)[number];

/**
 * Agentes IA reconocidos por el sistema.
 *
 * Cada slug aquí DEBE tener una row correspondiente en la collection `ai_agents`
 * (`nostromo_cortex.ai_agents`) con el mismo valor en el campo `slug`.
 *
 * Si agregás un agente nuevo:
 *   1. Agregá el slug a este array.
 *   2. Agregá una seed row en `ai_agents` (ver PREP-03, `scripts/seed-ai-agents.ts`).
 *   3. Commit del SVG del icono en `apps/vscode-extension/media/icons/` (o usá
 *      el comando 'Cortex: Set AI Agent Icon').
 *
 * Ver `docs/modules/ledger.md` → Pre-requisitos para contexto completo.
 */
export const TASK_AGENTS = [
  "any",
  "big-pickle",
  "claude",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "gemini",
  "human"
] as const;
export type TaskAgent = (typeof TASK_AGENTS)[number];

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
  product?: string | null;
  release?: string | null;
  tags?: string[];
  progress: PlanProgress;
  current_task_code?: string | null;
  /** Persona que crea o lidera el plan. */
  author?: string;
  /** Agente IA asignado al plan (slug del catálogo ai_agents). */
  assigned_agent?: TaskAgent;
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
  product?: string;
  release?: string;
  tags: string[];
  progress: PlanProgress;
  currentTaskCode?: string;
  /** Persona que crea o lidera el plan. */
  author?: string;
  /** Agente IA asignado al plan (slug del catálogo ai_agents). */
  assignedAgent?: string;
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
  agent: TaskAgent | string;
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
  /** Timestamp ISO de cuando la task pasó a IN_PROGRESS. Lo setea quien dispara la transición (skill /plan next u otra vía). */
  started_at?: string | Date | null;
  /** Timestamp ISO de cuando la task pasó a DONE o FAILED. Lo setea quien dispara la transición. */
  completed_at?: string | Date | null;
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
  /** Timestamp ISO de cuando la task pasó a IN_PROGRESS. */
  startedAt?: string | null;
  /** Timestamp ISO de cuando la task pasó a DONE o FAILED. */
  completedAt?: string | null;
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

export interface OrphanDependencyWarning {
  taskCode: string;
  missing: string;
}

export interface GraphWarnings {
  orphans: OrphanDependencyWarning[];
}

export interface TaskGraph {
  tasks: TaskRecord[];
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  adjacency: Map<string, string[]>;
  reverseAdjacency: Map<string, string[]>;
  topologicalOrder: string[];
  cycles: CycleInfo[];
  warnings: GraphWarnings;
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
  warnings: GraphWarnings;
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
  listTasks(filter?: { planCode?: string }): Promise<TaskRecord[]>;
  getTask(codeOrId: string): Promise<TaskRecord | null>;
  ensureIndexes(): Promise<void>;
  upsertTasks(tasks: TaskDocumentInput[]): Promise<number>;
  bulkUpdateTasks(codes: string[], patch: Record<string, unknown>): Promise<number>;
  deleteTasks(codes: string[]): Promise<number>;
}

export interface NoteDocumentInput {
  _id?: unknown;
  code: string;
  title: string;
  body?: string;
  tags?: string[];
  task_code?: string | null;
  plan_code?: string | null;
  pinned?: boolean;
  remind_at?: string | Date | null;
  reminded_at?: string | Date | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface NoteRecord {
  id?: string;
  code: string;
  title: string;
  body: string;
  tags: string[];
  taskCode?: string;
  planCode?: string;
  pinned: boolean;
  remindAt?: string;
  remindedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteStore {
  listNotes(): Promise<NoteRecord[]>;
  getNote(code: string): Promise<NoteRecord | null>;
  upsertNote(input: NoteDocumentInput): Promise<NoteRecord>;
  deleteNote(code: string): Promise<boolean>;
}

/**
 * Slugs del enum TASK_AGENTS que tienen seed en ai_agents.
 * Excluye `any` y `human` que son valores semánticos (cualquier agente / humano),
 * no agentes IA concretos.
 */
export const SELF_HOSTED_AGENTS = [
  "big-pickle",
  "claude",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "gemini"
] as const;

export interface AiAgentDocument {
  _id?: unknown;
  /** PK lógica, alineada con enum TASK_AGENTS (excluyendo any/human). */
  slug: string;
  /** Nombre de display (ej. "Claude Code", "Google Gemini"). */
  display_name: string;
  /** Vendor del modelo (ej. "anthropic", "google", "github"). */
  vendor: string;
  /** Familia del modelo (ej. "gpt-5-codex", "claude-opus-4-7"). */
  model_family?: string;
  /** Path relativo a media/icons/ (ej. "codex.svg"). */
  icon_path?: string | null;
  /** Si el agente está activo en el catálogo. */
  active: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface AiAgentRecord {
  id?: string;
  slug: string;
  displayName: string;
  vendor: string;
  modelFamily?: string;
  iconPath?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiAgentStore {
  listAgents(): Promise<AiAgentRecord[]>;
  findAgent(slug: string): Promise<AiAgentRecord | null>;
  ensureIndexes(): Promise<void>;
  ensureSeeds(): Promise<void>;
  updateIcon(slug: string, iconPath: string): Promise<void>;
}

export type AgentRunStatus = "running" | "completed" | "failed";

export interface AgentRunDocument {
  _id?: unknown;
  /** PK estable del run (uuid). */
  id: string;
  /** FK a ai_agents.slug. */
  agent_slug: string;
  /** Modelo concreto (ej. claude-opus-4-7, gpt-5-codex). */
  model_id?: string | null;
  /** Cuándo arrancó la sesión. */
  started_at: string | Date;
  /** null mientras status === "running". */
  ended_at?: string | Date | null;
  /** Duración calculada de la sesión en milisegundos. */
  duration_ms?: number | null;
  /** Tasks tocadas en la sesión. */
  task_codes: string[];
  /** Plans afectados por las tasks de la sesión. */
  plan_codes?: string[];
  /** Rutas relativas modificadas en la sesión. */
  files_touched: string[];
  /** Hashes de commits corridos por el agente. */
  commits: string[];
  /** Tokens de entrada reportados por el agente. */
  tokens_in?: number | null;
  /** Tokens de salida reportados por el agente. */
  tokens_out?: number | null;
  /** Costo estimado de la sesión. */
  cost_usd?: number | null;
  /** running | completed | failed */
  status: AgentRunStatus;
  /** Texto libre, 1-2 líneas. */
  notes?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface AgentRunRecord {
  id: string;
  agentSlug: string;
  modelId?: string;
  startedAt: string;
  endedAt: string | null;
  durationMs?: number;
  taskCodes: string[];
  planCodes: string[];
  filesTouched: string[];
  commits: string[];
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  status: AgentRunStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStatsRecord {
  /** FK a ai_agents.slug. */
  agentSlug: string;
  /** Total de runs registrados. */
  totalRuns: number;
  /** Runs con status "completed". */
  completedRuns: number;
  /** Runs con status "failed". */
  failedRuns: number;
  /** Runs con status "running". */
  runningRuns: number;
  /** Suma de tokens_in. */
  totalTokensIn: number;
  /** Suma de tokens_out. */
  totalTokensOut: number;
  /** Suma de cost_usd. */
  totalCostUsd: number;
  /** Timestamp ISO del run más antiguo. */
  firstRunAt: string;
  /** Timestamp ISO del run más reciente. */
  lastRunAt: string;
}
