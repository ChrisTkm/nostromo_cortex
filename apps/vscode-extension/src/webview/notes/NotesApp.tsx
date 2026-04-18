import type { NoteDocumentInput, NoteRecord } from "@cortex/core";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { NoteEditor } from "./components/NoteEditor";
import { NoteList } from "./components/NoteList";

type NotesPanelMode = "list" | "new" | { type: "edit"; code: string };
type NotesViewMode = "list" | "new" | "edit";

type NotesMessage =
  | {
      type: "notes:list";
      notes: NoteRecord[];
    }
  | {
      type: "notes:saved";
      note: NoteRecord;
    }
  | {
      type: "open";
      mode: NotesPanelMode;
    };

export type NoteDraft = {
  title: string;
  body: string;
  tags: string;
  taskCode: string;
  planCode: string;
  pinned: boolean;
  code: string;
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

export function NotesApp() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<NotesViewMode>("list");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(() => createEmptyDraft());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef<NoteRecord[]>([]);
  const draftRef = useRef<NoteDraft>(draft);
  const modeRef = useRef<NotesViewMode>(mode);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    function onMessage(event: MessageEvent<NotesMessage>) {
      const message = event.data;
      if (!message) {
        return;
      }

      if (message.type === "notes:list" && Array.isArray(message.notes)) {
        notesRef.current = message.notes;
        setNotes(message.notes);
        setSelected((currentSelected) => {
          if (!currentSelected) {
            return null;
          }
          const exists = message.notes.some((note) => note.code === currentSelected);
          if (!exists) {
            setMode("list");
            setEditorOpen(false);
            setDraft(createEmptyDraft());
            setError(null);
            return null;
          }
          if (modeRef.current === "edit" && isDraftPristineForSelection(draftRef.current, currentSelected)) {
            const note = message.notes.find((entry) => entry.code === currentSelected);
            if (note) {
              setDraft(createDraftFromNote(note));
            }
          }
          return currentSelected;
        });
        return;
      }

      if (message.type === "notes:saved" && isNoteRecord(message.note)) {
        notesRef.current = upsertNote(notesRef.current, message.note);
        setNotes((current) => upsertNote(current, message.note));
        setSelected(message.note.code);
        setMode("edit");
        setEditorOpen(true);
        setDraft(createDraftFromNote(message.note));
        setError(null);
        return;
      }

      if (message.type === "open") {
        applyOpenMode(message.mode, notesRef.current, {
          setDraft,
          setEditorOpen,
          setError,
          setMode,
          setSelected
        });
      }
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const filteredNotes = useMemo(() => {
    const next = notes.filter((note) => {
      if (!deferredSearch) {
        return true;
      }
      const haystack = [note.title, note.body, note.tags.join(" ")].join("\n").toLowerCase();
      return haystack.includes(deferredSearch);
    });
    return next.sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return Number(right.pinned) - Number(left.pinned);
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [deferredSearch, notes]);

  const selectedNote = selected ? notes.find((note) => note.code === selected) ?? null : null;

  function handleSelect(code: string) {
    const note = notes.find((entry) => entry.code === code);
    if (!note) {
      return;
    }
    setSelected(code);
    setMode("edit");
    setEditorOpen(true);
    setDraft(createDraftFromNote(note));
    setError(null);
  }

  function handleCreate() {
    setSelected(null);
    setMode("new");
    setEditorOpen(true);
    setDraft(createEmptyDraft());
    setError(null);
  }

  function handleDraftChange(patch: Partial<NoteDraft>) {
    setDraft((current) => ({
      ...current,
      ...patch
    }));
    if (error) {
      setError(null);
    }
  }

  function handleSave() {
    const title = draft.title.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }

    const input: NoteDocumentInput = {
      code: draft.code.trim() || slugifyTitle(title),
      title,
      body: draft.body,
      tags: splitCsv(draft.tags),
      ...(draft.taskCode.trim() ? { task_code: draft.taskCode.trim() } : {}),
      ...(draft.planCode.trim() ? { plan_code: draft.planCode.trim() } : {}),
      ...(draft.pinned ? { pinned: true } : {})
    };

    vscode.postMessage({
      type: "notes:save",
      input
    });
  }

  function handleReset() {
    if (selectedNote) {
      setDraft(createDraftFromNote(selectedNote));
      setError(null);
      return;
    }

    setDraft(createEmptyDraft());
    setError(null);
  }

  function handleCloseEditor() {
    setEditorOpen(false);
    setError(null);
    if (mode === "new") {
      setMode("list");
      setSelected(null);
      setDraft(createEmptyDraft());
    }
  }

  function handleDelete(code: string) {
    setSelected((current) => (current === code ? null : current));
    setMode("list");
    setEditorOpen(false);
    setDraft(createEmptyDraft());
    setError(null);
    vscode.postMessage({
      type: "notes:delete",
      code
    });
  }

  return (
    <div className={`notes-app${editorOpen ? "" : " notes-app--list-only"}`}>
      <aside className="notes-sidebar">
        <NoteList
          notes={filteredNotes}
          onCloseEditor={handleCloseEditor}
          onCreate={handleCreate}
          onSearchChange={setSearch}
          onSelect={handleSelect}
          showEditor={editorOpen}
          search={search}
          selectedCode={selected}
        />
      </aside>
      {editorOpen ? (
        <section className="notes-editor-panel">
          {mode === "list" && !selectedNote ? (
          <div className="notes-empty-state">
            <div className="notes-empty-state__eyebrow">Notes</div>
            <h2 className="notes-empty-state__title">Select a note or start a new one.</h2>
            <p className="notes-empty-state__text">
              Search stays live on title, body, and tags. Saved notes appear here immediately.
            </p>
            <button className="notes-button notes-button--primary" onClick={handleCreate} type="button">
              + New note
            </button>
          </div>
        ) : (
            <NoteEditor
              draft={draft}
              error={error}
              isNew={mode === "new"}
              onChange={handleDraftChange}
              onClose={handleCloseEditor}
              onDelete={draft.code.trim() ? () => handleDelete(draft.code.trim()) : undefined}
              onReset={handleReset}
              onSave={handleSave}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

function applyOpenMode(
  openMode: NotesPanelMode,
  notes: readonly NoteRecord[],
  actions: {
    setDraft(value: NoteDraft): void;
    setEditorOpen(value: boolean): void;
    setError(value: string | null): void;
    setMode(value: NotesViewMode): void;
    setSelected(value: string | null): void;
  }
) {
  if (openMode === "list") {
    actions.setSelected(null);
    actions.setMode("list");
    actions.setEditorOpen(false);
    actions.setDraft(createEmptyDraft());
    actions.setError(null);
    return;
  }

  if (openMode === "new") {
    actions.setSelected(null);
    actions.setMode("new");
    actions.setEditorOpen(true);
    actions.setDraft(createEmptyDraft());
    actions.setError(null);
    return;
  }

  const note = notes.find((entry) => entry.code === openMode.code);
  actions.setSelected(openMode.code);
  actions.setMode("edit");
  actions.setEditorOpen(true);
  actions.setDraft(note ? createDraftFromNote(note) : { ...createEmptyDraft(), code: openMode.code });
  actions.setError(null);
}

function createEmptyDraft(): NoteDraft {
  return {
    title: "",
    body: "",
    tags: "",
    taskCode: "",
    planCode: "",
    pinned: false,
    code: ""
  };
}

function createDraftFromNote(note: NoteRecord): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    tags: note.tags.join(", "),
    taskCode: note.taskCode ?? "",
    planCode: note.planCode ?? "",
    pinned: note.pinned,
    code: note.code
  };
}

function upsertNote(notes: readonly NoteRecord[], note: NoteRecord) {
  const next = notes.filter((entry) => entry.code !== note.code);
  next.push(note);
  return next;
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function isDraftPristineForSelection(draft: NoteDraft, selected: string) {
  return (
    (!draft.title && !draft.body && !draft.tags && !draft.taskCode && !draft.planCode && !draft.code) ||
    (draft.code === selected && !draft.title && !draft.body && !draft.tags && !draft.taskCode && !draft.planCode && !draft.pinned)
  );
}

function isNoteRecord(value: unknown): value is NoteRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const note = value as Partial<NoteRecord>;
  return typeof note.code === "string" && typeof note.title === "string" && typeof note.body === "string" && Array.isArray(note.tags);
}
