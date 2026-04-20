export function NotesEmptyState(props: {
  onCreate(): void;
}) {
  return (
    <div className="notes-empty-state">
      <div className="notes-empty-state__eyebrow">Notes</div>
      <h2 className="notes-empty-state__title">Select a note or start a new one.</h2>
      <p className="notes-empty-state__text">
        Search stays live on title, body, and tags. Saved notes appear here immediately.
      </p>
      <button className="notes-button notes-button--primary" onClick={props.onCreate} type="button">
        + New note
      </button>
    </div>
  );
}
