import { NoteEditor } from "./components/NoteEditor";
import { NoteList } from "./components/NoteList";
import { NotesEmptyState } from "./components/NotesEmptyState";
import { useNotesController } from "./hooks/useNotesController";

export function NotesApp() {
  const {
    draft,
    error,
    filteredNotes,
    search,
    selectedCode,
    showEditor,
    viewMode,
    closeEditor,
    createNote,
    deleteNote,
    resetDraft,
    saveDraft,
    selectNote,
    setSearch,
    updateDraft
  } = useNotesController();

  return (
    <div className={`notes-app${showEditor ? "" : " notes-app--list-only"}`}>
      <aside className="notes-sidebar">
        <NoteList
          notes={filteredNotes}
          onCloseEditor={closeEditor}
          onCreate={createNote}
          onSearchChange={setSearch}
          onSelect={selectNote}
          showEditor={showEditor}
          search={search}
          selectedCode={selectedCode}
        />
      </aside>
      {showEditor ? (
        <section className="notes-editor-panel">
          {viewMode === "edit" || viewMode === "new" ? (
            <NoteEditor
              draft={draft}
              error={error}
              isNew={viewMode === "new"}
              onChange={updateDraft}
              onClose={closeEditor}
              onDelete={draft.code.trim() ? () => deleteNote(draft.code.trim()) : undefined}
              onReset={resetDraft}
              onSave={saveDraft}
            />
          ) : (
            <NotesEmptyState onCreate={createNote} />
          )}
        </section>
      ) : null}
    </div>
  );
}
