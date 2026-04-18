import type { NoteDraft } from "../NotesApp";

export function NoteEditor(props: {
  draft: NoteDraft;
  error?: string | null;
  isNew: boolean;
  onChange(value: Partial<NoteDraft>): void;
  onClose(): void;
  onDelete?(): void;
  onReset(): void;
  onSave(): void;
}) {
  const generatedCode = props.draft.code.trim() || (props.draft.title.trim() ? slugifyTitle(props.draft.title) : "note");

  return (
    <div className="note-editor">
      <header className="note-editor__header">
        <div>
          <div className="note-editor__eyebrow">{props.isNew ? "New note" : "Editing note"}</div>
          <h2 className="note-editor__title">{props.draft.title.trim() || "Untitled note"}</h2>
        </div>
        <div className="note-editor__actions">
          <button className="notes-button" onClick={props.onClose} type="button">
            Close
          </button>
          <button className="notes-button" onClick={props.onReset} type="button">
            Reset
          </button>
          {props.onDelete ? (
            <button className="notes-button notes-button--danger" onClick={props.onDelete} type="button">
              Delete
            </button>
          ) : null}
          <button className="notes-button notes-button--primary" onClick={props.onSave} type="button">
            Save
          </button>
        </div>
      </header>

      <div className="note-editor__meta-card">
        <div className="note-editor__meta-label">Code</div>
        <div className="note-editor__meta-value">{generatedCode}</div>
      </div>

      {props.error ? <div className="note-editor__error">{props.error}</div> : null}

      <div className="note-editor__grid">
        <label className="note-editor__field note-editor__field--full">
          <span className="note-editor__label">Title</span>
          <input
            className="notes-input"
            onChange={(event) => props.onChange({ title: event.target.value })}
            placeholder="Meeting notes, decision log, next steps..."
            type="text"
            value={props.draft.title}
          />
        </label>

        <label className="note-editor__field">
          <span className="note-editor__label">Tags CSV</span>
          <input
            className="notes-input"
            onChange={(event) => props.onChange({ tags: event.target.value })}
            placeholder="research, blocker, follow-up"
            type="text"
            value={props.draft.tags}
          />
        </label>

        <label className="note-editor__field">
          <span className="note-editor__label">TaskCode</span>
          <input
            className="notes-input"
            onChange={(event) => props.onChange({ taskCode: event.target.value })}
            placeholder="TASK-123"
            type="text"
            value={props.draft.taskCode}
          />
        </label>

        <label className="note-editor__field">
          <span className="note-editor__label">PlanCode</span>
          <input
            className="notes-input"
            onChange={(event) => props.onChange({ planCode: event.target.value })}
            placeholder="PLAN-42"
            type="text"
            value={props.draft.planCode}
          />
        </label>

        <label className="note-editor__field note-editor__field--checkbox">
          <span className="note-editor__label">Pinned</span>
          <input
            checked={props.draft.pinned}
            onChange={(event) => props.onChange({ pinned: event.target.checked })}
            type="checkbox"
          />
        </label>

        <label className="note-editor__field note-editor__field--full">
          <span className="note-editor__label">Body</span>
          <textarea
            className="notes-textarea"
            onChange={(event) => props.onChange({ body: event.target.value })}
            placeholder="Write the note body here..."
            value={props.draft.body}
          />
        </label>
      </div>
    </div>
  );
}

function slugifyTitle(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}
