import type {
  ActionPlanRecord,
  CriticalPathResult,
  CycleInfo,
  GraphSnapshot,
  SnapshotEdge,
  SnapshotNode,
  TaskFilter,
  TaskGraph,
  TaskGraphEdge,
  TaskGraphNode,
  OrphanDependencyWarning,
  TaskRecord
} from "./types.js";

function stableArray<T>(values: Iterable<T>, selector: (value: T) => string): T[] {
  return [...values].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function buildIndexes(tasks: TaskRecord[]) {
  const byCode = new Map(tasks.map((task) => [task.code, task]));
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();

  for (const task of tasks) {
    adjacency.set(task.code, []);
    reverseAdjacency.set(task.code, []);
  }

  const edges: TaskGraphEdge[] = [];
  const orphans: OrphanDependencyWarning[] = [];
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byCode.has(dependency)) {
        orphans.push({
          taskCode: task.code,
          missing: dependency
        });
        continue;
      }
      adjacency.get(dependency)?.push(task.code);
      reverseAdjacency.get(task.code)?.push(dependency);
      edges.push({
        id: `${dependency}->${task.code}`,
        source: dependency,
        target: task.code
      });
    }
  }

  for (const [code, values] of adjacency.entries()) {
    adjacency.set(code, stableArray(values, (value) => value));
  }
  for (const [code, values] of reverseAdjacency.entries()) {
    reverseAdjacency.set(code, stableArray(values, (value) => value));
  }

  return {
    byCode,
    adjacency,
    reverseAdjacency,
    edges: stableArray(edges, (edge) => edge.id),
    warnings: {
      orphans: stableArray(orphans, (orphan) => `${orphan.taskCode}->${orphan.missing}`)
    }
  };
}

function detectCycles(adjacency: Map<string, string[]>): CycleInfo[] {
  const cycles: CycleInfo[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const seenMessages = new Set<string>();

  function visit(node: string) {
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!visiting.has(next) && !visited.has(next)) {
        visit(next);
        continue;
      }

      if (visiting.has(next)) {
        const cycleStart = stack.indexOf(next);
        const path = [...stack.slice(cycleStart), next];
        const canonical = path.join(" -> ");
        if (!seenMessages.has(canonical)) {
          seenMessages.add(canonical);
          cycles.push({
            path,
            message: `Dependency cycle detected: ${canonical}`
          });
        }
      }
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of stableArray(adjacency.keys(), (value) => value)) {
    visit(node);
  }

  return cycles;
}

function computeTopologicalOrder(tasks: TaskRecord[], adjacency: Map<string, string[]>, reverseAdjacency: Map<string, string[]>): string[] {
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    indegree.set(task.code, reverseAdjacency.get(task.code)?.length ?? 0);
  }

  let currentLevel = stableArray(
    [...indegree.entries()].filter(([, count]) => count === 0).map(([code]) => code),
    (value) => value
  );
  const order: string[] = [];

  while (currentLevel.length > 0) {
    const nextLevel: string[] = [];

    for (const current of currentLevel) {
      order.push(current);
      for (const dependent of adjacency.get(current) ?? []) {
        const nextIndegree = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, nextIndegree);
        if (nextIndegree === 0) {
          nextLevel.push(dependent);
        }
      }
    }

    currentLevel = stableArray(nextLevel, (value) => value);
  }

  return order;
}

export function isTaskReady(task: TaskRecord, tasksByCode: Map<string, TaskRecord>): boolean {
  if (!["PENDING", "BLOCKED"].includes(task.status)) {
    return false;
  }
  return task.dependsOn.every((dependencyCode) => tasksByCode.get(dependencyCode)?.status === "DONE");
}

