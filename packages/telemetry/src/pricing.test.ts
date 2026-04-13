import { describe, expect, it } from "vitest";

import { estimateRunCost } from "./pricing.js";

describe("estimateRunCost", () => {
  it("calculates estimated cost with cached input tokens", () => {
    const result = estimateRunCost({
      model: "gpt-5.4",
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
      pricingVersion: "2026-04-01"
    });

    expect(result.billingMode).toBe("estimated");
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("returns exact billing mode when an exact cost is supplied", () => {
    const result = estimateRunCost({
      model: "gpt-5.4",
      exactCostUsd: 0.0123
    });

    expect(result.billingMode).toBe("exact");
    expect(result.estimatedCostUsd).toBe(0.0123);
  });

  it("returns unavailable for unknown models", () => {
    const result = estimateRunCost({
      model: "unknown-model",
      inputTokens: 10
    });

    expect(result.billingMode).toBe("unavailable");
  });
});
