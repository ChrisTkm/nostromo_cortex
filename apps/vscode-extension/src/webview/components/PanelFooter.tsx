import type { ReactNode } from "react";

interface PanelFooterProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

/**
 * Reusable panel footer (the bar that sits under a flow/graph canvas).
 * Mirrors the graph StatusBar layout — left stats, optional center, right
 * controls — so script-flow, graph and brain can share one chrome.
 */
export function PanelFooter({ left, center, right }: PanelFooterProps) {
  return (
    <footer className="panel-footer">
      <div className="panel-footer__section">{left}</div>
      {center ? (
        <div className="panel-footer__section panel-footer__section--center">
          {center}
        </div>
      ) : null}
      <div className="panel-footer__section panel-footer__section--right">
        {right}
      </div>
    </footer>
  );
}
