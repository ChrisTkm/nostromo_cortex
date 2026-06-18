import { useRef, useState } from "react";
import { Button } from "../../atoms";
import { PortalPopover } from "../../../graph/PortalPopover";
import "./MultiSelect.css";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onToggle(value: string): void;
  onAll?(): void;
  onNone?(): void;
  className?: string;
}

/**
 * Dropdown multi-select with a checkbox list + All/None actions. Unifies the
 * brain "kind" selectors and any other multi-pick filter into one component.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  onAll,
  onNone,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedSet = new Set(selected);

  return (
    <div
      className={["molecule-multi-select", className].filter(Boolean).join(" ")}
    >
      <Button
        className={open ? "is-active" : undefined}
        intent="change"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        size="small"
      >
        {label} · {selected.length}/{options.length}
      </Button>
      {open ? (
        <PortalPopover
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
        >
          <div className="multi-select__panel">
            {onAll || onNone ? (
              <div className="multi-select__actions">
                {onAll ? (
                  <Button intent="change" onClick={onAll} size="small">
                    Todos
                  </Button>
                ) : null}
                {onNone ? (
                  <Button intent="change" onClick={onNone} size="small">
                    Ninguno
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="multi-select__list">
              {options.length === 0 ? (
                <div className="multi-select__empty">Sin opciones</div>
              ) : (
                options.map((option) => (
                  <label className="multi-select__option" key={option.value}>
                    <input
                      checked={selectedSet.has(option.value)}
                      onChange={() => onToggle(option.value)}
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </PortalPopover>
      ) : null}
    </div>
  );
}
