import { createHash, randomUUID } from "node:crypto";

import { estimateRunCost } from "./pricing.js";
import type { BillingMode, CostSummaryRange, TelemetryActor, TelemetryRun, TelemetryStore, TelemetryUsage } from "./types.js";

export interface RunTelemetryStart {
  sessionId: string;
  traceId?: string;
  source: TelemetryRun["source"];
  actor: TelemetryActor;
  toolName?: string;
  model?: string;
  provider?: string;
  prompt?: string;
  pricingVersion?: string;
  taskCodes?: string[];
  metadata?: Record<string, unknown>;
}

export interface RunTelemetryFinish {
  success: boolean;
  usage?: TelemetryUsage;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export class TelemetryRecorder {
  constructor(private readonly store: TelemetryStore) {}

  async initialize() {
    await this.store.initialize();
  }

  startRun(input: RunTelemetryStart) {
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const traceId = input.traceId ?? randomUUID();
    const promptHash = input.prompt ? createHash("sha256").update(input.prompt).digest("hex") : undefined;

    return {
      runId,
      traceId,
      startedAt,
      finish: async (finishInput: RunTelemetryFinish): Promise<TelemetryRun> => {
        const endedAt = new Date().toISOString();
        const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
        const usage = finishInput.usage ?? {};
        const priced = estimateRunCost({
          ...(typeof usage.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
          ...(typeof usage.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
          ...(typeof usage.cachedInputTokens === "number" ? { cachedInputTokens: usage.cachedInputTokens } : {}),
          ...(typeof usage.reasoningTokens === "number" ? { reasoningTokens: usage.reasoningTokens } : {}),
          ...(typeof usage.exactCostUsd === "number" ? { exactCostUsd: usage.exactCostUsd } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.pricingVersion ? { pricingVersion: input.pricingVersion } : {})
        });

        const billingMode = usage.billingMode ?? priced.billingMode;
        return this.store.recordRun({
          runId,
          traceId,
          sessionId: input.sessionId,
          source: input.source,
          actor: input.actor,
          ...(input.toolName ? { toolName: input.toolName } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
          ...(promptHash ? { promptHash } : {}),
          taskCodes: input.taskCodes ?? [],
          startedAt,
          endedAt,
          durationMs,
          success: finishInput.success,
          ...(finishInput.errorCode ? { errorCode: finishInput.errorCode } : {}),
          ...(finishInput.errorMessage ? { errorMessage: finishInput.errorMessage } : {}),
          ...(typeof usage.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
          ...(typeof usage.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
          ...(typeof usage.cachedInputTokens === "number" ? { cachedInputTokens: usage.cachedInputTokens } : {}),
          ...(typeof usage.reasoningTokens === "number" ? { reasoningTokens: usage.reasoningTokens } : {}),
          totalTokens:
            usage.totalTokens ??
            (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.reasoningTokens ?? 0),
          ...(typeof (usage.estimatedCostUsd ?? priced.estimatedCostUsd) === "number"
            ? { estimatedCostUsd: usage.estimatedCostUsd ?? priced.estimatedCostUsd }
            : {}),
          currency: usage.currency ?? priced.currency,
          billingMode: billingMode as BillingMode,
          ...(priced.pricingVersion ? { pricingVersion: priced.pricingVersion } : {}),
          metadata: {
            ...(input.metadata ?? {}),
            ...(finishInput.metadata ?? {})
          }
        });
      }
    };
  }

  async recentRuns(limit: number) {
    return this.store.recentRuns(limit);
  }

  async recentFailures(limit: number) {
    return this.store.recentFailures(limit);
  }

  async costSummary(range?: CostSummaryRange) {
    return this.store.costSummary(range);
  }
}
