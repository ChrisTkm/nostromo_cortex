export function NotesEmptyState(props: {
  onCreate(): void;
}) {
  return (
    <div className="notes-empty-state">
      <div className="notes-empty-state__eyebrow">Notes</div>
      <h2 className="notes-empty-state__title">Select a note or start a new draft.</h2>
      <p className="notes-empty-state__text">
        The list keeps selection visible, search highlights matches, and unsaved changes stay marked while you edit.
      </p>
      <button className="notes-button notes-button--primary" onClick={props.onCreate} type="button">
        + New note
      </button>
    </div>
  );
}
