import { NoteEditor } from "./components/NoteEditor";
import { NoteList } from "./components/NoteList";
import { NotesEmptyState } from "./components/NotesEmptyState";
import { useNotesController } from "./hooks/useNotesController";
import { Button, Metric } from "../components/atoms";
import { Footer, Header } from "../components/molecules";
import { Module } from "../components/organisms";

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

  const header = (
    <Header
      title="CORTEX NOTES"
      actions={
        <Button intent="action" onClick={createNote} size="small">
          New note
        </Button>
      }
    />
  );

  const footer = (
    <Footer
      left={
        <div className="notes-stats">
          <Metric label="Total">{totalNotes}</Metric>
          <Metric label="Visibles">{filteredNotes.length}</Metric>
          {isDraftDirty ? <Metric label="Estado">Unsaved</Metric> : null}
        </div>
      }
    />
  );

  return (
    <Module className="notes-module" footer={footer} header={header}>
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
    </Module>
  );
}
