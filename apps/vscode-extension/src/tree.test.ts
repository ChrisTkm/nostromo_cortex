import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildTaskGraphMock } = vi.hoisted(() => ({
  buildTaskGraphMock: vi.fn()
}));

vi.mock("vscode", () => ({
  EventEmitter: class {
    fire = vi.fn();
    event = vi.fn();
    dispose = vi.fn();
  }
}));

vi.mock("@cortex/core", () => ({
  buildTaskGraph: buildTaskGraphMock
}));

import { CortexTreeProvider } from "./tree.js";
import type { GroupTreeNode } from "./tree.js";

const DEFAULT_FILTER_STATE = {
  selectedProjects: [] as string[],
  selectedGroups: [] as string[],
  selectedTags: [] as string[],
  searchQuery: "",
  selectedPlanCode: undefined
};

const EMPTY_GRAPH = { nodes: [] };

function makeService() {
  const loadTasksMock = vi.fn().mockResolvedValue([]);
  const loadPlansMock = vi.fn().mockResolvedValue([]);
  const getFilterStateMock = vi.fn().mockReturnValue(DEFAULT_FILTER_STATE);
  return {
    service: { loadTasks: loadTasksMock, loadPlans: loadPlansMock, getFilterState: getFilterStateMock },
    loadTasksMock,
    loadPlansMock
  };
}

describe("CortexTreeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTaskGraphMock.mockReturnValue(EMPTY_GRAPH);
  });

  it("returns children directly for group nodes without loading data", async () => {
    const { service, loadTasksMock } = makeService();
    const provider = new CortexTreeProvider(service as any);
    const child = { kind: "task" as const, id: "T-1", label: "Task 1", task: {} as any };
    const group: GroupTreeNode = { kind: "group", id: "plan:A", label: "A", children: [child] };

    const result = await provider.getChildren(group);

    expect(result).toBe(group.children);
    expect(loadTasksMock).not.toHaveBeenCalled();
  });

  it("returns empty array for task nodes without loading data", async () => {
    const { service, loadTasksMock } = makeService();
    const provider = new CortexTreeProvider(service as any);
    const task = { kind: "task" as const, id: "T-1", label: "Task 1", task: {} as any };

    const result = await provider.getChildren(task);

    expect(result).toEqual([]);
    expect(loadTasksMock).not.toHaveBeenCalled();
  });

  it("caches graph across multiple root getChildren() calls", async () => {
    const { service, loadTasksMock } = makeService();
    const provider = new CortexTreeProvider(service as any);

    await provider.getChildren(undefined);
    await provider.getChildren(undefined);
    await provider.getChildren(undefined);

    expect(loadTasksMock).toHaveBeenCalledTimes(1);
    expect(buildTaskGraphMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache on refresh()", async () => {
    const { service, loadTasksMock } = makeService();
    const provider = new CortexTreeProvider(service as any);

    await provider.getChildren(undefined);
    provider.refresh();
    await provider.getChildren(undefined);

    expect(loadTasksMock).toHaveBeenCalledTimes(2);
    expect(buildTaskGraphMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache on setPlanStatusFilter() change", async () => {
    const { service, loadTasksMock } = makeService();
    const provider = new CortexTreeProvider(service as any);

    await provider.getChildren(undefined);
    provider.setPlanStatusFilter("done");
    await provider.getChildren(undefined);

    expect(loadTasksMock).toHaveBeenCalledTimes(2);
    expect(buildTaskGraphMock).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate cache when setPlanStatusFilter() receives the same value", async () => {
    const { service, loadTasksMock } = makeService();
    const provider = new CortexTreeProvider(service as any);

    await provider.getChildren(undefined);
    provider.setPlanStatusFilter("active"); // same as default
    await provider.getChildren(undefined);

    expect(loadTasksMock).toHaveBeenCalledTimes(1);
    expect(buildTaskGraphMock).toHaveBeenCalledTimes(1);
  });

  it("calls loadPlans() on every root getChildren() call (plans are not cached)", async () => {
    const { service, loadPlansMock } = makeService();
    const provider = new CortexTreeProvider(service as any);

    await provider.getChildren(undefined);
    await provider.getChildren(undefined);

    expect(loadPlansMock).toHaveBeenCalledTimes(2);
  });

  it("clears cache on error so next call retries", async () => {
    const { service, loadTasksMock } = makeService();
    loadTasksMock.mockRejectedValueOnce(new Error("Mongo down")).mockResolvedValue([]);
    const provider = new CortexTreeProvider(service as any);

    await expect(provider.getChildren(undefined)).rejects.toThrow("Mongo down");
    // After the rejection the promise.catch handler runs asynchronously — yield to the
    // microtask queue before asserting the cache has been cleared.
    await Promise.resolve();

    await provider.getChildren(undefined);

    expect(loadTasksMock).toHaveBeenCalledTimes(2);
  });

  it("stale in-flight load does not repopulate cache after refresh()", async () => {
    let resolveStale!: (tasks: unknown[]) => void;
    const loadTasksMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<unknown[]>((resolve) => { resolveStale = resolve; }))
      .mockResolvedValue([]);
    const loadPlansMock = vi.fn().mockResolvedValue([]);
    const getFilterStateMock = vi.fn().mockReturnValue(DEFAULT_FILTER_STATE);
    const service = { loadTasks: loadTasksMock, loadPlans: loadPlansMock, getFilterState: getFilterStateMock };
    const provider = new CortexTreeProvider(service as any);

    // Call A: starts loading (P1 in flight)
    const staleCall = provider.getChildren(undefined);

    // Invalidate before P1 resolves
    provider.refresh();

    // Call B: creates P2, completes immediately
    await provider.getChildren(undefined);

    // Resolve the stale P1 — must NOT overwrite the cache holding P2
    resolveStale([]);
    await staleCall;

    // Call C: should reuse P2 (resolved), not trigger a new load
    await provider.getChildren(undefined);

    // loadTasks called once for P1 (stale) + once for P2 (fresh) = 2 total
    expect(loadTasksMock).toHaveBeenCalledTimes(2);
  });
});
