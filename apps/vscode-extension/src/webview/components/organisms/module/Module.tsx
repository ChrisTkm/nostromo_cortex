import type { ReactNode } from "react";
import "./Module.css";

interface ModuleProps {
  /** Top header (molecule Header). */
  header?: ReactNode;
  /** Second bar: search / filters / actions. */
  secondBar?: ReactNode;
  /** Banner area between the bars and the panel (plan banner, warnings). */
  banner?: ReactNode;
  /** Main content (the Panel: nodes or lists). */
  children: ReactNode;
  /** Bottom footer (status bar). */
  footer?: ReactNode;
  /** Slide-in drawer (rendered as overlay sibling). */
  drawer?: ReactNode;
  /** Extra overlays (plan viewer, modals). */
  overlay?: ReactNode;
  className?: string;
}

/**
 * Base panel organism shared by every module. Each region is optional: pass it
 * to render it, omit it to drop it. graph/brain/script-flow/plans/ledger/archive
 * all compose their chrome through this single shell.
 */
export function Module({
  header,
  secondBar,
  banner,
  children,
  footer,
  drawer,
  overlay,
  className,
}: ModuleProps) {
  return (
    <div className={["organism-module", className].filter(Boolean).join(" ")}>
      {header}
      {secondBar}
      {banner}
      <main className="organism-module__panel">{children}</main>
      {footer}
      {drawer}
      {overlay}
    </div>
  );
}
