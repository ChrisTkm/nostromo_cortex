import type { ReactNode } from "react";
import "./Panel.css";

interface PanelProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "canvas";
}

export function Panel({
  children,
  className,
  variant = "default",
}: PanelProps) {
  return (
    <div
      className={[
        "molecule-panel",
        `molecule-panel--${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
