import type { CSSProperties, ReactNode } from "react";
import "./Node.css";

interface NodeProps {
  /** Top-left identifier (task code, doc name, fn name). */
  code: ReactNode;
  /** Main title. */
  label: ReactNode;
  /** Optional secondary line under the label. */
  subtitle?: ReactNode;
  /** Top-right header slot (status pill, count). */
  headerRight?: ReactNode;
  /** Absolute top-right corner marker (severity dot). */
  corner?: ReactNode;
  /** Absolute bottom-right marker (agent/AI avatar). */
  avatar?: ReactNode;
  /** Bottom slot (lane chip, meta). */
  footer?: ReactNode;
  /** Accent color (CSS color/var). Drives the border — module semantics:
   *  graph=status, brain=kind, flow=type. */
  accent?: string;
  selected?: boolean;
  current?: boolean;
  className?: string;
  /** Extra nodes (e.g. React Flow Handles rendered by the wrapping node). */
  children?: ReactNode;
}

/**
 * Shared visual node. Same skeleton (corner · header code+slot · label ·
 * subtitle · footer) across graph, brain and script-flow; each module supplies
 * its own content and `accent`.
 */
export function Node({
  code,
  label,
  subtitle,
  headerRight,
  corner,
  avatar,
  footer,
  accent,
  selected,
  current,
  className,
  children,
}: NodeProps) {
  return (
    <div
      className={[
        "atom-node",
        selected ? "atom-node--selected" : "",
        current ? "atom-node--current" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        accent ? ({ "--node-accent": accent } as CSSProperties) : undefined
      }
    >
      {corner ? <div className="atom-node__corner">{corner}</div> : null}
      <div className="atom-node__header">
        <span className="atom-node__code">{code}</span>
        {headerRight ? (
          <span className="atom-node__header-right">{headerRight}</span>
        ) : null}
      </div>
      <div className="atom-node__label">{label}</div>
      {subtitle ? <div className="atom-node__subtitle">{subtitle}</div> : null}
      {footer ? <div className="atom-node__footer">{footer}</div> : null}
      {avatar ? <div className="atom-node__avatar">{avatar}</div> : null}
      {children}
    </div>
  );
}
