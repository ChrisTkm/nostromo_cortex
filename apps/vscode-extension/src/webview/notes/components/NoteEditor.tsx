import { slugifyTitle } from "../lib/drafts";
import type { NoteDraft } from "../types";

export function NoteEditor(props: {
  draft: NoteDraft;
  error?: string | null;
  isDirty: boolean;
  isNew: boolean;
  onChange(value: Partial<NoteDraft>): void;
  onClose(): void;
  onDelete?(): void;
  onReset(): void;
  onSave(): void;
}) {
  const generatedCode = props.draft.code.trim() || (props.draft.title.trim() ? slugifyTitle(props.draft.title) : "note");
  const statusLabel = props.isNew ? "New draft" : props.isDirty ? "Unsaved changes" : "Saved";
  const statusTone = props.isNew ? "note-editor__status--new" : props.isDirty ? "note-editor__status--dirty" : "note-editor__status--saved";
  const remindedLabel = props.draft.remindedAt ? `Reminded at ${formatReminderStamp(props.draft.remindedAt)}` : null;

  return (
    <div className="note-editor">
      <header className="note-editor__header">
        <div>
          <div className="note-editor__eyebrow">{props.isNew ? "New note" : "Editing note"}</div>
          <h2 className="note-editor__title">{props.draft.title.trim() || "Untitled note"}</h2>
          <div className={`note-editor__status ${statusTone}`}>{statusLabel}</div>
        </div>
        <div className="note-editor__actions">
          <button className="notes-button notes-button--primary" onClick={props.onSave} type="button">
            {props.isNew ? "Create note" : "Save note"}
          </button>
          <button className="notes-button" disabled={!props.isDirty} onClick={props.onReset} type="button">
            Reset changes
          </button>
          {props.onDelete ? (
            <button className="notes-button notes-button--danger" onClick={props.onDelete} type="button">
              Delete
            </button>
          ) : null}
          <button className="notes-button" onClick={props.onClose} type="button">
            Close
          </button>
        </div>
      </header>

      <div className="note-editor__meta-grid">
        <div className="note-editor__meta-card">
          <div className="note-editor__meta-label">Code</div>
          <div className="note-editor__meta-value">{generatedCode}</div>
        </div>
        <div className="note-editor__meta-card">
          <div className="note-editor__meta-label">State</div>
          <div className="note-editor__meta-value note-editor__meta-value--neutral">{statusLabel}</div>
        </div>
      </div>

      {props.error ? <div className="note-editor__error">{props.error}</div> : null}

      <div className="note-editor__layout">
        <section className="note-editor__group note-editor__group--summary">
          <div className="note-editor__group-header">
            <div className="note-editor__group-title">Summary</div>
            <div className="note-editor__group-hint">Keep the title scannable. Code updates automatically until you save.</div>
          </div>
          <label className="note-editor__field">
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
            <span className="note-editor__label">Tags</span>
            <input
              className="notes-input"
              onChange={(event) => props.onChange({ tags: event.target.value })}
              placeholder="research, blocker, follow-up"
              type="text"
              value={props.draft.tags}
            />
            <span className="note-editor__field-hint">Comma-separated. They stay searchable in the list.</span>
          </label>
        </section>

        <section className="note-editor__group note-editor__group--links">
          <div className="note-editor__group-header">
            <div className="note-editor__group-title">Links</div>
            <div className="note-editor__group-hint">Optional task and plan references stay in the current save contract.</div>
          </div>
          <div className="note-editor__field-row">
            <label className="note-editor__field">
              <span className="note-editor__label">Task code</span>
              <input
                className="notes-input"
                onChange={(event) => props.onChange({ taskCode: event.target.value })}
                placeholder="TASK-123"
                type="text"
                value={props.draft.taskCode}
              />
            </label>

            <label className="note-editor__field">
              <span className="note-editor__label">Plan code</span>
              <input
                className="notes-input"
                onChange={(event) => props.onChange({ planCode: event.target.value })}
                placeholder="PLAN-42"
                type="text"
                value={props.draft.planCode}
              />
            </label>
          </div>

          <label className="note-editor__toggle">
            <span>
              <span className="note-editor__label">Pinned note</span>
              <span className="note-editor__field-hint">Pinned notes stay at the top of the list.</span>
            </span>
            <input
              checked={props.draft.pinned}
              onChange={(event) => props.onChange({ pinned: event.target.checked })}
              type="checkbox"
            />
          </label>
        </section>

        <section className="note-editor__group note-editor__group--reminder">
          <div className="note-editor__group-header">
            <div className="note-editor__group-title">Reminder</div>
            <div className="note-editor__group-hint">Optional one-shot reminder stored with this note.</div>
          </div>

          <label className="note-editor__field">
            <span className="note-editor__label">Remind me at</span>
            <div className="note-editor__field-row note-editor__field-row--actions">
              <input
                className="notes-input"
                onChange={(event) =>
                  props.onChange({
                    remindAt: event.target.value,
                    remindedAt: event.target.value === props.draft.remindAt ? props.draft.remindedAt : ""
                  })
                }
                type="datetime-local"
                value={props.draft.remindAt}
              />
              <button
                className="notes-button"
                disabled={!props.draft.remindAt && !props.draft.remindedAt}
                onClick={() => props.onChange({ remindAt: "", remindedAt: "" })}
                type="button"
              >
                Clear
              </button>
            </div>
            <span className="note-editor__field-hint">Saved as ISO in Mongo and checked again when VS Code starts.</span>
          </label>

          {remindedLabel ? <div className="note-editor__reminder-badge">{remindedLabel}</div> : null}
        </section>

        <section className="note-editor__group note-editor__group--body">
          <div className="note-editor__group-header">
            <div className="note-editor__group-title">Body</div>
            <div className="note-editor__group-hint">Use this space for the actual note content.</div>
          </div>
          <label className="note-editor__field">
            <span className="note-editor__label">Note body</span>
            <textarea
              className="notes-textarea"
              onChange={(event) => props.onChange({ body: event.target.value })}
              placeholder="Write the note body here..."
              value={props.draft.body}
            />
          </label>
        </section>
      </div>
    </div>
  );
}

function formatReminderStamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}
