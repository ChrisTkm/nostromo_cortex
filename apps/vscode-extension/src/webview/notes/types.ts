import type { NoteRecord } from "@cortex/core";

export type NotesPanelMode = "list" | "new" | { type: "edit"; code: string };
export type NotesViewMode = "list" | "new" | "edit";

export type NotesMessage =
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
