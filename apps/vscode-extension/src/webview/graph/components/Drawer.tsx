import { useMemo } from "react";

import type { SnapshotNode, TaskFilter } from "../types";
import { PromptPanel } from "./PromptPanel";

export function Drawer(props: {
  activeTab: "inspector" | "filters";
  filters: TaskFilter;
  isOpen: boolean;
  onClearFilters(): void;
  onClose(): void;
  onClosePromptPanel(): void;
  onEditTask(): void;
  onOpenPromptPanel(): void;
  onSelectDependency(code: string): void;
  onTabChange(tab: "inspector" | "filters"): void;
  promptExpanded: boolean;
  selectedNode?: SnapshotNode;
}) {
  const promptPreview = useMemo(() => props.selectedNode?.prompt?.split("\n").slice(0, 10).join("\n"), [props.selectedNode?.prompt]);

  return (
    <aside className={`app-drawer${props.isOpen ? " app-drawer--open" : ""}${props.promptExpanded ? " app-drawer--expanded" : ""}`}>
      <div className="app-drawer__header">
        <div className="app-drawer__tabs">
          <button
            className={`app-drawer__tab${props.activeTab === "inspector" ? " app-drawer__tab--active" : ""}`}
            onClick={() => props.onTabChange("inspector")}
            type="button"
          >
            Inspector
          </button>
          <button
            className={`app-drawer__tab${props.activeTab === "filters" ? " app-drawer__tab--active" : ""}`}
            onClick={() => props.onTabChange("filters")}
            type="button"
          >
            Filtros
          </button>
        </div>
        <button className="app-toolbar__button" onClick={props.onClose} type="button">
          Close
        </button>
      </div>

      <div className="app-drawer__body">
        {props.promptExpanded && props.selectedNode ? (
          <PromptPanel node={props.selectedNode} onClose={props.onClosePromptPanel} />
        ) : props.activeTab === "inspector" ? (
          props.selectedNode ? (
            <div className="drawer-panel">
              <header className="drawer-task-header">
                <div className="drawer-panel__code">{props.selectedNode.code}</div>
                <h2 className="drawer-panel__title">{props.selectedNode.label}</h2>
                <div className="drawer-meta-row">
                  <span className="drawer-badge">{props.selectedNode.status}</span>
                  <span className="drawer-badge">{props.selectedNode.severity}</span>
                  {props.selectedNode.lane ? <span className="drawer-badge">{props.selectedNode.lane}</span> : null}
                  {typeof props.selectedNode.durationEstimate === "number" ? (
                    <span className="drawer-badge">{formatHours(props.selectedNode.durationEstimate)}</span>
                  ) : null}
                </div>
                <div className="drawer-task-actions">
                  <button className="app-toolbar__button" onClick={props.onEditTask} type="button">
                    Edit task
                  </button>
                </div>
              </header>
              <div className="drawer-divider" />
              <section className="drawer-section drawer-section--spacious">
                <div className="drawer-section__label">Detail</div>
                <div className="drawer-section__text">{props.selectedNode.detail || "No detail provided."}</div>
              </section>
              <div className="drawer-divider" />
              <section className="drawer-section drawer-section--spacious">
                <div className="drawer-section__label">Dependencies</div>
                <div className="drawer-list">
                  {props.selectedNode.dependsOn.length > 0 ? (
                    props.selectedNode.dependsOn.map((code) => (
                      <button className="drawer-link" key={code} onClick={() => props.onSelectDependency(code)} type="button">
                        {code}
                      </button>
                    ))
                  ) : (
                    <span className="drawer-empty">No dependencies</span>
                  )}
                </div>
                <div className="drawer-inline-stat">
                  <span className="drawer-inline-stat__label">Downstream</span>
                  <span className="drawer-inline-stat__value">{props.selectedNode.downstreamCount}</span>
                </div>
              </section>
              <div className="drawer-divider" />
              <section className="drawer-section drawer-section--spacious">
                <div className="drawer-section__label">Timeline</div>
                <section className="drawer-grid">
                  <div className="drawer-card">
                    <div className="drawer-section__label">Created</div>
                    <div className="drawer-section__text">{formatDate(props.selectedNode.createdAt)}</div>
                  </div>
                  <div className="drawer-card">
                    <div className="drawer-section__label">Updated</div>
                    <div className="drawer-section__text">{formatDate(props.selectedNode.updatedAt)}</div>
                  </div>
                </section>
              </section>
              <div className="drawer-divider" />
              <section className="drawer-section drawer-section--spacious">
                <div className="drawer-section__label">Tags</div>
                <div className="drawer-list">
                  {props.selectedNode.tags.length > 0 ? props.selectedNode.tags.map((tag) => <span className="drawer-badge" key={tag}>{tag}</span>) : <span className="drawer-empty">No tags</span>}
                </div>
              </section>
              {props.selectedNode.prompt ? (
                <>
                  <div className="drawer-divider" />
                  <section className="drawer-section drawer-section--spacious">
                    <div className="drawer-section__header">
                      <div className="drawer-section__label">Prompt preview</div>
                      <button className="drawer-link" onClick={props.onOpenPromptPanel} type="button">
                        Ver completo
                      </button>
                    </div>
                    <pre className="drawer-prompt">{promptPreview}</pre>
                  </section>
                </>
              ) : null}
            </div>
          ) : (
            <div className="drawer-empty">Select a task to inspect it.</div>
          )
        ) : (
          <div className="drawer-panel">
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Projects</div>
              <div className="drawer-list">{renderValues(props.filters.project)}</div>
            </section>
            <div className="drawer-divider" />
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Groups</div>
              <div className="drawer-list">{renderValues(props.filters.group)}</div>
            </section>
            <div className="drawer-divider" />
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Tags</div>
              <div className="drawer-list">{renderValues(props.filters.tags)}</div>
            </section>
            <div className="drawer-divider" />
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Status</div>
              <div className="drawer-list">{renderValues(props.filters.status)}</div>
            </section>
            <div className="drawer-divider" />
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Severity</div>
              <div className="drawer-list">{renderValues(props.filters.severity)}</div>
            </section>
            <div className="drawer-divider" />
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Search</div>
              <div className="drawer-section__text">{props.filters.search?.trim() || "No search filter"}</div>
            </section>
            <button className="app-toolbar__button" onClick={props.onClearFilters} type="button">
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function renderValues(values?: readonly string[]) {
  if (!values || values.length === 0) {
    return <span className="drawer-empty">All</span>;
  }

  return values.map((value) => (
    <span className="drawer-badge" key={value}>
      {value}
    </span>
  ));
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`;
}