export function buildTaskGraph(tasks: TaskRecord[]): TaskGraph {
  const { byCode, adjacency, reverseAdjacency, edges, warnings } = buildIndexes(tasks);
  const cycles = detectCycles(adjacency);

  const downstreamCache = new Map<string, Set<string>>();
  const visitDownstream = (code: string, trail = new Set<string>()): Set<string> => {
    if (downstreamCache.has(code)) {
      return downstreamCache.get(code)!;
    }
    if (trail.has(code)) {
      return new Set<string>();
    }
    const nextTrail = new Set(trail);
    nextTrail.add(code);
    const result = new Set<string>();
    for (const next of adjacency.get(code) ?? []) {
      result.add(next);
      for (const nested of visitDownstream(next, nextTrail)) {
        result.add(nested);
      }
    }
    downstreamCache.set(code, result);
    return result;
  };

  const nodes: TaskGraphNode[] = stableArray(tasks, (task) => task.code).map((task) => {
    const blockedBy = (reverseAdjacency.get(task.code) ?? []).filter((dependencyCode) => byCode.get(dependencyCode)?.status !== "DONE");
    return {
      ...task,
      blockedByCount: blockedBy.length,
      downstreamCount: visitDownstream(task.code).size,
      ready: isTaskReady(task, byCode)
    };
  });

  const topologicalOrder = cycles.length === 0 ? computeTopologicalOrder(tasks, adjacency, reverseAdjacency) : [];

  return {
    tasks: stableArray(tasks, (task) => task.code),
    nodes,
    edges,
    adjacency,
    reverseAdjacency,
    topologicalOrder,
    cycles,
    warnings,
    metrics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      readyCount: nodes.filter((node) => node.ready).length,
      blockedCount: nodes.filter((node) => node.blockedByCount > 0 && node.status !== "DONE").length,
      doneCount: nodes.filter((node) => node.status === "DONE").length
    }
  };
}

