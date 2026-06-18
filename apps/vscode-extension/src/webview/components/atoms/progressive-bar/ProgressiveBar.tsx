import type { ReactNode } from "react";
import type { StatusTone } from "../status";
import "./ProgressiveBar.css";

interface ProgressiveBarProps {
  label?: ReactNode;
  max: number;
  value: number;
  /** Fill color, mapped to the shared status palette. Default: done (green). */
  tone?: StatusTone;
  /**
   * `default` is the full bar (status banners). `compact` is the thin, label-less
   * inline bar meant for list rows (plans uses this variant).
   */
  variant?: "default" | "compact";
}

export function ProgressiveBar({
  label,
  max,
  value,
  tone = "done",
  variant = "default",
}: ProgressiveBarProps) {
  const safeMax = Number.isFinite(max) ? Math.max(0, max) : 0;
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const clampedValue = safeMax > 0 ? Math.min(safeValue, safeMax) : 0;
  const percent = safeMax > 0 ? Math.round((clampedValue / safeMax) * 100) : 0;
  const isComplete = safeMax > 0 && clampedValue >= safeMax;

  return (
    <div
      className={[
        "atom-progressive-bar",
        `atom-progressive-bar--${variant}`,
        isComplete ? "atom-progressive-bar--complete" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tone={tone}
    >
      {label && variant !== "compact" ? (
        <div className="atom-progressive-bar__label">
          {label}
          <span>{percent}%</span>
        </div>
      ) : null}
      <div
        aria-valuemax={safeMax}
        aria-valuemin={0}
        aria-valuenow={clampedValue}
        className="atom-progressive-bar__track"
        role="progressbar"
      >
        <div
          className="atom-progressive-bar__fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
