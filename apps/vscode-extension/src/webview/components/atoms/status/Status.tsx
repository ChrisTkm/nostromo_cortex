import type { ReactNode } from "react";
import "./Status.css";

export type StatusTone =
  | "pending"
  | "in-progress"
  | "blocked"
  | "done"
  | "failed";

interface StatusProps {
  children?: ReactNode;
  className?: string;
  title?: string;
  tone: StatusTone;
}

export function Status({ children, className, title, tone }: StatusProps) {
  return (
    <span
      className={["atom-status", `atom-status--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      title={title}
    >
      <span className="atom-status__dot" />
      {children}
    </span>
  );
}
