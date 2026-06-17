import { describe, it, expect } from "vitest";
import { normalizeAgentRunDocument } from "../src/schema.js";
import type { AgentRunDocument } from "../src/types.js";

const VALID_RUN: AgentRunDocument = {
  id: "run-001",
  agent_slug: "codex",
  started_at: "2026-06-01T10:00:00.000Z",
  task_codes: ["CORTEX-V015-T01"],
  files_touched: ["src/main.ts"],
  commits: [],
  status: "running"
};

describe("normalizeAgentRunDocument", () => {
  it("normalizes a valid running run", () => {
    const result = normalizeAgentRunDocument(VALID_RUN);
    expect(result).toMatchObject({
      id: "run-001",
      agentSlug: "codex",
      startedAt: "2026-06-01T10:00:00.000Z",
      taskCodes: ["CORTEX-V015-T01"],
      planCodes: [],
      filesTouched: ["src/main.ts"],
      commits: [],
      status: "running"
    });
    expect(result.endedAt).toBeNull();
  });

  it("normalizes a completed run with ended_at Date", () => {
    const result = normalizeAgentRunDocument({
      ...VALID_RUN,
      status: "completed",
      ended_at: new Date("2026-06-01T12:00:00.000Z")
    });
    expect(result.endedAt).toBe("2026-06-01T12:00:00.000Z");
  });

  it("preserves null ended_at as null", () => {
    const result = normalizeAgentRunDocument({
      ...VALID_RUN,
      ended_at: null
    });
    expect(result.endedAt).toBeNull();
  });

  it("includes optional numeric fields when present", () => {
    const result = normalizeAgentRunDocument({
      ...VALID_RUN,
      tokens_in: 500,
      tokens_out: 1200,
      cost_usd: 0.025,
      duration_ms: 7200000,
      plan_codes: ["CORTEX-V015"]
    });
    expect(result.tokensIn).toBe(500);
    expect(result.tokensOut).toBe(1200);
    expect(result.costUsd).toBe(0.025);
    expect(result.durationMs).toBe(7200000);
    expect(result.planCodes).toEqual(["CORTEX-V015"]);
  });

  it("rejects invalid status", () => {
    expect(() =>
      normalizeAgentRunDocument({
        ...VALID_RUN,
        status: "invalid" as never
      })
    ).toThrow();
  });

  it("rejects empty id", () => {
    expect(() =>
      normalizeAgentRunDocument({
        ...VALID_RUN,
        id: ""
      })
    ).toThrow();
  });

  it("rejects negative tokens", () => {
    expect(() =>
      normalizeAgentRunDocument({
        ...VALID_RUN,
        tokens_in: -1
      })
    ).toThrow();
  });
});
