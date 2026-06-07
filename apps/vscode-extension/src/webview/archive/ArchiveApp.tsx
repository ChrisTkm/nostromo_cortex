import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { ArchivedPlanSummary } from "../../service";

type SortKey =
  | "archivedAt-desc"
  | "archivedAt-asc"
  | "completedAt-desc"
  | "taskCount-desc"
  | "noteCount-desc";

type TagMode = "AND" | "OR";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "archivedAt-desc", label: "Archived (newest)" },
  { key: "archivedAt-asc", label: "Archived (oldest)" },
  { key: "completedAt-desc", label: "Completed (newest)" },
  { key: "taskCount-desc", label: "Most tasks" },
  { key: "noteCount-desc", label: "Most notes" }
];

type ArchiveMessage = {
  type: "archive:list";
  plans: ArchivedPlanSummary[];
  archivePath?: string;
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
  const [archivePath, setArchivePath] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("archivedAt-desc");
  const [tagMode, setTagMode] = useState<TagMode>("AND");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<ArchiveMessage>) {
      const message = event.data;
      if (message?.type !== "archive:list" || !Array.isArray(message.plans)) {
        return;
      }
      setPlans(message.plans);
      setArchivePath(message.archivePath);
      setSelectedTags((current) => current.filter((tag) => message.plans.some((plan) => plan.tags.includes(tag))));
      setExpandedCode((current) => (current && message.plans.some((plan) => plan.code === current) ? current : null));
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const tags = useMemo(() => [...new Set(plans.flatMap((plan) => plan.tags))].sort((left, right) => left.localeCompare(right)), [plans]);

  const now = Date.now();
  const filteredPlans = useMemo(() => {
    const filtered = plans.filter((plan) => {
      if (selectedTags.length > 0) {
        const matchesTag = tagMode === "AND"
          ? selectedTags.every((tag) => plan.tags.includes(tag))
          : selectedTags.some((tag) => plan.tags.includes(tag));
        if (!matchesTag) return false;
      }
      if (!deferredSearch) return true;
      return `${plan.code} ${plan.title}`.toLowerCase().includes(deferredSearch);
    });

    const sorted = [...filtered].sort((left, right) => {
      switch (sortKey) {
        case "archivedAt-asc":
          return (left.archivedAt ?? "").localeCompare(right.archivedAt ?? "") || left.code.localeCompare(right.code);
        case "completedAt-desc":
          return (right.completedAt ?? "").localeCompare(left.completedAt ?? "") || left.code.localeCompare(right.code);
        case "taskCount-desc":
          return (right.taskCount - left.taskCount) || left.code.localeCompare(right.code);
        case "noteCount-desc":
          return (right.noteCount - left.noteCount) || left.code.localeCompare(right.code);
        case "archivedAt-desc":
        default:
          return (right.archivedAt ?? "").localeCompare(left.archivedAt ?? "") || left.code.localeCompare(right.code);
      }
    });

    return sorted;
  }, [deferredSearch, plans, selectedTags, sortKey, tagMode]);

  function toggleTag(tag: string) {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag].sort()));
  }

  return (
    <div className="archive-app">
      <header className="archive-header">
        <div className="archive-header__meta">
          <div className="archive-header__eyebrow">Read-only</div>
          <h1 className="archive-header__title">Cortex Archive</h1>
          {archivePath ? (
            <div className="archive-header__path" title={archivePath}>
              Folder: {archivePath}
            </div>
          ) : null}
        </div>
        <div className="archive-header__actions">
          {archivePath ? (
            <button className="archive-button" onClick={() => vscode.postMessage({ type: "archive:openFolder" })} type="button">
              Open folder
            </button>
          ) : null}
          <button className="archive-button" onClick={() => vscode.postMessage({ type: "archive:refresh" })} type="button">
            Refresh
          </button>
        </div>
      </header>

      <section className="archive-toolbar">
        <div className="archive-toolbar__row">
          <input
            className="archive-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code or title..."
            type="search"
            value={search}
          />
          <select
            className="archive-select"
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            value={sortKey}
            aria-label="Sort archived plans"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className={`archive-button archive-tag-mode${tagMode === "OR" ? " archive-tag-mode--or" : ""}`}
            onClick={() => setTagMode((current) => (current === "AND" ? "OR" : "AND"))}
            type="button"
            title={`Toggle tag mode (current: ${tagMode})`}
          >
            Tags: {tagMode}
          </button>
        </div>
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
                <span>
                  {plan.title}
                  <span className={`archive-age-chip archive-age-chip--${bucketAge(plan.archivedAt, now)}`}>
                    {AGE_LABEL[bucketAge(plan.archivedAt, now)]}
                  </span>
                </span>
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
        <button
          className="archive-button archive-button--restore"
          onClick={() => vscode.postMessage({ type: "archive:restorePlan", planCode: plan.code })}
          type="button"
        >
          Restore
        </button>
        <button className="archive-button archive-button--primary" onClick={() => vscode.postMessage({ type: "archive:openJson", jsonPath: plan.jsonPath })} type="button">
          Open JSON
        </button>
      </div>
      {plan.description ? (
        <section className="archive-detail-section">
          <h2>Description</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{plan.description}</p>
        </section>
      ) : null}
      {plan.goal ? (
        <section className="archive-detail-section">
          <h2>Goal</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{plan.goal}</p>
        </section>
      ) : null}
      {plan.context ? (
        <section className="archive-detail-section">
          <h2>Context</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{plan.context}</p>
        </section>
      ) : null}
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

type AgeBucket = "today" | "week" | "month" | "older" | "unknown";

const AGE_LABEL: Record<AgeBucket, string> = {
  today: "Today",
  week: "7d",
  month: "30d",
  older: "Older",
  unknown: "Unknown"
};

function bucketAge(archivedAt: string | undefined, now: number): AgeBucket {
  if (!archivedAt) return "unknown";
  const parsed = Date.parse(archivedAt);
  if (Number.isNaN(parsed)) return "unknown";
  const diffMs = now - parsed;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "today";
  if (diffMs < 7 * day) return "week";
  if (diffMs < 30 * day) return "month";
  return "older";
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
