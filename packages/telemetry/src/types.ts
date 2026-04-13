export type BillingMode = "exact" | "estimated" | "unavailable";
export type TelemetrySource = "vscode-extension" | "mcp-server" | "worker" | "cli";
export type TelemetryActor = "human" | "agent" | "skill";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface TelemetryUsage extends TokenUsage {
  estimatedCostUsd?: number;
  currency?: string;
  billingMode?: BillingMode;
  exactCostUsd?: number;
}

export interface TelemetryRun {
  runId: string;
  traceId: string;
  sessionId: string;
  source: TelemetrySource;
  actor: TelemetryActor;
  toolName?: string;
  model?: string;
  provider?: string;
  promptHash?: string;
  taskCodes: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  currency: string;
  billingMode: BillingMode;
  pricingVersion?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TelemetryRunInput extends Omit<TelemetryRun, "createdAt" | "currency" | "metadata"> {
  createdAt?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface RunSummary {
  runId: string;
  source: TelemetrySource;
  toolName?: string;
  durationMs: number;
  success: boolean;
  estimatedCostUsd?: number;
  startedAt: string;
  endedAt: string;
}

export interface CostSummary {
  totalRuns: number;
  totalEstimatedCostUsd: number;
  billingModes: Record<BillingMode, number>;
  bySource: Record<string, number>;
}

export interface CostSummaryRange {
  from?: string;
  to?: string;
}

export interface TelemetryStore {
  initialize(): void | Promise<void>;
  recordRun(run: TelemetryRunInput): Promise<TelemetryRun>;
  recentRuns(limit: number): Promise<TelemetryRun[]>;
  recentFailures(limit: number): Promise<TelemetryRun[]>;
  costSummary(range?: CostSummaryRange): Promise<CostSummary>;
}

export interface PricingDefinition {
  inputPerMillion?: number;
  outputPerMillion?: number;
  cachedInputPerMillion?: number;
}

export interface PricingCatalog {
  version: string;
  models: Record<string, PricingDefinition>;
}
