import type { GraphDirection, TaskStatus } from "../types";

const STATUS_META: Array<{ status: TaskStatus; label: string; className: string }> = [
  { status: "PENDING", label: "Pending", className: "status-dot--pending" },
  { status: "IN_PROGRESS", label: "In progress", className: "status-dot--in-progress" },
  { status: "BLOCKED", label: "Blocked", className: "status-dot--blocked" },
  { status: "DONE", label: "Done", className: "status-dot--done" },
  { status: "FAILED", label: "Failed", className: "status-dot--failed" }
];

export function StatusBar(props: {
  onOrientationChange(direction: GraphDirection): void;
  onToggleMiniMap(): void;
  orientation: GraphDirection;
  showMiniMap: boolean;
  statusCounts: Record<TaskStatus, number>;
  totalTaskCount: number;
  visibleTaskCount: number;
  zoom: number;
}) {
  return (
    <footer className="status-bar">
      <div className="status-bar__section">
        <span className="status-bar__label">
          {props.visibleTaskCount}/{props.totalTaskCount} tasks
        </span>
      </div>
      <div className="status-bar__section status-bar__section--center">
        {STATUS_META.map((item) => (
          <span className="status-bar__metric" key={item.status} title={item.label}>
            <span className={`status-dot ${item.className}`} />
            {props.statusCounts[item.status]}
          </span>
        ))}
      </div>
      <div className="status-bar__section status-bar__section--right">
        <span className="status-bar__label">{Math.round(props.zoom * 100)}%</span>
        <button className="status-bar__button" onClick={() => props.onOrientationChange(props.orientation === "LR" ? "TB" : "LR")} type="button">
          {props.orientation}
        </button>
        <button className={`status-bar__button${props.showMiniMap ? " status-bar__button--active" : ""}`} onClick={props.onToggleMiniMap} type="button">
          MiniMap
        </button>
      </div>
    </footer>
  );
}
