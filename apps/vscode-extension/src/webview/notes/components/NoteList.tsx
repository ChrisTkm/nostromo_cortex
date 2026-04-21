import { Fragment } from "react";

import type { NoteRecord } from "@cortex/core";

export function NoteList(props: {
  activeSearch: string;
  hasDirtyDraft: boolean;
  isCreatingNew: boolean;
  isSearchPending: boolean;
  notes: readonly NoteRecord[];
  onCloseEditor(): void;
  onClearSearch(): void;
  onCreate(): void;
  onSearchChange(value: string): void;
  onSelect(code: string): void;
  selectedNoteTitle: string | null;
  showEditor: boolean;
  search: string;
  selectedCode: string | null;
  totalNotes: number;
}) {
  const hasSearch = props.search.trim().length > 0;
  const visibleCountLabel = hasSearch ? `${props.notes.length} of ${props.totalNotes} visible` : `${props.totalNotes} visible`;
  const editorStateLabel = props.isCreatingNew ? "New draft open" : props.selectedNoteTitle ? `Editing ${props.selectedNoteTitle}` : "Editor ready";

  return (
    <div className="notes-list">
      <header className="notes-list__header">
        <div>
          <div className="notes-list__eyebrow">Workspace notes</div>
          <h1 className="notes-list__title">Cortex Notes</h1>
          <div className="notes-list__count">{visibleCountLabel}</div>
        </div>
        <div className="notes-list__actions">
          {props.showEditor ? (
            <button className="notes-button" onClick={props.onCloseEditor} type="button">
              Hide editor
            </button>
          ) : null}
          <button className="notes-button notes-button--primary" onClick={props.onCreate} type="button">
            + New
          </button>
        </div>
      </header>

      {props.showEditor ? (
        <div className="notes-list__editor-state">
          <div>
            <div className="notes-list__editor-label">{editorStateLabel}</div>
            <div className="notes-list__editor-subtitle">
              {props.isCreatingNew ? "Create a note without losing the current list context." : "Selected notes stay highlighted in the list."}
            </div>
          </div>
          <div className="notes-list__editor-badges">
            {props.isCreatingNew ? <span className="notes-chip notes-chip--new">New</span> : null}
            {props.hasDirtyDraft ? <span className="notes-chip notes-chip--dirty">Unsaved</span> : null}
          </div>
        </div>
      ) : null}

      <label className="notes-list__search">
        <span className="notes-list__search-label">Search notes</span>
        <div className="notes-list__search-row">
          <input
            className="notes-input"
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Title, body, tags, code, task, or plan"
            type="search"
            value={props.search}
          />
          {hasSearch ? (
            <button className="notes-button" onClick={props.onClearSearch} type="button">
              Clear
            </button>
          ) : null}
        </div>
        <span className="notes-list__search-hint">
          {props.isSearchPending ? "Updating results..." : hasSearch ? "Matches are highlighted in the list." : "Search supports multiple words."}
        </span>
      </label>

      <div className="notes-list__items">
        {props.notes.length === 0 ? (
          <div className="notes-list__empty">
            <div className="notes-list__empty-title">{hasSearch ? "No notes match this search." : "No notes available yet."}</div>
            <p className="notes-list__empty-text">
              {hasSearch ? "Try a broader query or clear the current filters." : "Create the first note to start capturing context, follow-ups, and decisions."}
            </p>
            {hasSearch ? (
              <button className="notes-button" onClick={props.onClearSearch} type="button">
                Clear search
              </button>
            ) : null}
          </div>
        ) : (
          props.notes.map((note) => (
            <button
              className={`notes-list__item${props.selectedCode === note.code ? " notes-list__item--selected" : ""}`}
              key={note.code}
              onClick={() => props.onSelect(note.code)}
              type="button"
            >
              <div className="notes-list__item-top">
                <span className="notes-list__item-title">{highlightText(note.title, props.activeSearch)}</span>
                <span className="notes-list__item-date">{formatRelativeDate(note.updatedAt)}</span>
              </div>
              <div className="notes-list__item-meta">
                <span className="notes-list__item-code">{highlightText(note.code, props.activeSearch)}</span>
                <div className="notes-list__item-badges">
                  {note.pinned ? <span className="notes-chip notes-chip--pin">Pinned</span> : null}
                  {note.taskCode ? <span className="notes-chip">Task {highlightText(note.taskCode, props.activeSearch)}</span> : null}
                  {note.planCode ? <span className="notes-chip">Plan {highlightText(note.planCode, props.activeSearch)}</span> : null}
                  {props.selectedCode === note.code ? <span className="notes-chip notes-chip--selected">Selected</span> : null}
                  {props.selectedCode === note.code && props.hasDirtyDraft ? <span className="notes-chip notes-chip--dirty">Unsaved</span> : null}
                </div>
              </div>
              <p className="notes-list__item-snippet">{highlightText(buildSnippet(note, props.activeSearch), props.activeSearch)}</p>
              {note.tags.length > 0 ? (
                <div className="notes-list__item-tags">
                  {note.tags.slice(0, 4).map((tag) => (
                    <span className="notes-tag" key={tag} style={tagStyle(tag)}>
                      {highlightText(tag, props.activeSearch)}
                    </span>
                  ))}
                  {note.tags.length > 4 ? <span className="notes-tag notes-tag--muted">+{note.tags.length - 4}</span> : null}
                </div>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function buildSnippet(note: NoteRecord, query: string) {
  const source = note.body.trim() || note.tags.join(", ") || "Open to add details.";
  const terms = query.split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return truncate(source);
  }

  const lower = source.toLowerCase();
  const indexes = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  if (indexes.length === 0) {
    return truncate(source);
  }

  const start = Math.max(0, Math.min(...indexes) - 28);
  const end = Math.min(source.length, start + 132);
  const snippet = source.slice(start, end).trim();
  return `${start > 0 ? "..." : ""}${snippet}${end < source.length ? "..." : ""}`;
}

function formatRelativeDate(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const diffMs = timestamp - Date.now();
  const units = [
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 }
  ] as const;

  for (const entry of units) {
    const delta = Math.round(diffMs / entry.ms);
    if (Math.abs(delta) >= 1) {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(delta, entry.unit);
    }
  }

  return "just now";
}

function tagStyle(tag: string) {
  const hue = Array.from(tag).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
  return {
    background: `hsla(${hue}, 78%, 54%, 0.12)`,
    borderColor: `hsla(${hue}, 82%, 58%, 0.28)`,
    color: `hsl(${hue}, 82%, 70%)`
  };
}

function highlightText(text: string, query: string) {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  if (terms.length === 0) {
    return text;
  }

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const segments = text.split(matcher);

  return segments.map((segment, index) => {
    if (!segment) {
      return null;
    }

    const isMatch = terms.some((term) => segment.toLowerCase() === term.toLowerCase());
    return isMatch ? (
      <mark className="notes-highlight" key={`${segment}-${index}`}>
        {segment}
      </mark>
    ) : (
      <Fragment key={`${segment}-${index}`}>{segment}</Fragment>
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(value: string) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
