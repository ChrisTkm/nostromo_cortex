import { describe, expect, it, vi } from "vitest";

import type { AgentStatsRecord } from "../src/types.js";

const mockAggregate = vi.fn<() => Promise<AgentStatsRecord[]>>();

vi.mock("mongodb", () => ({
  MongoClient: vi.fn(() => ({
    connect: vi.fn(),
    db: vi.fn(() => ({
      collection: vi.fn(() => ({
        aggregate: mockAggregate
      }))
    })),
    close: vi.fn()
  }))
}));

describe("queryAgentStats", () => {
  it("returns stats grouped by agent with correct shape", async () => {
    const { queryAgentStats } = await import("../src/mongo.js");
    const db = { collection: vi.fn() } as any;
    const mockCollection = { aggregate: vi.fn() };
    db.collection.mockReturnValue(mockCollection);

    const fakeStats: AgentStatsRecord[] = [
      {
        agentSlug: "codex",
        totalRuns: 10,
        completedRuns: 8,
        failedRuns: 1,
        runningRuns: 1,
        totalTokensIn: 50000,
        totalTokensOut: 15000,
        totalCostUsd: 2.5,
        firstRunAt: "2026-01-01T00:00:00.000Z",
        lastRunAt: "2026-06-09T00:00:00.000Z"
      },
      {
        agentSlug: "claude-code",
        totalRuns: 5,
        completedRuns: 4,
        failedRuns: 1,
        runningRuns: 0,
        totalTokensIn: 30000,
        totalTokensOut: 10000,
        totalCostUsd: 1.2,
        firstRunAt: "2026-02-01T00:00:00.000Z",
        lastRunAt: "2026-06-08T00:00:00.000Z"
      }
    ];

    mockCollection.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(fakeStats)
    });

    const result = await queryAgentStats(db);

    expect(result).toHaveLength(2);
    expect(result[0].agentSlug).toBe("codex");
    expect(result[0].totalRuns).toBe(10);
    expect(result[0].completedRuns).toBe(8);
    expect(result[0].failedRuns).toBe(1);
    expect(result[0].runningRuns).toBe(1);
    expect(result[0].totalTokensIn).toBe(50000);
    expect(result[0].totalTokensOut).toBe(15000);
    expect(result[0].totalCostUsd).toBe(2.5);
    expect(result[0].firstRunAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result[0].lastRunAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("filters by agentSlug when provided", async () => {
    const { queryAgentStats } = await import("../src/mongo.js");
    const db = { collection: vi.fn() } as any;
    const mockCollection = { aggregate: vi.fn() };
    db.collection.mockReturnValue(mockCollection);

    mockCollection.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    });

    await queryAgentStats(db, { agentSlug: "codex" });

    const pipeline = mockCollection.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({ $match: { agent_slug: "codex" } });
  });

  it("filters by date range when from/to provided", async () => {
    const { queryAgentStats } = await import("../src/mongo.js");
    const db = { collection: vi.fn() } as any;
    const mockCollection = { aggregate: vi.fn() };
    db.collection.mockReturnValue(mockCollection);

    mockCollection.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    });

    await queryAgentStats(db, { from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" });

    const pipeline = mockCollection.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: {
        started_at: { $gte: "2026-01-01T00:00:00Z", $lte: "2026-06-01T00:00:00Z" }
      }
    });
  });

  it("returns empty array when no runs match", async () => {
    const { queryAgentStats } = await import("../src/mongo.js");
    const db = { collection: vi.fn() } as any;
    const mockCollection = { aggregate: vi.fn() };
    db.collection.mockReturnValue(mockCollection);

    mockCollection.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    });

    const result = await queryAgentStats(db, { agentSlug: "nonexistent" });
    expect(result).toEqual([]);
  });

  it("pipeline includes $group stage with correct accumulators", async () => {
    const { queryAgentStats } = await import("../src/mongo.js");
    const db = { collection: vi.fn() } as any;
    const mockCollection = { aggregate: vi.fn() };
    db.collection.mockReturnValue(mockCollection);

    mockCollection.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    });

    await queryAgentStats(db);

    const pipeline = mockCollection.aggregate.mock.calls[0][0];
    const groupStage = pipeline.find((s: Record<string, unknown>) => s.$group);
    expect(groupStage).toBeDefined();
    expect(groupStage.$group._id).toBe("$agent_slug");
    expect(groupStage.$group.totalRuns).toEqual({ $sum: 1 });
    expect(groupStage.$group.completedRuns).toEqual({
      $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
    });
    expect(groupStage.$group.failedRuns).toEqual({
      $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] }
    });
    expect(groupStage.$group.runningRuns).toEqual({
      $sum: { $cond: [{ $eq: ["$status", "running"] }, 1, 0] }
    });
    expect(groupStage.$group.totalTokensIn).toEqual({ $sum: { $ifNull: ["$tokens_in", 0] } });
    expect(groupStage.$group.totalTokensOut).toEqual({ $sum: { $ifNull: ["$tokens_out", 0] } });
    expect(groupStage.$group.totalCostUsd).toEqual({ $sum: { $ifNull: ["$cost_usd", 0] } });
    expect(groupStage.$group.firstRunAt).toEqual({ $min: "$started_at" });
    expect(groupStage.$group.lastRunAt).toEqual({ $max: "$started_at" });
  });

  it("pipeline includes $sort and $project stages", async () => {
    const { queryAgentStats } = await import("../src/mongo.js");
    const db = { collection: vi.fn() } as any;
    const mockCollection = { aggregate: vi.fn() };
    db.collection.mockReturnValue(mockCollection);

    mockCollection.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    });

    await queryAgentStats(db);

    const pipeline = mockCollection.aggregate.mock.calls[0][0];
    const sortStage = pipeline.find((s: Record<string, unknown>) => s.$sort);
    const projectStage = pipeline.find((s: Record<string, unknown>) => s.$project);
    expect(sortStage).toEqual({ $sort: { totalRuns: -1 } });
    expect(projectStage).toBeDefined();
    expect(projectStage.$project._id).toBe(0);
    expect(projectStage.$project.agentSlug).toBe("$_id");
  });
});
