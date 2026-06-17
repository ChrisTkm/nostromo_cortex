import type { ReactNode } from "react";
import "./Toggle.css";

export interface ToggleOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface ToggleProps<T extends string> {
  options: ToggleOption<T>[];
  value: T;
  onChange(value: T): void;
  className?: string;
}

/**
 * Segmented control for either/or controls: orbit/flow (brain), LR/TB (graph),
 * lanes on/off, etc. One option active at a time.
 */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  className,
}: ToggleProps<T>) {
  return (
    <div
      className={["atom-toggle", className].filter(Boolean).join(" ")}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={`atom-toggle__option${option.value === value ? " atom-toggle__option--active" : ""}`}
          key={option.value}
          onClick={() => onChange(option.value)}
          title={option.title}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
