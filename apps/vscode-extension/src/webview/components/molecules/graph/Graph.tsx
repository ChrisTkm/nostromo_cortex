import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LaneNode } from "../../../graph/LaneNode";
import { computeLayout } from "../../../lib/layout";
import type { CriticalPathResult, GraphDirection, GraphSnapshot, SnapshotNode, TaskStatus } from "../../../types";
import { TaskNode, type TaskNodeData } from "../../../graph/TaskNode";
import "./graph-styles.css";

type LayoutCacheValue = {
  positions: Map<string, { x: number; y: number }>;
  lanes: NonNullable<ReturnType<typeof computeLayout>["lanes"]>;
};

export function Graph(props: {
  agentIconBase?: string;
  centerTaskCode?: string;
  criticalPath?: CriticalPathResult;
  emptyMessage?: string;
  groupByLane?: boolean;
  onSelectTask(code: string): void;
  onViewportChange(zoom: number, pan: { x: number; y: number }): void;
  orientation: GraphDirection;
  pan?: { x: number; y: number };
  planFocusRequest?: { code: string; nonce: number };
  selectedTaskCode?: string;
  showMiniMap: boolean;
  snapshot: GraphSnapshot | null;
  zoom?: number;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [instance, setInstance] = useState<ReactFlowInstance<Node<any>, Edge> | null>(null);
  const layoutCacheRef = useRef<Map<string, LayoutCacheValue>>(new Map());
  const LAYOUT_CACHE_MAX = 5;

  const nodeTypes = useMemo(() => ({ lane: LaneNode, task: TaskNode }), []);
  const rawNodes = useMemo<Array<Node<TaskNodeData>>>(() => {
    if (!props.snapshot) {
      return [];
    }

    return props.snapshot.nodes.map((node) => ({
      id: node.id,
      type: "task",
      selected: node.code === props.selectedTaskCode,
      data: buildTaskNodeData(node, props.orientation, props.snapshot.planContext?.currentTaskCode, props.agentIconBase),
      position: { x: 0, y: 0 }
    }));
  }, [props.orientation, props.selectedTaskCode, props.snapshot]);

  const rawEdges = useMemo<Edge[]>(() => {
    if (!props.snapshot) {
      return [];
    }

    const nodeStatusById = new Map(props.snapshot.nodes.map((node) => [node.id, node.status]));

    const cpEdgeSet = new Set<string>();
    if (props.criticalPath?.available && props.criticalPath.path) {
      const cpPath = props.criticalPath.path;
      for (let i = 0; i < cpPath.length - 1; i++) {
        cpEdgeSet.add(`${cpPath[i]}->${cpPath[i + 1]}`);
      }
    }

    return props.snapshot.edges.map((edge) => {
      const sourceStatus = nodeStatusById.get(edge.source);
      const targetStatus = nodeStatusById.get(edge.target);
      const isActiveFrontier =
        sourceStatus === "DONE" && (targetStatus === "PENDING" || targetStatus === "IN_PROGRESS");
      const isCritical = cpEdgeSet.has(`${edge.source}->${edge.target}`);

      if (isCritical) {
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: true,
          className: "edge-critical-path",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
          style: { stroke: "#f59e0b", strokeWidth: 2.6 }
        } satisfies Edge;
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: isActiveFrontier,
        className: isActiveFrontier ? "edge-active-frontier" : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: isActiveFrontier ? "var(--accent-cyan)" : "#526279" },
        style: {
          stroke: isActiveFrontier ? "var(--accent-cyan)" : "#526279",
          strokeWidth: isActiveFrontier ? 2 : 2.2
        }
      } satisfies Edge;
    });
  }, [props.snapshot, props.criticalPath]);

  useEffect(() => {
    if (!props.snapshot) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const nodeIdSig = rawNodes.map((n) => n.id).sort().join(",");
    const edgeSig = rawEdges.map((e) => `${e.source}>${e.target}`).sort().join("|");
    const layoutKey = `${props.orientation}::${props.groupByLane ? "L" : "0"}::${nodeIdSig}::${edgeSig}`;

    const cache = layoutCacheRef.current;
    const sourcePosition = props.orientation === "LR" ? Position.Right : Position.Bottom;
    const targetPosition = props.orientation === "LR" ? Position.Left : Position.Top;

    let cached = cache.get(layoutKey);
    if (cached) {
      cache.delete(layoutKey);
      cache.set(layoutKey, cached);
    } else {
      const layouted = computeLayout(rawNodes, rawEdges, props.orientation, props.groupByLane);
      cached = {
        positions: new Map(layouted.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
        lanes: layouted.lanes ?? []
      };
      cache.set(layoutKey, cached);
      while (cache.size > LAYOUT_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }

    const positionedNodes = rawNodes.map((n) => {
      const pos = cached!.positions.get(n.id);
      if (!pos) return n;
      return { ...n, position: pos, sourcePosition, targetPosition };
    });

    const laneNodes = (cached.lanes ?? []).map((l) => ({
      id: l.id,
      type: "lane",
      position: { x: l.x, y: l.y },
      data: { name: l.name, width: l.width, height: l.height },
      draggable: false,
      selectable: false
    }));

    setNodes([...laneNodes, ...positionedNodes]);
    setEdges(rawEdges);
  }, [props.orientation, props.snapshot, rawEdges, rawNodes, setEdges, setNodes, props.groupByLane]);

  useEffect(() => {
    if (!instance || !props.snapshot) {
      return;
    }

    if (typeof props.zoom === "number" && props.pan) {
      instance.setViewport({ x: props.pan.x, y: props.pan.y, zoom: props.zoom });
      return;
    }

    void instance.fitView({ padding: 0.24, duration: 0 });
  }, [instance, props.orientation, props.pan, props.snapshot, props.zoom]);

  useEffect(() => {
    if (!instance || !props.centerTaskCode) {
      return;
    }

    const targetNode = nodes.find((node) => node.id === props.centerTaskCode);
    if (!targetNode) {
      return;
    }

    instance.setCenter(targetNode.position.x + 122, targetNode.position.y + 56, {
      duration: 180,
      zoom: Math.max(instance.getZoom(), 0.95)
    });
  }, [instance, nodes, props.centerTaskCode]);

  useEffect(() => {
    if (!instance || !props.planFocusRequest) {
      return;
    }

    const targetNode = nodes.find((node) => node.id === props.planFocusRequest?.code);
    if (!targetNode) {
      return;
    }

    void instance.fitView({
      nodes: [targetNode],
      padding: 0.38,
      duration: 220,
      maxZoom: Math.max(instance.getZoom(), 1)
    });
  }, [instance, nodes, props.planFocusRequest]);

  return (
    <div className="graph-shell">
      <ReactFlow
        fitView
        edges={edges}
        maxZoom={2.8}
        minZoom={0.2}
        nodeTypes={nodeTypes}
        nodes={nodes}
        onEdgesChange={onEdgesChange}
        onInit={setInstance}
        onMoveEnd={(_, viewport) => props.onViewportChange(viewport.zoom, { x: viewport.x, y: viewport.y })}
        onNodeClick={(_, node) => props.onSelectTask(node.id)}
        onNodesChange={onNodesChange}
      >
        <Controls />
        {props.showMiniMap ? (
          <MiniMap pannable zoomable nodeStrokeWidth={3} nodeColor={(node) => colorForStatus((node.data as TaskNodeData).status)} />
        ) : null}
        <Background color="rgba(148, 163, 184, 0.18)" gap={18} size={1} variant={BackgroundVariant.Dots} />
      </ReactFlow>
      {props.snapshot && props.snapshot.nodes.length === 0 ? <div className="graph-empty">{props.emptyMessage ?? "No tasks match the current filters."}</div> : null}
    </div>
  );
}

function buildTaskNodeData(node: SnapshotNode, direction: GraphDirection, currentTaskCode?: string, agentIconBase?: string): TaskNodeData {
  return {
    code: node.code,
    label: node.label,
    severity: node.severity,
    status: node.status,
    lane: node.lane,
    direction,
    isCurrentTask: node.code === currentTaskCode,
    agent: node.agent,
    agentIconUrl: resolveAgentIconUrl(node.agent, agentIconBase)
  };
}

const KNOWN_AGENT_SLUGS = new Set(["big-pickle", "copilot", "codex", "claude"]);

function resolveAgentIconUrl(agent: string | undefined, base: string | undefined): string | undefined {
  if (!base) return undefined;
  const slug = (agent ?? "").toLowerCase().trim().replace(/\s+/g, "-");
  const safe = KNOWN_AGENT_SLUGS.has(slug) ? slug : "user";
  return `${base}/${safe}.svg`;
}

function colorForStatus(status: TaskStatus) {
  switch (status) {
    case "DONE":
      return "var(--status-done)";
    case "IN_PROGRESS":
      return "var(--status-in-progress)";
    case "BLOCKED":
      return "var(--status-blocked)";
    case "FAILED":
      return "var(--status-failed)";
    default:
      return "var(--status-pending)";
  }
}
