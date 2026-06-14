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

  it("calculates cost for claude-sonnet-4.6 with new catalog version", () => {
    const result = estimateRunCost({
      model: "claude-sonnet-4.6",
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
      pricingVersion: "2026-06-13"
    });

    expect(result.billingMode).toBe("estimated");
    expect(result.pricingVersion).toBe("2026-06-13");
    const expected =
      (1000 / 1_000_000) * 3 +
      (500 / 1_000_000) * 15 +
      (200 / 1_000_000) * 0.3;
    expect(result.estimatedCostUsd).toBeCloseTo(expected, 6);
  });

  it("uses default catalog when none specified (should resolve to latest)", () => {
    const result = estimateRunCost({
      model: "claude-haiku-4.5",
      inputTokens: 1000,
      outputTokens: 100
    });

    expect(result.billingMode).toBe("estimated");
    expect(result.pricingVersion).toBe("2026-06-13");
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });
});
