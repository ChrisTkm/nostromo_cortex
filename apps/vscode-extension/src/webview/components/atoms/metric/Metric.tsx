import type { ReactNode } from "react";
import "./Metric.css";

interface MetricProps {
  /** Optional muted prefix, e.g. "Critical path". */
  label?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Metric({ label, children, className, title }: MetricProps) {
  return (
    <span
      className={["atom-metric", className].filter(Boolean).join(" ")}
      title={title}
    >
      {label ? <span className="atom-metric__label">{label}</span> : null}
      <span className="atom-metric__value">{children}</span>
    </span>
  );
}
