import { type Node, type NodeProps } from "@xyflow/react";

export type LaneNodeData = { name: string; width: number; height: number };

export function LaneNode({ data }: NodeProps<Node<LaneNodeData>>) {
  return (
    <div className="lane-node" style={{ width: data.width, height: data.height }}>
      <span className="lane-node__label">{data.name}</span>
    </div>
  );
}
