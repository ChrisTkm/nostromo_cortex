import { useId, type ReactNode } from "react";
import "./BarChart.css";

export type BarChartDatum = {
  /** Stable key + axis label. */
  label: string;
  value: number;
  /** Optional richer label for the hover tooltip (defaults to label). */
  title?: string;
};

interface BarChartProps {
  data: BarChartDatum[];
  /** Chart body height in px. Default 96. */
  height?: number;
  /** Render the numeric value above each bar. Default true. */
  showValues?: boolean;
  /** Empty-state message. */
  empty?: ReactNode;
  className?: string;
}

/**
 * Compact column chart. One bar per datum, scaled to the max value, with the
 * peak bar emphasized. Purely presentational — caller computes the series.
 */
export function BarChart({
  data,
  height = 96,
  showValues = true,
  empty = "Sin datos",
  className,
}: BarChartProps) {
  const labelId = useId();

  if (data.length === 0) {
    return <div className="atom-bar-chart atom-bar-chart--empty">{empty}</div>;
  }

  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div
      className={["atom-bar-chart", className].filter(Boolean).join(" ")}
      role="img"
      aria-labelledby={labelId}
    >
      <span className="atom-bar-chart__sr" id={labelId}>
        {data.map((d) => `${d.label}: ${d.value}`).join(", ")}
      </span>
      <div className="atom-bar-chart__plot" style={{ height }}>
        {data.map((d) => {
          const pct = max > 0 ? (d.value / max) * 100 : 0;
          const isPeak = d.value === max && d.value > 0;
          return (
            <div className="atom-bar-chart__col" key={d.label}>
              {showValues ? (
                <span className="atom-bar-chart__value">{d.value}</span>
              ) : null}
              <div className="atom-bar-chart__track">
                <div
                  className={`atom-bar-chart__bar${isPeak ? " atom-bar-chart__bar--peak" : ""}${d.value === 0 ? " atom-bar-chart__bar--zero" : ""}`}
                  style={{ height: `${pct}%` }}
                  title={d.title ?? `${d.label}: ${d.value}`}
                />
              </div>
              <span className="atom-bar-chart__label" title={d.label}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
