import dagre from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

import type { TaskNodeData } from "../graph/TaskNode";
import type { GraphDirection } from "../types";

const NODE_WIDTH = 244;
const NODE_HEIGHT = 140;

export type LaneSummary = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function computeLayout(
  nodes: Array<Node<TaskNodeData>>,
  edges: Edge[],
  direction: GraphDirection,
  groupByLane?: boolean
): {
  nodes: Array<Node<TaskNodeData>>;
  edges: Edge[];
  lanes?: LaneSummary[];
} {
  const laneNames = [...new Set(nodes.map((n) => n.data.lane).filter((lane): lane is string => Boolean(lane)))];
  const hasLanes = groupByLane === true && laneNames.length > 0;

  const graph = new dagre.graphlib.Graph({ compound: hasLanes }).setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 56,
    ranksep: 100,
    marginx: 20,
    marginy: 20
  });

  if (hasLanes) {
    for (const laneName of laneNames) {
      graph.setNode(`lane:${laneName}`, { label: laneName });
    }
  }

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    if (hasLanes && node.data.lane) {
      graph.setParent(node.id, `lane:${node.data.lane}`);
    }
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const lanes: LaneSummary[] | undefined = hasLanes
    ? laneNames.map((laneName) => {
        const cluster = graph.node(`lane:${laneName}`);
        return {
          id: `lane:${laneName}`,
          name: laneName,
          x: cluster.x - cluster.width / 2,
          y: cluster.y - cluster.height / 2,
          width: cluster.width,
          height: cluster.height
        };
      })
    : undefined;

  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id);
      return {
        ...node,
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - NODE_HEIGHT / 2
        },
        sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
        targetPosition: direction === "LR" ? Position.Left : Position.Top
      };
    }),
    edges,
    lanes
  };
}
