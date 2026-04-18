import type { ActionPlanRecord } from "../types";

export function PlanBanner(props: {
  onOpenPlan(): void;
  planContext: ActionPlanRecord;
  onFocusTask(code: string): void;
}) {
  const { planContext } = props;
  const progress = planContext.progress.total > 0 ? Math.round((planContext.progress.done / planContext.progress.total) * 100) : 0;

  return (
    <section className="plan-banner plan-banner--interactive" onClick={props.onOpenPlan} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        props.onOpenPlan();
      }
    }}>
      <div className="plan-banner__meta">
        <div className="plan-banner__eyebrow">Active plan</div>
        <div className="plan-banner__title-row">
          <div>
            <div className="plan-banner__code">{planContext.code}</div>
            <h2 className="plan-banner__title">{planContext.title}</h2>
          </div>
          {planContext.currentTaskCode ? (
            <button className="plan-banner__chip" onClick={(event) => {
              event.stopPropagation();
              props.onFocusTask(planContext.currentTaskCode!);
            }} type="button">
              Current task: {planContext.currentTaskCode}
            </button>
          ) : null}
        </div>
      </div>
      <div className="plan-banner__progress">
        <div className="plan-banner__progress-label">
          <span>
            {planContext.progress.done}/{planContext.progress.total} done
          </span>
          <span>{progress}%</span>
        </div>
        <div className="plan-banner__progress-track" role="progressbar" aria-valuemax={planContext.progress.total} aria-valuemin={0} aria-valuenow={planContext.progress.done}>
          <div className="plan-banner__progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </section>
  );
}
