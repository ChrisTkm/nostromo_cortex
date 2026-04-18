import { useRef, useState } from "react";

import type { ActionPlanRecord } from "../types";
import { PortalPopover } from "./PortalPopover";

export function PlanFilter(props: {
  onViewPlan(): void;
  plans: ActionPlanRecord[];
  selectedPlanCode?: string;
  onClearPlan(): void;
  onSelectPlan(code: string): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="filter-chip">
      <button
        className={`app-toolbar__button${open ? " app-toolbar__button--active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        {formatPlanLabel(props.selectedPlanCode)}
      </button>
      {open ? (
        <PortalPopover anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <div className="filter-popover plan-filter-popover">
            <div className="filter-popover__title">Plans</div>
            <div className="filter-popover__list">
              {props.plans.length === 0 ? (
                <div className="filter-popover__empty">No plans found</div>
              ) : (
                props.plans.map((plan) => {
                  const selected = plan.code === props.selectedPlanCode;
                  return (
                    <button
                      className={`plan-filter-option${selected ? " plan-filter-option--selected" : ""}`}
                      key={plan.code}
                      onClick={() => {
                        props.onSelectPlan(plan.code);
                        setOpen(false);
                      }}
                      type="button"
                    >
                      <span className="plan-filter-option__row">
                        <span className="plan-filter-option__code">{plan.code}</span>
                        <span className="plan-filter-option__progress">
                          {plan.progress.done}/{plan.progress.total}
                        </span>
                      </span>
                      <span className="plan-filter-option__title">{plan.title}</span>
                    </button>
                  );
                })
              )}
            </div>
            <button
              className="plan-filter-popover__view"
              disabled={!props.selectedPlanCode}
              onClick={() => {
                props.onViewPlan();
                setOpen(false);
              }}
              type="button"
            >
              Ver plan
            </button>
            <button
              className="plan-filter-popover__clear"
              onClick={() => {
                props.onClearPlan();
                setOpen(false);
              }}
              type="button"
            >
              Clear plan
            </button>
          </div>
        </PortalPopover>
      ) : null}
    </div>
  );
}

function formatPlanLabel(selectedPlanCode?: string) {
  return selectedPlanCode ? `Plan · ${selectedPlanCode}` : "Plan · all";
}
