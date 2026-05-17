import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { ArchivedPlanSummary } from "../../service";

type ArchiveMessage = {
  type: "archive:list";
  plans: ArchivedPlanSummary[];
};

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: unknown): void;
      setState(state: unknown): void;
      getState(): unknown;
    };
  }
}

const vscode = window.acquireVsCodeApi();

export function ArchiveApp() {
  const [plans, setPlans] = useState<ArchivedPlanSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<ArchiveMessage>) {
      const message = event.data;
      if (message?.type !== "archive:list" || !Array.isArray(message.plans)) {
        return;
      }
      setPlans(message.plans);
      setSelectedTags((current) => current.filter((tag) => message.plans.some((plan) => plan.tags.includes(tag))));
      setExpandedCode((current) => (current && message.plans.some((plan) => plan.code === current) ? current : null));
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const tags = useMemo(() => [...new Set(plans.flatMap((plan) => plan.tags))].sort((left, right) => left.localeCompare(right)), [plans]);
  const filteredPlans = useMemo(() => {
    return plans.filter((plan) => {
      if (selectedTags.length > 0 && !selectedTags.every((tag) => plan.tags.includes(tag))) {
        return false;
      }
      if (!deferredSearch) {
        return true;
      }
      return `${plan.code} ${plan.title}`.toLowerCase().includes(deferredSearch);
    });
  }, [deferredSearch, plans, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag].sort()));
  }

  return (
    <div className="archive-app">
      <header className="archive-header">
        <div>
          <div className="archive-header__eyebrow">Read-only</div>
          <h1 className="archive-header__title">Cortex Archive</h1>
        </div>
        <button className="archive-button" onClick={() => vscode.postMessage({ type: "archive:refresh" })} type="button">
          Refresh
        </button>
      </header>

      <section className="archive-toolbar">
        <input
          className="archive-input"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search code or title..."
          type="search"
          value={search}
        />
        <div className="archive-tags" aria-label="Archive tag filters">
          {tags.map((tag) => (
            <button
              className={`archive-chip${selectedTags.includes(tag) ? " archive-chip--selected" : ""}`}
              key={tag}
              onClick={() => toggleTag(tag)}
              type="button"
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <main className="archive-table">
        <div className="archive-row archive-row--head">
          <span>Code</span>
          <span>Title</span>
          <span>Completed</span>
          <span>Archived</span>
          <span>Tasks</span>
          <span>Notes</span>
          <span />
        </div>
        {filteredPlans.length === 0 ? (
          <div className="archive-empty">
            <h2>No archived plans match.</h2>
            <p>Refresh the panel or adjust search and tag filters.</p>
          </div>
        ) : (
          filteredPlans.map((plan) => (
            <section className="archive-plan" key={plan.code}>
              <button className="archive-row archive-row--button" onClick={() => setExpandedCode(expandedCode === plan.code ? null : plan.code)} type="button">
                <span className="archive-code">{plan.code}</span>
                <span>{plan.title}</span>
                <span>{formatDate(plan.completedAt)}</span>
                <span>{formatDate(plan.archivedAt)}</span>
                <span>{plan.taskCount}</span>
                <span>{plan.noteCount}</span>
                <span className="archive-row__hint">{expandedCode === plan.code ? "Collapse" : "Inspect"}</span>
              </button>
              {expandedCode === plan.code ? <ArchiveDetails plan={plan} /> : null}
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function ArchiveDetails({ plan }: { plan: ArchivedPlanSummary }) {
  return (
    <div className="archive-details">
      <div className="archive-details__toolbar">
        <div className="archive-tags">
          {plan.tags.length > 0 ? plan.tags.map((tag) => <span className="archive-chip archive-chip--static" key={tag}>{tag}</span>) : <span className="archive-muted">No tags</span>}
        </div>
        <button className="archive-button archive-button--primary" onClick={() => vscode.postMessage({ type: "archive:openJson", jsonPath: plan.jsonPath })} type="button">
          Open JSON
        </button>
      </div>
      <section className="archive-detail-section">
        <h2>Tasks</h2>
        <div className="archive-task-list">
          {plan.tasks.length === 0 ? <div className="archive-muted">No archived tasks.</div> : null}
          {plan.tasks.map((task) => (
            <div className="archive-task" key={task.code}>
              <div className="archive-task__top">
                <span className="archive-code">{task.code}</span>
                {task.status ? <span className="archive-chip archive-chip--static">{task.status}</span> : null}
              </div>
              <div>{task.shortTask}</div>
              <div className="archive-muted">
                {task.completedAt ? `completed ${formatDate(task.completedAt)}` : "completion date unavailable"}
                {task.commitHash ? ` · ${task.commitHash}` : ""}
              </div>
              {task.completionNote ? <p>{task.completionNote}</p> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="archive-detail-section">
        <h2>Notes</h2>
        <div className="archive-note-list">
          {plan.notes.length === 0 ? <div className="archive-muted">No archived notes.</div> : null}
          {plan.notes.map((note, index) => (
            <article className="archive-note" key={`${note.title}:${note.createdAt ?? index}`}>
              <div className="archive-task__top">
                <strong>{note.title}</strong>
                <span className="archive-muted">{formatDate(note.createdAt)}</span>
              </div>
              {note.tags.length > 0 ? (
                <div className="archive-tags">{note.tags.map((tag) => <span className="archive-chip archive-chip--static" key={tag}>{tag}</span>)}</div>
              ) : null}
              <p>{note.body || "No body."}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
