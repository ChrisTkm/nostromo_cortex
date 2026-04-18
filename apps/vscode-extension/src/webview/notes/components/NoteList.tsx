import type { NoteRecord } from "@cortex/core";

export function NoteList(props: {
  notes: readonly NoteRecord[];
  onCreate(): void;
  onSearchChange(value: string): void;
  onSelect(code: string): void;
  search: string;
  selectedCode: string | null;
}) {
  return (
    <div className="notes-list">
      <header className="notes-list__header">
        <div>
          <div className="notes-list__eyebrow">Workspace notes</div>
          <h1 className="notes-list__title">Cortex Notes</h1>
        </div>
        <button className="notes-button notes-button--primary" onClick={props.onCreate} type="button">
          + New
        </button>
      </header>

      <label className="notes-list__search">
        <span className="notes-list__search-label">Search</span>
        <input
          className="notes-input"
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="Search title, body, or tags"
          type="search"
          value={props.search}
        />
      </label>

      <div className="notes-list__items">
        {props.notes.length === 0 ? (
          <div className="notes-list__empty">
            {props.search.trim() ? "No notes match the current search." : "No notes available yet."}
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
                <span className="notes-list__item-title">{note.title}</span>
                <span className="notes-list__item-date">{formatRelativeDate(note.updatedAt)}</span>
              </div>
              <div className="notes-list__item-meta">
                <span className="notes-list__item-code">{note.code}</span>
                {note.pinned ? <span className="notes-list__item-pin">Pinned</span> : null}
              </div>
              <p className="notes-list__item-snippet">{buildSnippet(note.body, note.tags)}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function buildSnippet(body: string, tags: readonly string[]) {
  const source = body.trim() || tags.join(", ") || "Open to add details.";
  return source.length > 120 ? `${source.slice(0, 117)}...` : source;
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
