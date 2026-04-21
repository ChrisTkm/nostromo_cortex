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
    remindAt: "",
    remindedAt: "",
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
    remindAt: toLocalDateTimeInput(note.remindAt),
    remindedAt: note.remindedAt ?? "",
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
  const hasContent =
    hasText(draft.title) ||
    hasText(draft.body) ||
    hasText(draft.tags) ||
    hasText(draft.taskCode) ||
    hasText(draft.planCode) ||
    hasText(draft.remindAt) ||
    hasText(draft.remindedAt);
  const draftCode = draft.code.trim();
  const normalizedSelection = selectedCode.trim();

  if (!hasContent && !draft.pinned && !draftCode) {
    return true;
  }

  return draftCode === normalizedSelection && !hasContent && !draft.pinned;
}

function hasText(value: string) {
  return value.trim().length > 0;
}

export function toLocalDateTimeInput(value?: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function toIsoDateTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}
