import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { GraphDirection, TaskSeverity, TaskStatus } from "../types";
import { Node, Status, type StatusTone } from "../components/atoms";

export type TaskNodeData = {
  code: string;
  label: string;
  severity: TaskSeverity;
  status: TaskStatus;
  lane?: string;
  direction: GraphDirection;
  isCurrentTask: boolean;
  agent?: string;
  agentIconUrl?: string;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
  FAILED: "Failed",
};

const STATUS_TONES: Record<TaskStatus, StatusTone> = {
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  BLOCKED: "blocked",
  DONE: "done",
  FAILED: "failed",
};

const STATUS_ACCENT: Record<TaskStatus, string> = {
  PENDING: "var(--status-pending)",
  IN_PROGRESS: "var(--status-in-progress)",
  BLOCKED: "var(--status-blocked)",
  DONE: "var(--status-done)",
  FAILED: "var(--status-failed)",
};

export function TaskNode({ data, selected }: NodeProps) {
  const node = data as TaskNodeData;
  const targetPosition = node.direction === "LR" ? Position.Left : Position.Top;
  const sourcePosition =
    node.direction === "LR" ? Position.Right : Position.Bottom;

  return (
    <>
      <Handle
        className="task-node__handle"
        position={targetPosition}
        type="target"
      />
      <Node
        accent={STATUS_ACCENT[node.status]}
        code={node.code}
        avatar={
          node.agentIconUrl ? (
            <img
              alt={node.agent ?? "agent"}
              className="task-node__agent-icon"
              height={18}
              src={node.agentIconUrl}
              title={node.agent ?? ""}
              width={18}
            />
          ) : undefined
        }
        corner={
          <span
            className={`task-node__severity-dot task-node__severity-dot--${node.severity.toLowerCase()}`}
            title={node.severity}
          />
        }
        current={node.isCurrentTask}
        footer={
          node.lane ? (
            <span className="atom-node__tag">{node.lane}</span>
          ) : undefined
        }
        headerRight={
          <Status tone={STATUS_TONES[node.status]}>
            {STATUS_LABELS[node.status]}
          </Status>
        }
        label={node.label}
        selected={selected}
      />
      <Handle
        className="task-node__handle"
        position={sourcePosition}
        type="source"
      />
    </>
  );
}
