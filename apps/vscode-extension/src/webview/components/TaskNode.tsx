import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { GraphDirection, TaskSeverity, TaskStatus } from "../types";

export type TaskNodeData = {
  code: string;
  label: string;
  severity: TaskSeverity;
  status: TaskStatus;
  lane?: string;
  direction: GraphDirection;
  isCurrentTask: boolean;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
  FAILED: "Failed"
};

const STATUS_CLASS_NAMES: Record<TaskStatus, string> = {
  PENDING: "task-node__status--pending",
  IN_PROGRESS: "task-node__status--in-progress",
  BLOCKED: "task-node__status--blocked",
  DONE: "task-node__status--done",
  FAILED: "task-node__status--failed"
};

export function TaskNode({ data, selected }: NodeProps) {
  const targetPosition = data.direction === "LR" ? Position.Left : Position.Top;
  const sourcePosition = data.direction === "LR" ? Position.Right : Position.Bottom;

  return (
    <>
      <Handle className="task-node__handle" position={targetPosition} type="target" />
      <div className={`task-node${selected ? " task-node--selected" : ""}${data.isCurrentTask ? " current-task" : ""}`}>
        <span className={`task-node__severity-dot task-node__severity-dot--${data.severity.toLowerCase()}`} title={data.severity} />
        <div className="task-node__header">
          <span className="task-node__code">{data.code}</span>
          <span className={`task-node__status ${STATUS_CLASS_NAMES[data.status]}`}>{STATUS_LABELS[data.status]}</span>
        </div>
        <div className="task-node__label">{data.label}</div>
        {data.lane ? <div className="task-node__lane">{data.lane}</div> : null}
      </div>
      <Handle className="task-node__handle" position={sourcePosition} type="source" />
    </>
  );
}
