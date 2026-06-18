import { describe, expect, it } from "vitest";

import { normalizeActionPlan } from "../src/schema.js";

describe("normalizeActionPlan", () => {
  it("preserves product, release, and project metadata", () => {
    const plan = normalizeActionPlan({
      code: "CORTEX-V016",
      title: "Cortex v0.1.6",
      description: "",
      goal: "",
      context: "",
      status: "PLANNING",
      project: "cortex/v0.1.6",
      product: "cortex",
      release: "v0.1.6",
      progress: {
        total: 0,
        pending: 0,
        in_progress: 0,
        blocked: 0,
        done: 0,
        failed: 0,
      },
    });

    expect(plan.project).toBe("cortex/v0.1.6");
    expect(plan.product).toBe("cortex");
    expect(plan.release).toBe("v0.1.6");
  });
});
