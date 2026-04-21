import { describe, expect, it } from "vitest";

import { createDraftFromNote, createEmptyDraft, isDraftPristineForSelection, slugifyTitle, splitCsv } from "./drafts";

describe("notes drafts helpers", () => {
  it("creates an empty draft with the expected defaults", () => {
    expect(createEmptyDraft()).toEqual({
      title: "",
      body: "",
      tags: "",
      taskCode: "",
      planCode: "",
      pinned: false,
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
      pinned: true
    });
  });

  it("slugifies titles and falls back to note for empty slugs", () => {
    expect(slugifyTitle("  Revisión de Sprint #7  ")).toBe("revision-de-sprint-7");
    expect(slugifyTitle("///")).toBe("note");
  });

  it("splits comma-separated tags, trims whitespace, and drops empty entries", () => {
    expect(splitCsv(" alpha, beta ,, gamma  , ")).toEqual(["alpha", "beta", "gamma"]);
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
