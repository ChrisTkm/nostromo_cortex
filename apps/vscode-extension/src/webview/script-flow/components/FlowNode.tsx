import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { ScriptFlowNodeKind } from "../../../scriptFlow/types.js";

export type FlowNodeData = {
  kind: ScriptFlowNodeKind;
  kindLabel: string;
  label: string;
  rangeLabel?: string;
};

export function FlowNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <>
      <Handle className="script-flow-node-card__handle" position={Position.Left} type="target" />
      <div className={`script-flow-node-card script-flow-node-card--${data.kind}${selected ? " script-flow-node-card--selected" : ""}`}>
        <div className="script-flow-node-card__header">
          <span className="script-flow-node-card__kind">{data.kindLabel}</span>
          <span className="script-flow-node-card__accent" />
        </div>
        <div className="script-flow-node-card__label">{data.label}</div>
        {data.rangeLabel ? <div className="script-flow-node-card__range">{data.rangeLabel}</div> : null}
      </div>
      <Handle className="script-flow-node-card__handle" position={Position.Right} type="source" />
    </>
  );
}
