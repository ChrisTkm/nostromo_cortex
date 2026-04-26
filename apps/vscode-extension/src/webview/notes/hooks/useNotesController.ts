import type { NoteDocumentInput, NoteRecord } from "@cortex/core";
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from "react";

import { createDraftFromNote, createEmptyDraft, isDraftPristineForSelection, slugifyTitle, splitCsv, toIsoDateTime } from "../lib/drafts";
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
const REMINDER_SEARCH_TOKENS = new Set(["has:reminder", "is:reminder"]);

export function useNotesController() {
  const persistedState = useMemo(() => readPersistedState(), []);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(persistedState.selectedCode);
  const [viewMode, setViewMode] = useState<NotesViewMode>(persistedState.viewMode);
  const [editorOpen, setEditorOpen] = useState(persistedState.editorOpen);
  const [draft, setDraft] = useState<NoteDraft>(persistedState.draft);
  const [search, setSearch] = useState(persistedState.search);
  const [debouncedSearch, setDebouncedSearch] = useState(persistedState.search.trim().toLowerCase());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, 140);

    return () => window.clearTimeout(handle);
  }, [search]);

  const deferredSearch = useDeferredValue(debouncedSearch);
  const searchTerms = useMemo(() => deferredSearch.split(/\s+/).filter(Boolean), [deferredSearch]);
  const selectedNote = selectedCode ? notes.find((note) => note.code === selectedCode) ?? null : null;
  const showEditor = editorOpen;
  const draftBaseline = useMemo(() => {
    if (viewMode === "edit" && selectedNote) {
      return createDraftFromNote(selectedNote);
    }

    return createEmptyDraft();
  }, [selectedNote, viewMode]);
  const isDraftDirty = useMemo(() => !areDraftsEquivalent(draft, draftBaseline), [draft, draftBaseline]);
  const totalNotes = notes.length;
  const isSearchPending = search.trim().toLowerCase() !== deferredSearch;

  const filteredNotes = useMemo(() => {
    const next = notes.filter((note) => {
      if (searchTerms.length === 0) {
        return true;
      }

      const haystack = [
        note.title,
        note.body,
        note.code,
        note.taskCode ?? "",
        note.planCode ?? "",
        note.tags.join(" "),
        note.remindAt ?? "",
        note.remindedAt ?? ""
      ].join("\n").toLowerCase();

      return searchTerms.every((term) => {
        if (REMINDER_SEARCH_TOKENS.has(term)) {
          return Boolean(note.remindAt) && !note.remindedAt;
        }

        return haystack.includes(term);
      });
    });

    return next.sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return Number(right.pinned) - Number(left.pinned);
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [notes, searchTerms]);

  useEffect(() => {
    persistState({
      draft,
      editorOpen,
      search,
      selectedCode,
      viewMode
    });
  }, [draft, editorOpen, search, selectedCode, viewMode]);

  const handleMessage = useEffectEvent((message: NotesMessage) => {
    if (message.type === "notes:list" && Array.isArray(message.notes)) {
      setNotes(message.notes);

      if (selectedCode && viewMode === "edit" && isDraftPristineForSelection(draft, selectedCode)) {
        const note = message.notes.find((entry) => entry.code === selectedCode);
        if (note) {
          setDraft(createDraftFromNote(note));
        }
      }

      if (typeof message.search === "string") {
        setSearch(message.search);
        setDebouncedSearch(message.search.trim().toLowerCase());
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
          if (editorOpen) {
            return;
          }
          setSelectedCode(null);
          setViewMode("list");
          setEditorOpen(false);
          setDraft(createEmptyDraft());
        }
      });
    }
  });

  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<NotesMessage>) {
      const message = event.data;
      if (!message) {
        return;
      }
      handleMessage(message);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleMessage]);

  function selectNote(code: string) {
    const note = notes.find((entry) => entry.code === code);
    if (!note) {
      return;
    }

    const nextDraft = createDraftFromNote(note);
    persistState({
      draft: nextDraft,
      editorOpen: true,
      search,
      selectedCode: code,
      viewMode: "edit"
    });
    setSelectedCode(code);
    setViewMode("edit");
    setEditorOpen(true);
    setDraft(nextDraft);
    setError(null);
  }

  function createNote() {
    const nextDraft = createEmptyDraft();
    persistState({
      draft: nextDraft,
      editorOpen: true,
      search,
      selectedCode: null,
      viewMode: "new"
    });
    setSelectedCode(null);
    setViewMode("new");
    setEditorOpen(true);
    setDraft(nextDraft);
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

    const remindAt = toIsoDateTime(draft.remindAt);
    if (draft.remindAt.trim() && !remindAt) {
      setError("Reminder date must be valid.");
      return;
    }

    const input: NoteDocumentInput = {
      code: draft.code.trim() || slugifyTitle(title),
      title,
      body: draft.body,
      tags: splitCsv(draft.tags),
      ...(draft.taskCode.trim() ? { task_code: draft.taskCode.trim() } : {}),
      ...(draft.planCode.trim() ? { plan_code: draft.planCode.trim() } : {}),
      ...(draft.pinned ? { pinned: true } : {}),
      ...(remindAt ? { remind_at: remindAt } : {}),
      ...(remindAt && draft.remindedAt.trim() ? { reminded_at: draft.remindedAt.trim() } : {})
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
    isDraftDirty,
    isSearchPending,
    search,
    selectedCode,
    selectedNote,
    showEditor,
    totalNotes,
    viewMode,
    activeSearch: deferredSearch,
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

function areDraftsEquivalent(left: NoteDraft, right: NoteDraft) {
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.tags === right.tags &&
    left.taskCode === right.taskCode &&
    left.planCode === right.planCode &&
    left.pinned === right.pinned &&
    left.remindAt === right.remindAt &&
    left.remindedAt === right.remindedAt &&
    left.code === right.code
  );
}

type PersistedNotesState = {
  draft: NoteDraft;
  editorOpen: boolean;
  search: string;
  selectedCode: string | null;
  viewMode: NotesViewMode;
};

function readPersistedState(): PersistedNotesState {
  const fallback = createPersistedState();
  const state = vscode.getState();
  if (!state || typeof state !== "object") {
    return fallback;
  }

  const notesState = (state as { notes?: Partial<PersistedNotesState> }).notes;
  if (!notesState || typeof notesState !== "object") {
    return fallback;
  }

  return {
    draft: isNoteDraft(notesState.draft) ? notesState.draft : fallback.draft,
    editorOpen: typeof notesState.editorOpen === "boolean" ? notesState.editorOpen : fallback.editorOpen,
    search: typeof notesState.search === "string" ? notesState.search : fallback.search,
    selectedCode: typeof notesState.selectedCode === "string" ? notesState.selectedCode : null,
    viewMode: isNotesViewMode(notesState.viewMode) ? notesState.viewMode : fallback.viewMode
  };
}

function persistState(nextState: PersistedNotesState) {
  vscode.setState({
    notes: nextState
  });
}

function createPersistedState(): PersistedNotesState {
  return {
    draft: createEmptyDraft(),
    editorOpen: false,
    search: "",
    selectedCode: null,
    viewMode: "list"
  };
}

function isNoteDraft(value: unknown): value is NoteDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const draft = value as Partial<NoteDraft>;
  return (
    typeof draft.title === "string" &&
    typeof draft.body === "string" &&
    typeof draft.tags === "string" &&
    typeof draft.taskCode === "string" &&
    typeof draft.planCode === "string" &&
    typeof draft.pinned === "boolean" &&
    typeof draft.remindAt === "string" &&
    typeof draft.remindedAt === "string" &&
    typeof draft.code === "string"
  );
}

function isNotesViewMode(value: unknown): value is NotesViewMode {
  return value === "list" || value === "new" || value === "edit";
}
