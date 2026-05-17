import type { ActionPlanRecord } from "../types";

export function PlanBanner(props: {
  isRefreshing: boolean;
  onOpenPlan(): void;
  onRefresh(): void;
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
          <div className="plan-banner__title-block">
            <div className="plan-banner__code">{planContext.code}</div>
            <h2 className="plan-banner__title">{planContext.title}</h2>
          </div>
          <button
            aria-label="Refresh grafo"
            className={`plan-banner__refresh${props.isRefreshing ? " plan-banner__refresh--loading" : ""}`}
            disabled={props.isRefreshing}
            onClick={(event) => {
              event.stopPropagation();
              props.onRefresh();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            title="Refresh grafo"
            type="button"
          >
            <svg aria-hidden="true" className="plan-banner__refresh-icon" viewBox="0 0 16 16">
              <path d="M13.6 2.4v4h-4v-1h2.18A4.76 4.76 0 0 0 8 3.75 4.25 4.25 0 1 0 11.52 10.4l.82.58A5.25 5.25 0 1 1 8 2.75c1.77 0 3.35.87 4.32 2.2V2.4h1.28Z" />
            </svg>
          </button>
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
