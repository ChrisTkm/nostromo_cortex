import type { NoteRecord } from "@cortex/core";
import * as vscode from "vscode";

import type { ExtensionTaskService } from "./service.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const REMINDER_FILTER_QUERY = "has:reminder";
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function scheduleAll(service: ExtensionTaskService, statusBar: vscode.StatusBarItem) {
  clearTimers();

  const notes = await service.listNotes();
  updateStatusBar(statusBar, notes);

  const now = Date.now();
  for (const note of notes) {
    if (!note.remindAt || note.remindedAt) {
      continue;
    }

    const remindAt = new Date(note.remindAt).getTime();
    if (!Number.isFinite(remindAt) || remindAt <= now) {
      continue;
    }

    const delay = Math.min(remindAt - now, MAX_TIMEOUT_MS);
    const handle = setTimeout(() => {
      timers.delete(note.code);
      void fireDue(service, statusBar, "live").then(() => scheduleAll(service, statusBar));
    }, delay);

    timers.set(note.code, handle);
  }
}

export async function fireDue(
  service: ExtensionTaskService,
  statusBar: vscode.StatusBarItem,
  mode: "startup" | "live" = "live"
) {
  const dueNotes = await service.listPendingReminders({ now: new Date().toISOString() });

  for (const note of dueNotes) {
    await service.recordInteraction("note_reminder_fired", {
      code: note.code,
      mode
    });

    const choice = await vscode.window.showInformationMessage(note.title, "Abrir", "Posponer 1h", "Descartar");
    if (choice === "Abrir") {
      await vscode.commands.executeCommand("cortex.openNotes", { search: note.code });
      continue;
    }

    if (choice === "Posponer 1h") {
      const nextReminder = new Date(Date.now() + ONE_HOUR_MS).toISOString();
      await service.rescheduleReminder(note.code, nextReminder);
      await service.recordInteraction("note_reminder_snoozed", {
        code: note.code,
        remind_at: nextReminder
      });
      continue;
    }

    const remindedAt = new Date().toISOString();
    await service.markReminded(note.code, remindedAt);
    await service.recordInteraction("note_reminder_dismissed", {
      code: note.code,
      reminded_at: remindedAt
    });
  }

  if (dueNotes.length === 0) {
    updateStatusBar(statusBar, await service.listNotes());
  }
}

export function disposeReminderTimers() {
  clearTimers();
}

function updateStatusBar(statusBar: vscode.StatusBarItem, notes: readonly NoteRecord[]) {
  const pending = notes.filter((note) => note.remindAt && !note.remindedAt);
  if (pending.length === 0) {
    statusBar.hide();
    return;
  }

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const dueToday = pending.filter((note) => {
    const remindAt = new Date(String(note.remindAt)).getTime();
    return Number.isFinite(remindAt) && remindAt <= endOfToday.getTime();
  }).length;

  statusBar.text = dueToday > 0 ? `$(bell) ${dueToday}` : "$(bell)";
  statusBar.tooltip =
    dueToday > 0
      ? `${dueToday} reminder${dueToday === 1 ? "" : "s"} due by today`
      : `${pending.length} upcoming reminder${pending.length === 1 ? "" : "s"}`;
  statusBar.command = {
    command: "cortex.openNotes",
    title: "Open notes with reminders",
    arguments: [{ search: REMINDER_FILTER_QUERY }]
  };
  statusBar.show();
}

function clearTimers() {
  for (const handle of timers.values()) {
    clearTimeout(handle);
  }
  timers.clear();
}
