import { NoteEditor } from "./components/NoteEditor";
import { NoteList } from "./components/NoteList";
import { NotesEmptyState } from "./components/NotesEmptyState";
import { useNotesController } from "./hooks/useNotesController";

export function NotesApp() {
  const {
    activeSearch,
    draft,
    error,
    filteredNotes,
    isDraftDirty,
    isSearchPending,
    search,
    selectedCode,
    selectedNote,
    showEditor,
    totalNotes,
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
          activeSearch={activeSearch}
          hasDirtyDraft={isDraftDirty}
          isCreatingNew={viewMode === "new"}
          isSearchPending={isSearchPending}
          notes={filteredNotes}
          onCloseEditor={closeEditor}
          onCreate={createNote}
          onClearSearch={() => setSearch("")}
          onSearchChange={setSearch}
          onSelect={selectNote}
          selectedNoteTitle={selectedNote?.title ?? null}
          showEditor={showEditor}
          search={search}
          selectedCode={selectedCode}
          totalNotes={totalNotes}
        />
      </aside>
      {showEditor ? (
        <section className="notes-editor-panel">
          {viewMode === "edit" || viewMode === "new" ? (
            <NoteEditor
              draft={draft}
              error={error}
              isDirty={isDraftDirty}
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
