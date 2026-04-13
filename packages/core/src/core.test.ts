import { describe, expect, it } from "vitest";

import {
  buildGraphSnapshot,
  buildTaskGraph,
  criticalPathEstimate,
  getReadyTasks,
  getTaskBlockers,
  getTaskDownstream,
  normalizeTaskDocument,
  normalizeTasks,
  sampleTasks,
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
