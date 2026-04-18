import { describe, expect, it, vi } from "vitest";

import {
  buildGraphSnapshot,
  buildTaskGraph,
  criticalPathEstimate,
  getReadyTasks,
  getTaskBlockers,
  getTaskDownstream,
  normalizeNote,
  normalizeActionPlan,
  normalizeTaskDocument,
  normalizeTasks,
  sampleTasks,
  MongoActionPlanStore,
  MongoNoteStore,
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

  it("builds a deterministic topological order for a diamond DAG", () => {
    const graph = buildTaskGraph(
      normalizeTasks([
        {
          ...sampleTasks[3]!,
          code: "D",
          short_task: "Task D",
          depends_on: ["B", "C"]
        },
        {
          ...sampleTasks[2]!,
          code: "C",
          short_task: "Task C",
          depends_on: ["A"]
        },
        {
          ...sampleTasks[1]!,
          code: "B",
          short_task: "Task B",
          depends_on: ["A"]
        },
        {
          ...sampleTasks[0]!,
          code: "A",
          short_task: "Task A",
          depends_on: []
        }
      ])
    );

    expect(graph.topologicalOrder).toEqual(["A", "B", "C", "D"]);
  });
});

describe("note normalization", () => {
  it("normalizes a minimal note input with defaults", () => {
    const note = normalizeNote({
      code: "n1",
      title: "Hola"
    });

    expect(note.code).toBe("n1");
    expect(note.title).toBe("Hola");
    expect(note.body).toBe("");
    expect(note.tags).toEqual([]);
    expect(note.pinned).toBe(false);
    expect(note.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(note.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts camelCase note inputs and returns camelCase output", () => {
    const note = normalizeNote({
      _id: "note-1",
      code: "n2",
      title: "Compat",
      body: "Body",
      tags: ["alpha", "beta"],
      taskCode: "TASK-1",
      planCode: "PLAN-1",
      pinned: true,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: new Date("2026-04-12T01:00:00.000Z")
    } as never);

    expect(note).toMatchObject({
      id: "note-1",
      code: "n2",
      title: "Compat",
      body: "Body",
      tags: ["alpha", "beta"],
      taskCode: "TASK-1",
      planCode: "PLAN-1",
      pinned: true,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T01:00:00.000Z"
    });
  });

  it("deduplicates and sorts note tags", () => {
    const note = normalizeNote({
      code: "n3",
      title: "Tags",
      tags: ["zeta", "alpha", "zeta", "beta", "alpha"]
    });

    expect(note.tags).toEqual(["alpha", "beta", "zeta"]);
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

  it("lists and fetches normalized notes when using a shared client", async () => {
    const sharedClient = createSharedClient([
      {
        _id: "note-2",
        code: "n2",
        title: "Second",
        pinned: false,
        updated_at: "2026-04-12T11:00:00.000Z"
      },
      {
        _id: "note-1",
        code: "n1",
        title: "First",
        pinned: true,
        updated_at: "2026-04-12T12:00:00.000Z",
        tags: ["b", "a", "b"]
      }
    ]) as unknown as SharedMongoClient;

    sharedClient.collectionApi.findOne.mockResolvedValue({
      _id: "note-1",
      code: "n1",
      title: "First",
      task_code: "TASK-1",
      plan_code: "PLAN-1",
      pinned: true
    });

    const store = new MongoNoteStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "notes",
      sharedClient
    });

    const notes = await store.listNotes();
    const note = await store.getNote("n1");

    expect(sharedClient.collectionApi.find).toHaveBeenCalledWith({});
    expect(sharedClient.collectionApi.sort).toHaveBeenCalledWith({ pinned: -1, updated_at: -1 });
    expect(notes.map((item) => item.code)).toEqual(["n2", "n1"]);
    expect(note).toMatchObject({
      code: "n1",
      taskCode: "TASK-1",
      planCode: "PLAN-1",
      pinned: true
    });

    await store.close();
    expect(sharedClient.close).not.toHaveBeenCalled();
  });

  it("upserts, deletes and indexes notes", async () => {
    const sharedClient = createSharedClient([]) as unknown as SharedMongoClient;
    sharedClient.collectionApi.findOne.mockResolvedValue({
      _id: "note-3",
      code: "n3",
      title: "Stored",
      body: "Persisted",
      tags: ["z", "a", "z"],
      pinned: true,
      task_code: "TASK-3",
      plan_code: "PLAN-3",
      created_at: "2026-04-12T10:00:00.000Z",
      updated_at: "2026-04-12T11:00:00.000Z"
    });
    sharedClient.collectionApi.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const store = new MongoNoteStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "notes",
      sharedClient
    });

    const note = await store.upsertNote({
      code: "n3",
      title: "Stored",
      pinned: true
    });
    const deleted = await store.deleteNote("n3");

    await store.ensureIndexes();

    expect(sharedClient.collectionApi.updateOne).toHaveBeenCalledWith(
      { code: "n3" },
      {
        $set: expect.objectContaining({
          code: "n3",
          title: "Stored",
          pinned: true,
          created_at: expect.any(String),
          updated_at: expect.any(String)
        })
      },
      { upsert: true }
    );
    expect(note).toMatchObject({
      id: "note-3",
      code: "n3",
      tags: ["a", "z"],
      taskCode: "TASK-3",
      planCode: "PLAN-3"
    });
    expect(sharedClient.collectionApi.deleteOne).toHaveBeenCalledWith({ code: "n3" });
    expect(deleted).toBe(true);
    expect(sharedClient.collectionApi.createIndexes).toHaveBeenCalledWith([
      { key: { code: 1 }, name: "code_unique", unique: true, partialFilterExpression: { code: { $type: "string" } } },
      { key: { task_code: 1 }, name: "task_code_idx" },
      { key: { plan_code: 1 }, name: "plan_code_idx" },
      { key: { updated_at: -1 }, name: "updated_at_desc_idx" }
    ]);
  });

  it("returns zero writes when no tasks are provided", async () => {
    const sharedClient = createSharedClient([]) as unknown as SharedMongoClient;
    const store = new MongoTaskStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "tasks",
      sharedClient
    });

    await expect(store.upsertTasks([])).resolves.toBe(0);
    expect(sharedClient.collectionApi.bulkWrite).not.toHaveBeenCalled();
  });

  it("upserts tasks in bulk with consistent timestamps", async () => {
    const sharedClient = createSharedClient([]) as unknown as SharedMongoClient;
    const store = new MongoTaskStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "tasks",
      sharedClient
    });

    const writes = await store.upsertTasks([
      {
        ...sampleTasks[0]!,
        code: "T-1"
      },
      {
        ...sampleTasks[1]!,
        code: "T-2",
        created_at: "2026-04-12T10:00:00.000Z"
      }
    ]);

    expect(writes).toBe(2);
    expect(sharedClient.collectionApi.bulkWrite).toHaveBeenCalledTimes(1);
    expect(sharedClient.collectionApi.bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { code: "T-1" },
            update: {
              $set: expect.objectContaining({
                code: "T-1",
                created_at: expect.any(String),
                updated_at: expect.any(String)
              })
            },
            upsert: true
          })
        }),
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { code: "T-2" },
            update: {
              $set: expect.objectContaining({
                code: "T-2",
                created_at: "2026-04-12T10:00:00.000Z",
                updated_at: expect.any(String)
              })
            },
            upsert: true
          })
        })
      ],
      { ordered: false }
    );

    const [operations] = sharedClient.collectionApi.bulkWrite.mock.calls[0] ?? [];
    const firstWrite = operations?.[0]?.updateOne.update.$set;
    expect(firstWrite?.created_at).toEqual(firstWrite?.updated_at);
  });

  it("creates the required task and plan indexes", async () => {
    const taskClient = createSharedClient([]) as unknown as SharedMongoClient;
    const taskStore = new MongoTaskStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "tasks",
      sharedClient: taskClient
    });

    await taskStore.ensureIndexes();

    expect(taskClient.collectionApi.createIndexes).toHaveBeenCalledWith([
      { key: { code: 1 }, name: "code_unique", unique: true, partialFilterExpression: { code: { $type: "string" } } },
      { key: { plan_code: 1 }, name: "plan_code_idx" },
      { key: { status: 1 }, name: "status_idx" }
    ]);

    const planClient = createSharedClient([]) as unknown as SharedMongoClient;
    const planStore = new MongoActionPlanStore({
      mongoUrl: "mongodb://unused",
      dbName: "cortex",
      collectionName: "action_plans",
      sharedClient: planClient
    });

    await planStore.ensureIndexes();

    expect(planClient.collectionApi.createIndexes).toHaveBeenCalledWith([
      { key: { code: 1 }, name: "code_unique", unique: true },
      { key: { status: 1 }, name: "status_idx" }
    ]);
  });
});

function createSharedClient(items: unknown[]) {
  const toArray = vi.fn().mockResolvedValue(items);
  const sort = vi.fn(() => ({
    toArray
  }));
  const bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: items.length });
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });
  const createIndexes = vi.fn().mockResolvedValue(["ok"]);
  const find = vi.fn(() => ({
    sort,
    toArray
  }));
  const findOne = vi.fn().mockResolvedValue(null);
  const collection = vi.fn(() => ({
    bulkWrite,
    createIndexes,
    deleteOne,
    find,
    findOne,
    updateOne
  }));
  const db = vi.fn(() => ({
    collection
  }));

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    db,
    close: vi.fn().mockResolvedValue(undefined),
    collectionApi: {
      bulkWrite,
      createIndexes,
      deleteOne,
      find,
      findOne,
      sort,
      toArray,
      updateOne
    }
  };
}
