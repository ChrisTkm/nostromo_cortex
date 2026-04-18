import type { ActionPlanRecord } from "../types";

const RING_RADIUS = 14;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function HudCorner(props: {
  planContext?: ActionPlanRecord;
  totalHours: number;
}) {
  const done = props.planContext?.progress.done ?? 0;
  const total = props.planContext?.progress.total ?? 0;
  const progress = total > 0 ? done / total : 0;
  const offset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <div className="hud-corner hud-corner--inline">
      <div className="hud-corner__summary">
        <div className="hud-corner__label">Hours</div>
        <div className="hud-corner__value">{formatHours(props.totalHours)}</div>
      </div>
      {props.planContext ? (
        <div className="hud-corner__ring-wrap" title={`${done}/${total} tasks done in ${props.planContext.code}`}>
          <svg className="hud-corner__ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="hud-corner__ring-track" cx="18" cy="18" r={RING_RADIUS} />
            <circle
              className="hud-corner__ring-fill"
              cx="18"
              cy="18"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="hud-corner__ring-text">
            {done}/{total}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`;
}
