import { describe, expect, it } from "vitest";

import { createDraftFromNote, createEmptyDraft, isDraftPristineForSelection, slugifyTitle, splitCsv, toIsoDateTime } from "./drafts";

describe("notes drafts helpers", () => {
  it("creates an empty draft with the expected defaults", () => {
    expect(createEmptyDraft()).toEqual({
      title: "",
      body: "",
      tags: "",
      taskCode: "",
      planCode: "",
      pinned: false,
      remindAt: "",
      remindedAt: "",
      code: ""
    });
  });

  it("maps a note record into a draft without changing field names", () => {
    expect(
      createDraftFromNote({
        code: "note-1",
        title: "Decision log",
        body: "Body",
        tags: ["alpha", "beta"],
        taskCode: "TASK-7",
        planCode: "PLAN-2",
        pinned: true,
        remindAt: "2026-04-20T12:34:00.000Z",
        remindedAt: "2026-04-20T12:50:00.000Z",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T01:00:00.000Z"
      })
    ).toEqual({
      code: "note-1",
      title: "Decision log",
      body: "Body",
      tags: "alpha, beta",
      taskCode: "TASK-7",
      planCode: "PLAN-2",
      pinned: true,
      remindAt: expect.stringMatching(/^2026-04-20T\d{2}:34$/),
      remindedAt: "2026-04-20T12:50:00.000Z"
    });
  });

  it("slugifies titles and falls back to note for empty slugs", () => {
    expect(slugifyTitle("  Revisión de Sprint #7  ")).toBe("revision-de-sprint-7");
    expect(slugifyTitle("///")).toBe("note");
  });

  it("splits comma-separated tags, trims whitespace, and drops empty entries", () => {
    expect(splitCsv(" alpha, beta ,, gamma  , ")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("converts datetime-local values into ISO strings for saving", () => {
    const iso = toIsoDateTime("2026-04-20T12:34");
    expect(iso).toMatch(/:34:00\.000Z$/);
    expect(Number.isFinite(new Date(String(iso)).getTime())).toBe(true);
  });

  it("treats blank drafts and selection placeholders as pristine", () => {
    expect(isDraftPristineForSelection(createEmptyDraft(), "note-1")).toBe(true);
    expect(
      isDraftPristineForSelection(
        {
          ...createEmptyDraft(),
          code: "note-1"
        },
        "note-1"
      )
    ).toBe(true);
  });

  it("treats whitespace content, different codes, and pinned changes as non-pristine", () => {
    expect(
      isDraftPristineForSelection(
        {
          ...createEmptyDraft(),
          title: "  changed  ",
          code: "note-1"
        },
        "note-1"
      )
    ).toBe(false);

    expect(
      isDraftPristineForSelection(
        {
          ...createEmptyDraft(),
          code: "other-note"
        },
        "note-1"
      )
    ).toBe(false);

    expect(
      isDraftPristineForSelection(
        {
          ...createEmptyDraft(),
          code: "note-1",
          pinned: true
        },
        "note-1"
      )
    ).toBe(false);
  });
});
