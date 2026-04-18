import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import { computeLayout } from "../lib/layout";
import type { GraphDirection, GraphSnapshot, SnapshotNode, TaskStatus } from "../types";
import { TaskNode, type TaskNodeData } from "./TaskNode";

export function Graph(props: {
  centerTaskCode?: string;
  emptyMessage?: string;
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [instance, setInstance] = useState<ReactFlowInstance<Node<TaskNodeData>, Edge> | null>(null);

  const nodeTypes = useMemo(() => ({ task: TaskNode }), []);
  const rawNodes = useMemo<Array<Node<TaskNodeData>>>(() => {
    if (!props.snapshot) {
      return [];
    }

    return props.snapshot.nodes.map((node) => ({
      id: node.id,
      type: "task",
      selected: node.code === props.selectedTaskCode,
      data: buildTaskNodeData(node, props.orientation, props.snapshot.planContext?.currentTaskCode),
      position: { x: 0, y: 0 }
    }));
  }, [props.orientation, props.selectedTaskCode, props.snapshot]);

  const rawEdges = useMemo<Edge[]>(() => {
    if (!props.snapshot) {
      return [];
    }

    const nodeStatusById = new Map(props.snapshot.nodes.map((node) => [node.id, node.status]));

    return props.snapshot.edges.map((edge) => {
      const sourceStatus = nodeStatusById.get(edge.source);
      const targetStatus = nodeStatusById.get(edge.target);
      const isActiveFrontier =
        sourceStatus === "DONE" && (targetStatus === "PENDING" || targetStatus === "IN_PROGRESS");

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
  }, [props.snapshot]);

  useEffect(() => {
    if (!props.snapshot) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const layouted = computeLayout(rawNodes, rawEdges, props.orientation);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [props.orientation, props.snapshot, rawEdges, rawNodes, setEdges, setNodes]);

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

function buildTaskNodeData(node: SnapshotNode, direction: GraphDirection, currentTaskCode?: string): TaskNodeData {
  return {
    code: node.code,
    label: node.label,
    severity: node.severity,
    status: node.status,
    lane: node.lane,
    direction,
    isCurrentTask: node.code === currentTaskCode
  };
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
