import { describe, expect, it, vi } from "vitest";

import {
  buildGraphSnapshot,
  buildTaskGraph,
  criticalPathEstimate,
  getReadyTasks,
  getTaskBlockers,
  getTaskDownstream,
  normalizeActionPlan,
  normalizeTaskDocument,
  normalizeTasks,
  sampleTasks,
  MongoActionPlanStore,
  MongoTaskStore,
  SharedMongoClient,
  stableStringify
} from "./index.js";

describe("task normalization", () => {
  it("normalizes mongo task documents into stable task records", () => {
    const task = normalizeTaskDocument({
      _id: "abc123",
      code: "S5b",
      short_task: "UI editor",
      detail: "Detailed description",
      status: "PENDING",
      agent: "sevastopol",
      severity: "MEDIUM",
      tags: ["admin", "frontend", "admin"],
      depends_on: ["S2.1", "S5a", "S2.1"],
      created_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T01:00:00.000Z"
    });

    expect(task).toMatchObject({
      id: "abc123",
      code: "S5b",
      shortTask: "UI editor",
      tags: ["admin", "frontend"],
      dependsOn: ["S2.1", "S5a"]
    });
  });

  it("rejects duplicate task codes", () => {
    expect(() =>
      normalizeTasks([
        sampleTasks[0]!,
        {
          ...sampleTasks[0]!,
          short_task: "duplicate"
        }
      ])
    ).toThrow(/Duplicate task codes/i);
  });

  it("accepts lowercase enums and camelCase compatibility fields", () => {
    const task = normalizeTaskDocument({
      code: "S8",
      shortTask: "Compat task",
      detail: "Compat input",
      status: "pending" as never,
      agent: "nomad",
      severity: "medium" as never,
      dependsOn: ["S1"],
      durationEstimate: 2,
      sourceRef: "legacy"
    } as unknown as Parameters<typeof normalizeTaskDocument>[0]);

    expect(task).toMatchObject({
      code: "S8",
      shortTask: "Compat task",
      status: "PENDING",
      severity: "MEDIUM",
      dependsOn: ["S1"],
      durationEstimate: 2,
      sourceRef: "legacy"
    });
  });

  it("accepts snake_case and camelCase task inputs mixed together", () => {
    const task = normalizeTaskDocument({
      code: "S9",
      shortTask: "Mixed casing",
      detail: "Mixed casing input",
      status: "in_progress" as never,
      agent: "atlas",
      severity: "high" as never,
      depends_on: ["S1"],
      durationEstimate: 3
    } as unknown as Parameters<typeof normalizeTaskDocument>[0]);

    expect(task).toMatchObject({
      code: "S9",
      shortTask: "Mixed casing",
      status: "IN_PROGRESS",
      severity: "HIGH",
      dependsOn: ["S1"],
      durationEstimate: 3
    });
  });
});

describe("action plan normalization", () => {
  it("normalizes valid action plans", () => {
    const plan = normalizeActionPlan({
      _id: "plan-1",
      code: "PLAN-123",
      title: "Core migration",
      description: "Move graph context to plans",
      goal: "Support plan-aware filtering",
      context: "Imported from /plan",
      status: "in_progress" as never,
      project: "cortex",
      tags: ["core", "graph", "core"],
      progress: {
        total: 10,
        pending: 3,
        inProgress: 2,
        blocked: 1,
        done: 4,
        failed: 0
      } as never,
      currentTaskCode: "S5b",
      notes: "Keep vscode extension untouched",
      createdAt: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T01:00:00.000Z",
      completedAt: null
    } as never);

    expect(plan).toMatchObject({
      id: "plan-1",
      code: "PLAN-123",
      status: "IN_PROGRESS",
      tags: ["core", "graph"],
      currentTaskCode: "S5b",
      progress: {
        total: 10,
        pending: 3,
        in_progress: 2,
        blocked: 1,
        done: 4,
        failed: 0
      },
      completedAt: null
    });
  });

  it("rejects invalid plan statuses", () => {
    expect(() =>
      normalizeActionPlan({
        code: "PLAN-404",
        title: "Broken",
        description: "",
        goal: "",
        context: "",
        status: "queued" as never,
        progress: {
          total: 0,
          pending: 0,
          in_progress: 0,
          blocked: 0,
          done: 0,
          failed: 0
        }
      })
    ).toThrow();
  });
});

