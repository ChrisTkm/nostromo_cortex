import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { ScriptFlowNodeKind } from "../../../scriptFlow/types.js";

export type FlowNodeData = {
  kind: ScriptFlowNodeKind;
  kindLabel: string;
  label: string;
  rangeLabel?: string;
  async?: boolean;
  subKind?: string;
  searchHit?: boolean;
};

const SUB_KIND_LABELS: Record<string, string> = {
  try: "Try",
  catch: "Catch",
  finally: "Finally",
  except: "Except",
  else: "Else"
};

export function FlowNode({ data, selected }: NodeProps<FlowNodeData>) {
  const displayKindLabel = data.subKind && SUB_KIND_LABELS[data.subKind] ? SUB_KIND_LABELS[data.subKind] : data.kindLabel;
  return (
    <>
      <Handle className="script-flow-node-card__handle" position={Position.Left} type="target" />
      <div className={`script-flow-node-card script-flow-node-card--${data.kind}${selected ? " script-flow-node-card--selected" : ""}${data.searchHit ? " script-flow-node-card--search-hit" : ""}`}>
        <div className="script-flow-node-card__header">
          <span className="script-flow-node-card__kind">{displayKindLabel}</span>
          {data.async ? <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>async</span> : null}
          <span className="script-flow-node-card__accent" />
        </div>
        <div className="script-flow-node-card__label">{data.label}</div>
        {data.rangeLabel ? <div className="script-flow-node-card__range">{data.rangeLabel}</div> : null}
      </div>
      <Handle className="script-flow-node-card__handle" position={Position.Right} type="source" />
    </>
  );
}
