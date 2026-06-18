import type { ReactNode } from "react";
import "./SecondBar.css";

interface SecondBarProps {
  filters?: ReactNode;
  search?: ReactNode;
  status?: ReactNode;
}

export function SecondBar({ filters, search, status }: SecondBarProps) {
  return (
    <div className="molecule-second-bar">
      {search ? <div className="molecule-second-bar__search">{search}</div> : null}
      {filters ? (
        <div className="molecule-second-bar__filters">{filters}</div>
      ) : null}
      {status ? <div className="molecule-second-bar__status">{status}</div> : null}
    </div>
  );
}
