import { describe, expect, it } from "vitest";

import { normalizeNote } from "../src/schema.js";

describe("note reminder schema", () => {
  it("normalizes a valid remind_at ISO string", () => {
    const note = normalizeNote({
      code: "note-1",
      title: "Reminder note",
      remind_at: "2026-04-20T15:30:00.000Z"
    });

    expect(note.remindAt).toBe("2026-04-20T15:30:00.000Z");
  });

  it("rejects an invalid remind_at value", () => {
    expect(() =>
      normalizeNote({
        code: "note-2",
        title: "Broken reminder",
        remind_at: "tomorrow-ish"
      })
    ).toThrow(/remind_at must be a valid ISO datetime/i);
  });

  it("keeps remind_at absent when the field is omitted", () => {
    const note = normalizeNote({
      code: "note-3",
      title: "No reminder"
    });

    expect(note.remindAt).toBeUndefined();
  });
});
