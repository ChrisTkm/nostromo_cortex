import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";

import { HudCorner } from "./HudCorner";
import { PlanFilter } from "./PlanFilter";
import { PortalPopover } from "./PortalPopover";
import type { ActionPlanRecord, FilterCatalog, TaskFilter } from "../types";

type FilterKey = "project" | "group";
type ToolbarLayout = "full" | "compact" | "mini";

export function Toolbar(props: {
  catalog: FilterCatalog;
  filters: TaskFilter;
  onClearPlan(): void;
  onFilterChange(filter: TaskFilter): void;
  onSelectPlan(code: string): void;
  onViewPlan(): void;
  planContext?: ActionPlanRecord;
  plans: Array<{ code: string; title: string; progress: { done: number; total: number } }>;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
  selectedPlanCode?: string;
  totalHours: number;
}) {
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [layout, setLayout] = useState<ToolbarLayout>("full");
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(props.filters.search ?? "");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSearchDraft(props.filters.search ?? "");
  }, [props.filters.search]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const updateLayout = (width: number) => {
      if (width < 480) {
        setLayout("mini");
        return;
      }
      if (width < 720) {
        setLayout("compact");
        return;
      }
      setLayout("full");
    };

    updateLayout(root.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateLayout(entry.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const nextSearch = searchDraft.trim();
      if ((props.filters.search ?? "") === nextSearch) {
        return;
      }
      props.onFilterChange(nextSearch ? { ...props.filters, search: nextSearch } : withoutSearch(props.filters));
    }, 200);

    return () => window.clearTimeout(handle);
  }, [props, searchDraft]);

  useEffect(() => {
    if (layout === "full") {
      setMoreOpen(false);
      return;
    }

    if (layout === "compact" && openFilter === "group") {
      setOpenFilter(null);
    }
    if (layout === "mini" && (openFilter === "group" || openFilter === "project")) {
      setOpenFilter(null);
    }
  }, [layout, openFilter]);

  const chips = useMemo(
    () => [
      { key: "project" as const, label: formatChipLabel("Projects", props.filters.project) },
      { key: "group" as const, label: formatChipLabel("Groups", props.filters.group) }
    ],
    [props.filters.group, props.filters.project]
  );

  return (
    <div className={`app-toolbar app-toolbar--${layout}`} ref={rootRef}>
      <div className="app-toolbar__filters">
        <PlanFilter
          onClearPlan={props.onClearPlan}
          onSelectPlan={props.onSelectPlan}
          onViewPlan={props.onViewPlan}
          plans={props.plans}
          selectedPlanCode={props.selectedPlanCode}
        />
        <HudCorner planContext={props.planContext} totalHours={props.totalHours} />
        {chips
          .filter((chip) => {
            if (layout === "full") {
              return true;
            }
            if (layout === "compact") {
              return chip.key === "project";
            }
            return false;
          })
          .map((chip) => (
          <ToolbarFilterChip
            isOpen={openFilter === chip.key}
            key={chip.key}
            label={chip.label}
            onClose={() => setOpenFilter(null)}
            onToggleOpen={() => {
              setMoreOpen(false);
              setOpenFilter((current) => (current === chip.key ? null : chip.key));
            }}
          >
            <FilterPopover
              options={optionsForKey(chip.key, props.catalog)}
              selected={selectedValues(chip.key, props.filters)}
              title={chip.label}
              onToggle={(value) => props.onFilterChange(toggleValue(props.filters, chip.key, value))}
            />
          </ToolbarFilterChip>
          ))}
        {layout !== "full" ? (
          <MorePopoverButton
            isOpen={moreOpen}
            onClose={() => setMoreOpen(false)}
            onToggleOpen={() => {
              setOpenFilter(null);
              setMoreOpen((current) => !current);
            }}
          >
            <div className="filter-popover filter-popover--more">
              {layout === "mini" ? (
                <div className="toolbar-more__section">
                  <FilterPopover
                    options={optionsForKey("project", props.catalog)}
                    selected={selectedValues("project", props.filters)}
                    title={formatChipLabel("Projects", props.filters.project)}
                    onToggle={(value) => props.onFilterChange(toggleValue(props.filters, "project", value))}
                  />
                </div>
              ) : null}
              <div className="toolbar-more__section">
                <FilterPopover
                  options={optionsForKey("group", props.catalog)}
                  selected={selectedValues("group", props.filters)}
                  title={formatChipLabel("Groups", props.filters.group)}
                  onToggle={(value) => props.onFilterChange(toggleValue(props.filters, "group", value))}
                />
              </div>
              <div className="toolbar-more__section">
                <div className="filter-popover__title">Search</div>
                <input
                  ref={(element) => {
                    props.searchInputRef.current = element;
                  }}
                  className="app-toolbar__input app-toolbar__input--popover"
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search tasks..."
                  type="search"
                  value={searchDraft}
                />
              </div>
            </div>
          </MorePopoverButton>
        ) : null}
      </div>

      {layout === "full" ? (
        <div className="app-toolbar__search">
        <input
          ref={(element) => {
            props.searchInputRef.current = element;
          }}
          className="app-toolbar__input"
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search code, detail, lane, tags..."
          type="search"
          value={searchDraft}
        />
        </div>
      ) : null}
    </div>
  );
}

