import type { ReactNode } from "react";
import { ProgressiveBar } from "../../atoms";
import "./StatusBar.css";

interface StatusBarProps {
  code?: string;
  title?: string;
  eyebrow?: string;
  progress?: { done: number; total: number };
  chip?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}

export function StatusBar({
  code,
  title,
  eyebrow,
  progress,
  chip,
  actions,
  onClick,
}: StatusBarProps) {
  return (
    <section
      className={["molecule-status-bar", onClick ? "molecule-status-bar--interactive" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="molecule-status-bar__meta">
        {eyebrow ? <div className="molecule-status-bar__eyebrow">{eyebrow}</div> : null}
        <div className="molecule-status-bar__title-row">
          <div className="molecule-status-bar__title-block">
            {code ? <div className="molecule-status-bar__code">{code}</div> : null}
            {title ? <h2 className="molecule-status-bar__title">{title}</h2> : null}
          </div>
          {chip ? <div className="molecule-status-bar__chip-slot">{chip}</div> : null}
          {actions ? <div className="molecule-status-bar__actions">{actions}</div> : null}
        </div>
      </div>
      {progress ? (
        <ProgressiveBar
          label={<span>{progress.done}/{progress.total} done</span>}
          max={progress.total}
          value={progress.done}
        />
      ) : null}
    </section>
  );
}
