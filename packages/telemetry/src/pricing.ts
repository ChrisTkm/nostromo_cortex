import type { BillingMode, PricingCatalog, TokenUsage } from "./types.js";

export const PRICING_CATALOGS: Record<string, PricingCatalog> = {
  "2026-04-01": {
    version: "2026-04-01",
    models: {
      "gpt-5.4": {
        inputPerMillion: 1.25,
        outputPerMillion: 10,
        cachedInputPerMillion: 0.125
      },
      "gpt-5.4-mini": {
        inputPerMillion: 0.3,
        outputPerMillion: 2.4,
        cachedInputPerMillion: 0.03
      },
      "gpt-5.3-codex": {
        inputPerMillion: 1.5,
        outputPerMillion: 6,
        cachedInputPerMillion: 0.15
      },
      "claude-sonnet-4.5": {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cachedInputPerMillion: 0.3
      }
    }
  }
};

export interface EstimateRunCostInput extends TokenUsage {
  model?: string;
  pricingVersion?: string;
  exactCostUsd?: number;
}

export interface EstimateRunCostResult {
  estimatedCostUsd?: number;
  billingMode: BillingMode;
  pricingVersion?: string;
  currency: "USD";
}

export function estimateRunCost(input: EstimateRunCostInput): EstimateRunCostResult {
  if (typeof input.exactCostUsd === "number") {
    return {
      estimatedCostUsd: input.exactCostUsd,
      billingMode: "exact",
      ...(input.pricingVersion ? { pricingVersion: input.pricingVersion } : {}),
      currency: "USD"
    };
  }

  const pricingVersion = input.pricingVersion ?? "2026-04-01";
  const catalog = PRICING_CATALOGS[pricingVersion];
  const modelPricing = input.model ? catalog?.models[input.model] : undefined;
  if (!catalog || !modelPricing) {
    return {
      billingMode: "unavailable",
      pricingVersion,
      currency: "USD"
    };
  }

  const inputCost = ((input.inputTokens ?? 0) / 1_000_000) * (modelPricing.inputPerMillion ?? 0);
  const outputCost = ((input.outputTokens ?? 0) / 1_000_000) * (modelPricing.outputPerMillion ?? 0);
  const cachedCost = ((input.cachedInputTokens ?? 0) / 1_000_000) * (modelPricing.cachedInputPerMillion ?? modelPricing.inputPerMillion ?? 0);

  return {
    estimatedCostUsd: Number((inputCost + outputCost + cachedCost).toFixed(6)),
    billingMode: "estimated",
    pricingVersion: catalog.version,
    currency: "USD"
  };
}
