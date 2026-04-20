import type { NoteRecord } from "@cortex/core";

import type { NoteDraft } from "../types";

export function createEmptyDraft(): NoteDraft {
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

export function createDraftFromNote(note: NoteRecord): NoteDraft {
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

export function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function slugifyTitle(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}

export function isDraftPristineForSelection(draft: NoteDraft, selectedCode: string) {
  return (
    (!draft.title && !draft.body && !draft.tags && !draft.taskCode && !draft.planCode && !draft.code) ||
    (draft.code === selectedCode && !draft.title && !draft.body && !draft.tags && !draft.taskCode && !draft.planCode && !draft.pinned)
  );
}
