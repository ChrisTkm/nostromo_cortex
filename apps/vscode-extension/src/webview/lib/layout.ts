import dagre from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

import type { TaskNodeData } from "../components/TaskNode";
import type { GraphDirection } from "../types";

const NODE_WIDTH = 244;
const NODE_HEIGHT = 112;

export function computeLayout(
  nodes: Array<Node<TaskNodeData>>,
  edges: Edge[],
  direction: GraphDirection
): {
  nodes: Array<Node<TaskNodeData>>;
  edges: Edge[];
} {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 46 : 54,
    ranksep: direction === "LR" ? 96 : 112
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

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
    edges
  };
}
