/* * BORRAR — huérfano tras migración atómica de graph. El selector de plan
   ahora vive inline en Toolbar (graph-secondbar). Borrar también sus estilos
   `.plan-filter*` en webview/styles.css. */
import type { ActionPlanRecord } from "./types";
import { Button, FilterSelect } from "../components/atoms";

export function PlanFilter(props: {
  onViewPlan(): void;
  plans: ActionPlanRecord[];
  selectedPlanCode?: string;
  onClearPlan(): void;
  onSelectPlan(code: string): void;
}) {
  return (
    <div className="plan-filter-inline">
      <FilterSelect
        aria-label="Select plan"
        onChange={(event) => {
          const next = event.target.value;
          if (next) {
            props.onSelectPlan(next);
            return;
          }
          props.onClearPlan();
        }}
        value={props.selectedPlanCode ?? ""}
      >
        <option value="">Plan · all</option>
        {props.plans.map((plan) => (
          <option key={plan.code} value={plan.code}>
            {plan.code} · {plan.title}
          </option>
        ))}
      </FilterSelect>
      <Button
        disabled={!props.selectedPlanCode}
        intent="action"
        onClick={props.onViewPlan}
        size="small"
      >
        Ver plan
      </Button>
    </div>
  );
}
