import type { SelectHTMLAttributes } from "react";
import "./FilterSelect.css";

export function FilterSelect({
  className,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={["atom-filter-select", className].filter(Boolean).join(" ")}
      {...selectProps}
    />
  );
}