export function filterGraph(graph: TaskGraph, filter: TaskFilter = {}): TaskGraphNode[] {
  const projects = filter.project && filter.project.length > 0 ? new Set(filter.project) : undefined;
  const groups = filter.group && filter.group.length > 0 ? new Set(filter.group) : undefined;
  const codes = filter.codes && filter.codes.length > 0 ? new Set(filter.codes) : undefined;
  const statuses = filter.status && filter.status.length > 0 ? new Set(filter.status) : undefined;
  const severities = filter.severity && filter.severity.length > 0 ? new Set(filter.severity) : undefined;
  const agents = filter.agent && filter.agent.length > 0 ? new Set(filter.agent) : undefined;
  const tags = filter.tags && filter.tags.length > 0 ? new Set(filter.tags) : undefined;
  const search = filter.search?.trim().toLowerCase();

  return graph.nodes.filter((node) => {
    if (projects && (!node.project || !projects.has(node.project))) {
      return false;
    }
    if (groups && (!node.lane || !groups.has(node.lane))) {
      return false;
    }
    if (codes && !codes.has(node.code)) {
      return false;
    }
    if (statuses && !statuses.has(node.status)) {
      return false;
    }
    if (severities && !severities.has(node.severity)) {
      return false;
    }
    if (agents && !agents.has(node.agent)) {
      return false;
    }
    if (tags && !node.tags.some((tag) => tags.has(tag))) {
      return false;
    }
    if (filter.readyOnly && !node.ready) {
      return false;
    }
    if (filter.blockedOnly && node.blockedByCount === 0) {
      return false;
    }
    if (search) {
      const haystack = `${node.code} ${node.project ?? ""} ${node.shortTask} ${node.detail} ${node.agent} ${node.lane ?? ""} ${node.tags.join(" ")}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

export function getReadyTasks(tasks: TaskRecord[]): TaskRecord[] {
  const graph = buildTaskGraph(tasks);
  return graph.nodes.filter((node) => node.ready).map(({ blockedByCount: _blockedByCount, downstreamCount: _downstreamCount, ready: _ready, ...task }) => task);
}

export function getTaskBlockers(tasks: TaskRecord[], code: string): TaskRecord[] {
  const graph = buildTaskGraph(tasks);
  const dependencies = graph.reverseAdjacency.get(code) ?? [];
  const lookup = new Map(graph.tasks.map((task) => [task.code, task]));
  return stableArray(
    dependencies.map((dependencyCode) => lookup.get(dependencyCode)).filter((task): task is TaskRecord => Boolean(task && task.status !== "DONE")),
    (task) => task.code
  );
}

export function getTaskDownstream(tasks: TaskRecord[], code: string): TaskRecord[] {
  const graph = buildTaskGraph(tasks);
  const lookup = new Map(graph.tasks.map((task) => [task.code, task]));
  const visited = new Set<string>();
  const stack = [...(graph.adjacency.get(code) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const next of graph.adjacency.get(current) ?? []) {
      stack.push(next);
    }
  }

  return stableArray(
    [...visited].map((taskCode) => lookup.get(taskCode)).filter((task): task is TaskRecord => Boolean(task)),
    (task) => task.code
  );
}

export function buildGraphSnapshot(
  tasks: TaskRecord[],
  filter: TaskFilter = {},
  context?: { plan?: ActionPlanRecord }
): GraphSnapshot {
  const graphTasks = filter.planCode ? tasks.filter((task) => task.planCode === filter.planCode) : tasks;
  const graph = buildTaskGraph(graphTasks);
  const visibleNodes = stableArray(filterGraph(graph, filter), (node) => node.code);
  const visibleCodes = new Set(visibleNodes.map((node) => node.code));
  const edges: SnapshotEdge[] = graph.edges
    .filter((edge) => visibleCodes.has(edge.source) && visibleCodes.has(edge.target))
    .map((edge) => ({ ...edge }));

  const nodes: SnapshotNode[] = visibleNodes.map((node) => ({
    id: node.code,
    code: node.code,
    ...(node.project ? { project: node.project } : {}),
    label: node.shortTask,
    detail: node.detail,
    status: node.status,
    severity: node.severity,
    agent: node.agent,
    ...(node.lane ? { lane: node.lane } : {}),
    ...(typeof node.durationEstimate === "number" ? { durationEstimate: node.durationEstimate } : {}),
    ...(typeof node.orderHint === "number" ? { orderHint: node.orderHint } : {}),
    ...(node.sourceRef ? { sourceRef: node.sourceRef } : {}),
    ...(node.planCode ? { planCode: node.planCode } : {}),
    ...(node.prompt ? { prompt: node.prompt } : {}),
    ...(node.acceptance ? { acceptance: node.acceptance } : {}),
    ...(node.outOfScope ? { outOfScope: node.outOfScope } : {}),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    dependsOn: node.dependsOn,
    ready: node.ready,
    blockedByCount: node.blockedByCount,
    downstreamCount: node.downstreamCount,
    tags: node.tags,
    tooltip: `${node.code} · ${node.shortTask}`
  }));

  return {
    generatedAt: new Date().toISOString(),
    filters: filter,
    nodes,
    edges,
    stats: {
      taskCount: nodes.length,
      edgeCount: edges.length,
      readyCount: nodes.filter((node) => node.ready).length,
      blockedCount: nodes.filter((node) => node.blockedByCount > 0 && node.status !== "DONE").length,
      cycleCount: graph.cycles.length,
      doneCount: nodes.filter((node) => node.status === "DONE").length,
      inProgressCount: nodes.filter((node) => node.status === "IN_PROGRESS").length,
      pendingCount: nodes.filter((node) => node.status === "PENDING").length,
      failedCount: nodes.filter((node) => node.status === "FAILED").length,
      totalEstimatedDuration: nodes.reduce((total, node) => total + (node.durationEstimate ?? 0), 0),
      readyEstimatedDuration: nodes.filter((node) => node.ready).reduce((total, node) => total + (node.durationEstimate ?? 0), 0)
    },
    cycles: graph.cycles,
    warnings: graph.warnings,
    ...(filter.planCode && context?.plan?.code === filter.planCode ? { planContext: context.plan } : {})
  };
}

export function criticalPathEstimate(tasks: TaskRecord[]): CriticalPathResult {
  const graph = buildTaskGraph(tasks);
  const withEstimate = tasks.filter((task) => typeof task.durationEstimate === "number").length;
  const withoutEstimate = tasks.length - withEstimate;

  if (graph.cycles.length > 0) {
    return {
      available: false,
      coverage: { withEstimate, withoutEstimate },
      reason: "critical path unavailable because dependency cycles were detected"
    };
  }

  if (withoutEstimate > 0) {
    return {
      available: false,
      coverage: { withEstimate, withoutEstimate },
      reason: "critical path requires duration_estimate on every task"
    };
  }

  const distance = new Map<string, number>();
  const predecessor = new Map<string, string | undefined>();
  const byCode = new Map(tasks.map((task) => [task.code, task]));

  for (const code of graph.topologicalOrder) {
    const task = byCode.get(code);
    if (!task) {
      continue;
    }
    const own = task.durationEstimate ?? 0;
    const dependencies = graph.reverseAdjacency.get(code) ?? [];
    let best = own;
    let bestParent: string | undefined;
    for (const dependency of dependencies) {
      const candidate = (distance.get(dependency) ?? 0) + own;
      if (candidate >= best) {
        best = candidate;
        bestParent = dependency;
      }
    }
    distance.set(code, best);
    predecessor.set(code, bestParent);
  }

  const [endNode, totalDuration] = [...distance.entries()].sort((left, right) => right[1] - left[1])[0] ?? ["", 0];
  const path: string[] = [];
  let cursor: string | undefined = endNode;
  while (cursor) {
    path.unshift(cursor);
    cursor = predecessor.get(cursor);
  }

  return {
    available: true,
    totalDuration,
    path,
    coverage: { withEstimate, withoutEstimate }
  };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
