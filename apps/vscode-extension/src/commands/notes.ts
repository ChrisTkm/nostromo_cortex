import * as vscode from "vscode";

import type { ExtensionTaskService } from "../service.js";

export type NotesPanelMode = "list" | "new" | { type: "edit"; code: string };
export type NotesPanelRequest = {
  mode: NotesPanelMode;
  search?: string;
};
export type NoteQuickPickItem = vscode.QuickPickItem & { code: string };

export async function pickNoteCode(
  service: ExtensionTaskService,
  options: {
    title: string;
    placeHolder: string;
    emptyMessage: string;
  },
): Promise<string | undefined> {
  const notes = await service.listNotes();
  if (notes.length === 0) {
    void vscode.window.showInformationMessage(options.emptyMessage);
    return undefined;
  }

  const items: NoteQuickPickItem[] = [...notes]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((note) => ({
      label: note.code,
      description: note.title,
      ...(note.body ? { detail: note.body } : {}),
      code: note.code,
    }));
  const picked = await vscode.window.showQuickPick(items, {
    title: options.title,
    placeHolder: options.placeHolder,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.code;
}

export async function pickPendingReminderCode(
  service: ExtensionTaskService,
) {
  const notes = await service.listNotes();
  const reminderNotes = (notes ?? []).filter(
    (note) => note.remindAt && !note.remindedAt,
  );
  if (reminderNotes.length === 0) {
    void vscode.window.showInformationMessage(
      "No pending reminders available to snooze.",
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    reminderNotes
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((note) => ({
        label: note.code,
        description: note.title,
        detail: note.remindAt,
      })),
    {
      title: "Select a reminder to snooze",
      placeHolder: "Choose a note code",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  return picked?.label;
}