function ToolbarFilterChip(props: {
  children: ReactNode;
  isOpen: boolean;
  label: string;
  onClose(): void;
  onToggleOpen(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="filter-chip">
      <button
        className={`app-toolbar__button${props.isOpen ? " app-toolbar__button--active" : ""}`}
        onClick={props.onToggleOpen}
        ref={triggerRef}
        type="button"
      >
        {props.label}
      </button>
      {props.isOpen ? (
        <PortalPopover anchorRef={triggerRef} onClose={props.onClose}>
          {props.children}
        </PortalPopover>
      ) : null}
    </div>
  );
}

function MorePopoverButton(props: {
  children: ReactNode;
  isOpen: boolean;
  onClose(): void;
  onToggleOpen(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="filter-chip app-toolbar__more">
      <button
        className={`app-toolbar__button${props.isOpen ? " app-toolbar__button--active" : ""}`}
        onClick={props.onToggleOpen}
        ref={triggerRef}
        type="button"
      >
        More ⋯
      </button>
      {props.isOpen ? (
        <PortalPopover anchorRef={triggerRef} onClose={props.onClose}>
          {props.children}
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
              <input checked={props.selected.includes(option)} onChange={() => props.onToggle(option)} type="checkbox" />
              <span>{option}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function toggleValue(filter: TaskFilter, key: FilterKey, value: string): TaskFilter {
  const current = selectedValues(key, filter);
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return assignValues(filter, key, next);
}

function assignValues(filter: TaskFilter, key: FilterKey, values: string[]): TaskFilter {
  const next = { ...filter };
  if (key === "project") {
    return values.length > 0 ? { ...next, project: values } : removeKey(next, "project");
  }
  return values.length > 0 ? { ...next, group: values } : removeKey(next, "group");
}

function selectedValues(key: FilterKey, filter: TaskFilter): string[] {
  if (key === "project") {
    return filter.project ?? [];
  }
  return filter.group ?? [];
}

function optionsForKey(key: FilterKey, catalog: FilterCatalog): string[] {
  if (key === "project") {
    return catalog.projects;
  }
  return catalog.groups;
}

function formatChipLabel(label: string, values?: readonly string[]) {
  if (!values || values.length === 0) {
    return `${label} · all`;
  }
  if (values.length === 1) {
    return `${label} · ${values[0]}`;
  }
  return `${label} · ${values[0]} +${values.length - 1}`;
}

function withoutSearch(filter: TaskFilter): TaskFilter {
  return removeKey({ ...filter }, "search");
}

function removeKey<T extends object, K extends keyof T>(value: T, key: K): T {
  const clone = { ...value };
  delete clone[key];
  return clone;
}
