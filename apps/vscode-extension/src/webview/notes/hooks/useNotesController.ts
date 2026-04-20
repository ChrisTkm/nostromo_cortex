import type { NoteDocumentInput, NoteRecord } from "@cortex/core";
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from "react";

import { createDraftFromNote, createEmptyDraft, isDraftPristineForSelection, slugifyTitle, splitCsv } from "../lib/drafts";
import type { NoteDraft, NotesMessage, NotesPanelMode, NotesViewMode } from "../types";

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

export function useNotesController() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<NotesViewMode>("list");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(() => createEmptyDraft());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const selectedNote = selectedCode ? notes.find((note) => note.code === selectedCode) ?? null : null;
  const showEditor = editorOpen;

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

  const handleMessage = useEffectEvent((message: NotesMessage) => {
    if (message.type === "notes:list" && Array.isArray(message.notes)) {
      setNotes(message.notes);

      if (selectedCode && !message.notes.some((note) => note.code === selectedCode)) {
        setSelectedCode(null);
        setViewMode("list");
        setEditorOpen(false);
        setDraft(createEmptyDraft());
        setError(null);
        return;
      }

      if (selectedCode && viewMode === "edit" && isDraftPristineForSelection(draft, selectedCode)) {
        const note = message.notes.find((entry) => entry.code === selectedCode);
        if (note) {
          setDraft(createDraftFromNote(note));
        }
      }

      return;
    }

    if (message.type === "notes:saved" && isNoteRecord(message.note)) {
      setNotes((current) => upsertNote(current, message.note));
      setSelectedCode(message.note.code);
      setViewMode("edit");
      setEditorOpen(true);
      setDraft(createDraftFromNote(message.note));
      setError(null);
      return;
    }

    if (message.type === "open") {
      applyOpenMode(message.mode, notes, {
        clearError: () => setError(null),
        openCreate: () => {
          setSelectedCode(null);
          setViewMode("new");
          setEditorOpen(true);
          setDraft(createEmptyDraft());
        },
        openEdit: (code, note) => {
          setSelectedCode(code);
          setViewMode("edit");
          setEditorOpen(true);
          setDraft(note ? createDraftFromNote(note) : { ...createEmptyDraft(), code });
        },
        openList: () => {
          setSelectedCode(null);
          setViewMode("list");
          setEditorOpen(false);
          setDraft(createEmptyDraft());
        }
      });
    }
  });

  useEffect(() => {
    function onMessage(event: MessageEvent<NotesMessage>) {
      const message = event.data;
      if (!message) {
        return;
      }
      handleMessage(message);
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [handleMessage]);

  function selectNote(code: string) {
    const note = notes.find((entry) => entry.code === code);
    if (!note) {
      return;
    }

    setSelectedCode(code);
    setViewMode("edit");
    setEditorOpen(true);
    setDraft(createDraftFromNote(note));
    setError(null);
  }

  function createNote() {
    setSelectedCode(null);
    setViewMode("new");
    setEditorOpen(true);
    setDraft(createEmptyDraft());
    setError(null);
  }

  function updateDraft(patch: Partial<NoteDraft>) {
    setDraft((current) => ({
      ...current,
      ...patch
    }));

    if (error) {
      setError(null);
    }
  }

  function saveDraft() {
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

  function resetDraft() {
    if (selectedNote) {
      setDraft(createDraftFromNote(selectedNote));
      setError(null);
      return;
    }

    setDraft(createEmptyDraft());
    setError(null);
  }

  function closeEditor() {
    setEditorOpen(false);
    setError(null);

    if (viewMode === "new") {
      setSelectedCode(null);
      setViewMode("list");
      setDraft(createEmptyDraft());
      return;
    }

    if (selectedNote) {
      setDraft(createDraftFromNote(selectedNote));
      return;
    }

    setViewMode("list");
    setDraft(createEmptyDraft());
  }

  function deleteNote(code: string) {
    setSelectedCode((current) => (current === code ? null : current));
    setViewMode("list");
    setEditorOpen(false);
    setDraft(createEmptyDraft());
    setError(null);
    vscode.postMessage({
      type: "notes:delete",
      code
    });
  }

  return {
    draft,
    error,
    filteredNotes,
    search,
    selectedCode,
    selectedNote,
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
  };
}

function applyOpenMode(
  openMode: NotesPanelMode,
  notes: readonly NoteRecord[],
  actions: {
    clearError(): void;
    openCreate(): void;
    openEdit(code: string, note: NoteRecord | undefined): void;
    openList(): void;
  }
) {
  if (openMode === "list") {
    actions.openList();
    actions.clearError();
    return;
  }

  if (openMode === "new") {
    actions.openCreate();
    actions.clearError();
    return;
  }

  actions.openEdit(openMode.code, notes.find((entry) => entry.code === openMode.code));
  actions.clearError();
}

function upsertNote(notes: readonly NoteRecord[], note: NoteRecord) {
  const next = notes.filter((entry) => entry.code !== note.code);
  next.push(note);
  return next;
}

function isNoteRecord(value: unknown): value is NoteRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const note = value as Partial<NoteRecord>;
  return typeof note.code === "string" && typeof note.title === "string" && typeof note.body === "string" && Array.isArray(note.tags);
}