describe("graph algorithms", () => {
  const tasks = normalizeTasks(sampleTasks);

  it("detects cycles and emits readable paths", () => {
    const graph = buildTaskGraph(
      normalizeTasks([
        {
          ...sampleTasks[0]!,
          code: "A",
          depends_on: ["C"]
        },
        {
          ...sampleTasks[1]!,
          code: "B",
          depends_on: ["A"]
        },
        {
          ...sampleTasks[2]!,
          code: "C",
          depends_on: ["B"]
        }
      ])
    );

    expect(graph.cycles[0]?.path).toEqual(["A", "B", "C", "A"]);
  });

  it("calculates ready tasks from explicit dependencies", () => {
    expect(getReadyTasks(tasks).map((task) => task.code)).toEqual(["S5a"]);
  });

  it("returns direct blockers for a task", () => {
    expect(getTaskBlockers(tasks, "S5b").map((task) => task.code)).toEqual(["S2.1", "S5a"]);
  });

  it("returns downstream tasks", () => {
    expect(getTaskDownstream(tasks, "S2.1").map((task) => task.code)).toEqual(["S3", "S4", "S5b"]);
  });

  it("creates graph snapshots with deterministic ordering", () => {
    const snapshot = buildGraphSnapshot(tasks, { tags: ["frontend"] });
    expect(snapshot.nodes.map((node) => node.code)).toEqual(["S3", "S5b"]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual([]);
  });

  it("filters snapshots by project and group", () => {
    const snapshot = buildGraphSnapshot(tasks, { project: ["cortex"], group: ["Extension"] });
    expect(snapshot.nodes.map((node) => node.code)).toEqual(["S3", "S5b"]);
  });

  it("filters snapshots by planCode before graph construction", () => {
    const planTasks = normalizeTasks([
      {
        ...sampleTasks[0]!,
        code: "PLAN-A",
        plan_code: "PLAN-X",
        depends_on: []
      },
      {
        ...sampleTasks[1]!,
        code: "PLAN-B",
        plan_code: "PLAN-X",
        depends_on: ["PLAN-A"]
      },
      {
        ...sampleTasks[2]!,
        code: "PLAN-C",
        plan_code: "PLAN-Y",
        depends_on: ["PLAN-B"]
      }
    ]);

    const snapshot = buildGraphSnapshot(planTasks, { planCode: "PLAN-X" }, {
      plan: normalizeActionPlan({
        code: "PLAN-X",
        title: "Plan X",
        description: "",
        goal: "",
        context: "",
        status: "PLANNING",
        progress: {
          total: 2,
          pending: 2,
          in_progress: 0,
          blocked: 0,
          done: 0,
          failed: 0
        }
      })
    });

    expect(snapshot.nodes.map((node) => node.code)).toEqual(["PLAN-A", "PLAN-B"]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(["PLAN-A->PLAN-B"]);
    expect(snapshot.planContext?.code).toBe("PLAN-X");
  });

  it("serializes JSON deterministically", () => {
    const first = stableStringify({ b: 2, a: [2, { d: 4, c: 3 }] });
    const second = stableStringify({ a: [2, { c: 3, d: 4 }], b: 2 });
    expect(first).toEqual(second);
  });

  it("estimates critical path when all durations are present", () => {
    const estimate = criticalPathEstimate(tasks);
    expect(estimate.available).toBe(true);
    expect(estimate.path).toEqual(["S1", "S2", "S2.1", "S5b"]);
  });
});

describe("shared mongo client support", () => {
  it("keeps task store close a no-op when using a shared client", async () => {
    const sharedClient = createSharedClient([
      {
        ...sampleTasks[0]!,
        _id: "task-1"
      }
    ]) as unknown as SharedMongoClient;

    const store = new MongoTaskStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "tasks",
      sharedClient
    });

    const tasks = await store.listTasks();

    expect(tasks.map((task) => task.code)).toEqual([sampleTasks[0]!.code]);
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);
    expect(sharedClient.close).not.toHaveBeenCalled();

    await store.close();
    expect(sharedClient.close).not.toHaveBeenCalled();
  });

  it("keeps action plan store close a no-op when using a shared client", async () => {
    const sharedClient = createSharedClient([
      {
        code: "PLAN-1",
        title: "Shared plan",
        description: "A shared plan",
        goal: "Keep close a no-op",
        context: "",
        status: "PLANNING",
        progress: {
          total: 1,
          pending: 1,
          in_progress: 0,
          blocked: 0,
          done: 0,
          failed: 0
        }
      }
    ]) as unknown as SharedMongoClient;

    const store = new MongoActionPlanStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "action_plans",
      sharedClient
    });

    const plans = await store.listPlans();

    expect(plans.map((plan) => plan.code)).toEqual(["PLAN-1"]);
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);
    expect(sharedClient.close).not.toHaveBeenCalled();

    await store.close();
    expect(sharedClient.close).not.toHaveBeenCalled();
  });
});

function createSharedClient(items: unknown[]) {
  const toArray = vi.fn().mockResolvedValue(items);
  const find = vi.fn(() => ({
    toArray
  }));
  const collection = vi.fn(() => ({
    find
  }));
  const db = vi.fn(() => ({
    collection
  }));

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    db,
    close: vi.fn().mockResolvedValue(undefined)
  };
}
