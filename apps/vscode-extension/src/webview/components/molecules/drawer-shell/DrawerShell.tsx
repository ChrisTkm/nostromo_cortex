import type { ReactNode } from "react";
import { Button } from "../../atoms";
import "./DrawerShell.css";

interface DrawerShellProps {
  /** Banner left side: action/tab buttons (atoms). */
  actions?: ReactNode;
  /** When provided, renders the ✕ close button in the banner corner. */
  onClose?: () => void;
  /** Optional header slot (code · title · status, or eyebrow · title · status). */
  header?: ReactNode;
  /** Body content. */
  children: ReactNode;
  className?: string;
  isExpanded?: boolean;
  isOpen?: boolean;
}

/**
 * Shared drawer chrome (slide-in container + banner + header + body). Each
 * module composes its own body — that's how a single drawer serves view and edit.
 */
export function DrawerShell({
  actions,
  onClose,
  header,
  children,
  className,
  isExpanded = false,
  isOpen,
}: DrawerShellProps) {
  const isSlideIn = typeof isOpen === "boolean";

  return (
    <div
      className={["drawer-shell", className].filter(Boolean).join(" ")}
      data-expanded={isSlideIn && isExpanded ? "true" : undefined}
      data-open={isSlideIn && isOpen ? "true" : undefined}
      data-sidebar={isSlideIn ? "true" : undefined}
    >
      {actions || onClose ? (
        <div className="drawer-banner">
          <div className="drawer-banner__tabs">{actions}</div>
          {onClose ? (
            <Button
              aria-label="Cerrar"
              className="drawer-banner__close"
              intent="change"
              onClick={onClose}
              size="small"
            >
              ✕
            </Button>
          ) : null}
        </div>
      ) : null}
      {header ? <header className="drawer-header">{header}</header> : null}
      <div className="drawer-body">{children}</div>
    </div>
  );
}
