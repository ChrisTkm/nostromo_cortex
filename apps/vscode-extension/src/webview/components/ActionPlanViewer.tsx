import type { ActionPlanRecord, PlanTaskSummary } from "../types";

export function ActionPlanViewer(props: {
  onClose(): void;
  onSelectTask(code: string): void;
  plan: ActionPlanRecord;
  tasks: PlanTaskSummary[];
}) {
  const progress = props.plan.progress.total > 0 ? Math.round((props.plan.progress.done / props.plan.progress.total) * 100) : 0;

  return (
    <aside className="action-plan-viewer">
      <div className="action-plan-viewer__header">
        <div>
          <div className="plan-banner__code">{props.plan.code}</div>
          <h2 className="action-plan-viewer__title">{props.plan.title}</h2>
        </div>
        <button className="app-toolbar__button" onClick={props.onClose} type="button">
          Close
        </button>
      </div>

      <div className="action-plan-viewer__body">
        <section className="action-plan-viewer__section">
          <div className="drawer-section__label">Progress</div>
          <div className="plan-banner__progress">
            <div className="plan-banner__progress-label">
              <span>
                {props.plan.progress.done}/{props.plan.progress.total} done
              </span>
              <span>{progress}%</span>
            </div>
            <div className="plan-banner__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={props.plan.progress.total} aria-valuenow={props.plan.progress.done}>
              <div className="plan-banner__progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </section>

        <section className="action-plan-viewer__section">
          <div className="drawer-section__label">Description</div>
          <div className="drawer-section__text">{props.plan.description || "No description provided."}</div>
        </section>

        <section className="action-plan-viewer__section">
          <div className="drawer-section__label">Goal</div>
          <div className="drawer-section__text">{props.plan.goal || "No goal provided."}</div>
        </section>

        <section className="action-plan-viewer__section">
          <div className="drawer-section__label">Context</div>
          <div className="drawer-section__text">{props.plan.context || "No context provided."}</div>
        </section>

        <section className="action-plan-viewer__section">
          <div className="drawer-section__label">Notes</div>
          <div className="drawer-section__text">{props.plan.notes || "No notes yet."}</div>
        </section>

        <section className="action-plan-viewer__section">
          <div className="drawer-section__label">Tasks</div>
          <div className="action-plan-viewer__tasks">
            {props.tasks.length > 0 ? (
              props.tasks.map((task) => (
                <button className="action-plan-task" key={task.code} onClick={() => props.onSelectTask(task.code)} type="button">
                  <div className="action-plan-task__row">
                    <span className="action-plan-task__code">{task.code}</span>
                    <span className={`task-node__status ${statusClassName(task.status)}`}>{statusLabel(task.status)}</span>
                  </div>
                  <div className="action-plan-task__label">{task.label}</div>
                  <div className="action-plan-task__meta">
                    {task.lane ? <span>{task.lane}</span> : null}
                    {typeof task.durationEstimate === "number" ? <span>{formatHours(task.durationEstimate)}</span> : null}
                  </div>
                </button>
              ))
            ) : (
              <div className="drawer-empty">No tasks found for this plan.</div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function statusLabel(status: PlanTaskSummary["status"]) {
  switch (status) {
    case "IN_PROGRESS":
      return "In progress";
    case "BLOCKED":
      return "Blocked";
    case "DONE":
      return "Done";
    case "FAILED":
      return "Failed";
    default:
      return "Pending";
  }
}

function statusClassName(status: PlanTaskSummary["status"]) {
  switch (status) {
    case "IN_PROGRESS":
      return "task-node__status--in-progress";
    case "BLOCKED":
      return "task-node__status--blocked";
    case "DONE":
      return "task-node__status--done";
    case "FAILED":
      return "task-node__status--failed";
    default:
      return "task-node__status--pending";
  }
}

function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`;
}
