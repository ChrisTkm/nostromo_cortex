import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { PortalPopover } from "./PortalPopover";
import { Button, FilterSelect, Search } from "../components/atoms";
import type { FilterCatalog, TaskFilter } from "./types";

export function GraphToolbar(props: {
  catalog: FilterCatalog;
  filters: TaskFilter;
  onClearPlan(): void;
  onFilterChange(filter: TaskFilter): void;
  onSelectPlan(code: string): void;
  onViewPlan(): void;
  plans: Array<{
    code: string;
    title: string;
    progress: { done: number; total: number };
  }>;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
  selectedPlanCode?: string;
}) {
  const [searchDraft, setSearchDraft] = useState(props.filters.search ?? "");

  useEffect(() => {
    setSearchDraft(props.filters.search ?? "");
  }, [props.filters.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const nextSearch = searchDraft.trim();
      if ((props.filters.search ?? "") === nextSearch) {
        return;
      }
      props.onFilterChange(
        nextSearch
          ? { ...props.filters, search: nextSearch }
          : withoutSearch(props.filters),
      );
    }, 200);
    return () => window.clearTimeout(handle);
  }, [props, searchDraft]);

  return (
    <div className="graph-secondbar">
      <FilterSelect
        aria-label="Select plan"
        className="graph-secondbar__plan"
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
        intent="change"
        onClick={props.onViewPlan}
        size="small"
      >
        Ver plan
      </Button>

      <div className="graph-secondbar__search">
        <Search
          inputRef={props.searchInputRef}
          onChange={setSearchDraft}
          placeholder="Search code, detail, lane, tags..."
          value={searchDraft}
        />
      </div>

      <GroupSelect
        options={props.catalog.groups}
        selected={props.filters.group ?? []}
        onToggle={(value) =>
          props.onFilterChange(toggleGroup(props.filters, value))
        }
      />
    </div>
  );
}

function GroupSelect(props: {
  options: string[];
  selected: string[];
  onToggle(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const label =
    props.selected.length === 0
      ? "Group · all"
      : props.selected.length === 1
        ? `Group · ${props.selected[0]}`
        : `Group · ${props.selected[0]} +${props.selected.length - 1}`;

  return (
    <div className="graph-secondbar__group">
      <Button
        className={open ? "is-active" : undefined}
        intent="change"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        size="small"
      >
        {label}
      </Button>
      {open ? (
        <PortalPopover anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <FilterPopover
            options={props.options}
            selected={props.selected}
            title="Groups"
            onToggle={props.onToggle}
          />
        </PortalPopover>
      ) : null}
    </div>
  );
}

function FilterPopover(props: {
  options: string[];
  selected: string[];
  title: string;
  onToggle(value: string): void;
}) {
  return (
    <div className="filter-popover">
      <div className="filter-popover__title">{props.title}</div>
      <div className="filter-popover__list">
        {props.options.length === 0 ? (
          <div className="filter-popover__empty">No options</div>
        ) : (
          props.options.map((option) => (
            <label className="filter-popover__option" key={option}>
              <input
                checked={props.selected.includes(option)}
                onChange={() => props.onToggle(option)}
                type="checkbox"
              />
              <span>{option}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function toggleGroup(filter: TaskFilter, value: string): TaskFilter {
  const current = filter.group ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return next.length > 0
    ? { ...filter, group: next }
    : removeKey(filter, "group");
}

function withoutSearch(filter: TaskFilter): TaskFilter {
  return removeKey({ ...filter }, "search");
}

function removeKey<T extends object, K extends keyof T>(value: T, key: K): T {
  const clone = { ...value };
  delete clone[key];
  return clone;
}
