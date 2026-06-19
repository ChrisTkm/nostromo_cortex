import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import type {
  ScriptFlowAutoObservation,
  ScriptFlowNodeKind,
} from "../../../scriptFlow/types.js";
import { Node as AtomNode } from "../../components/atoms";

export type FlowNodeRuntimeData = {
  active: boolean;
  calls: number;
  avgMs: number;
  maxMs: number;
  errors: number;
  iterations: number;
  level: "low" | "medium" | "high" | "error";
};

export type FlowNodeReplayData = {
  label: string;
  error: boolean;
};

export type FlowNodeData = {
  kind: ScriptFlowNodeKind;
  kindLabel: string;
  label: string;
  rangeLabel?: string;
  async?: boolean;
  subKind?: string;
  searchHit?: boolean;
  crossFile?: boolean;
  sourceFile?: string;
  autoObservations?: ScriptFlowAutoObservation[];
  runtime?: FlowNodeRuntimeData;
  replay?: FlowNodeReplayData;
};

/** Etiqueta legible por tipo de nodo. Compartida con footer y drawer. */
export const KIND_LABELS: Record<ScriptFlowNodeKind, string> = {
  entry: "Entry",
  function: "Function",
  branch: "Branch",
  loop: "Loop",
  tryCatch: "Try/Catch",
  return: "Return",
  call: "Call",
  cte: "CTE",
  select: "Select",
  join: "Join",
  subquery: "Subquery",
};

/** Color de acento (borde del nodo) por tipo. Compartido con el drawer. */
export const NODE_ACCENT_VAR: Record<ScriptFlowNodeKind, string> = {
  entry: "var(--cortex-node-entry)",
  function: "var(--cortex-node-function)",
  branch: "var(--cortex-node-branch)",
  loop: "var(--cortex-node-loop)",
  tryCatch: "var(--cortex-node-try-catch)",
  return: "var(--cortex-node-return)",
  call: "var(--cortex-node-call)",
  cte: "var(--cortex-node-cte)",
  select: "var(--cortex-node-select)",
  join: "var(--cortex-node-join)",
  subquery: "var(--cortex-node-subquery)",
};

const SUB_KIND_LABELS: Record<string, string> = {
  try: "Try",
  catch: "Catch",
  finally: "Finally",
  except: "Except",
  else: "Else",
};

export function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const displayKindLabel =
    data.subKind && SUB_KIND_LABELS[data.subKind]
      ? SUB_KIND_LABELS[data.subKind]
      : data.kindLabel;
  const className = [
    "sf-atom-node",
    data.searchHit ? "sf-atom-node--search-hit" : "",
    data.crossFile ? "sf-atom-node--cross-file" : "",
    data.autoObservations?.some((item) => item.severity === "error")
      ? "sf-atom-node--has-error"
      : "",
    data.autoObservations?.some((item) => item.severity === "warning")
      ? "sf-atom-node--has-warning"
      : "",
    data.autoObservations?.some((item) => item.kind === "flow-gap")
      ? "sf-atom-node--flow-gap"
      : "",
    data.runtime ? "sf-atom-node--runtime" : "",
    data.runtime?.active ? "sf-atom-node--runtime-active" : "",
    data.runtime ? `sf-atom-node--runtime-${data.runtime.level}` : "",
    data.replay ? "sf-atom-node--replay-active" : "",
    data.replay?.error ? "sf-atom-node--replay-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const autoCounts = countAutoObservations(data.autoObservations ?? []);

  return (
    <AtomNode
      accent={NODE_ACCENT_VAR[data.kind]}
      className={className}
      code={<span className="sf-node__kind">{displayKindLabel}</span>}
      footer={
        <NodeFooter
          counts={autoCounts}
          sourceFile={data.crossFile ? data.sourceFile : undefined}
        />
      }
      headerRight={
        data.async ? <span className="sf-node__async">async</span> : undefined
      }
      label={data.label}
      selected={selected}
      subtitle={data.rangeLabel}
    >
      {data.runtime || data.replay ? (
        <RuntimeBadges replay={data.replay} runtime={data.runtime} />
      ) : null}
      <Handle
        className="sf-node__handle"
        position={Position.Left}
        type="target"
      />
      <Handle
        className="sf-node__handle"
        position={Position.Right}
        type="source"
      />
    </AtomNode>
  );
}

function RuntimeBadges(props: {
  replay?: FlowNodeReplayData;
  runtime?: FlowNodeRuntimeData;
}) {
  const { replay, runtime } = props;
  return (
    <span
      className="sf-node__runtime"
      title="Runtime evidence from .scriptflow.trace.jsonl"
    >
      {replay ? (
        <span
          className={`sf-node__runtime-badge sf-node__runtime-badge--replay${replay.error ? " sf-node__runtime-badge--error" : ""}`}
        >
          {replay.label}
        </span>
      ) : null}
      {runtime?.active ? (
        <span className="sf-node__runtime-badge sf-node__runtime-badge--active">
          active
        </span>
      ) : null}
      {runtime && runtime.calls > 0 ? (
        <span className="sf-node__runtime-badge">calls {runtime.calls}</span>
      ) : null}
      {runtime && runtime.avgMs > 0 ? (
        <span className="sf-node__runtime-badge">
          avg {formatMs(runtime.avgMs)}
        </span>
      ) : null}
      {runtime && runtime.maxMs > 0 ? (
        <span className="sf-node__runtime-badge">
          max {formatMs(runtime.maxMs)}
        </span>
      ) : null}
      {runtime && runtime.iterations > 0 ? (
        <span className="sf-node__runtime-badge">
          iter {formatCount(runtime.iterations)}
        </span>
      ) : null}
      {runtime && runtime.errors > 0 ? (
        <span className="sf-node__runtime-badge sf-node__runtime-badge--error">
          err {runtime.errors}
        </span>
      ) : null}
    </span>
  );
}

function NodeFooter(props: {
  counts: Record<ScriptFlowAutoObservation["kind"], number>;
  sourceFile?: string;
}) {
  const { counts, sourceFile } = props;
  const hasSignals =
    counts.inline > 0 || counts.diagnostic > 0 || counts["flow-gap"] > 0;
  if (!sourceFile && !hasSignals) {
    return null;
  }
  return (
    <span className="sf-node__footer">
      {sourceFile ? (
        <span className="sf-node__source">From {sourceFile}</span>
      ) : null}
      {counts.inline > 0 ? (
        <span className="sf-node__signal">Inline {counts.inline}</span>
      ) : null}
      {counts.diagnostic > 0 ? (
        <span className="sf-node__signal sf-node__signal--diagnostic">
          Diag {counts.diagnostic}
        </span>
      ) : null}
      {counts["flow-gap"] > 0 ? (
        <span className="sf-node__signal sf-node__signal--gap">
          Flow {counts["flow-gap"]}
        </span>
      ) : null}
    </span>
  );
}

function countAutoObservations(items: ScriptFlowAutoObservation[]) {
  return items.reduce<Record<ScriptFlowAutoObservation["kind"], number>>(
    (counts, item) => {
      counts[item.kind] += 1;
      return counts;
    },
    { inline: 0, diagnostic: 0, "flow-gap": 0 },
  );
}

function formatMs(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}
