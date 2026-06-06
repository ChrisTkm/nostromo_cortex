import { describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "@cortex/core";

import {
  areDraftsEqual,
  buildSavePayload,
  createDraftFromTask,
  handleCancelLogic,
  validateDependsOn
} from "./lib/drafts";

const sampleTask: TaskRecord = {
  code: "TASK-1",
  shortTask: "Fix the bug",
  detail: "Some existing detail",
  status: "PENDING",
  severity: "MEDIUM",
  agent: "codex",
  tags: ["frontend"],
  dependsOn: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const catalog = ["TASK-1", "TASK-2", "TASK-3"];

// ─── (a) Save válido dispara taskEditor:save con payload correcto ────────────

describe("buildSavePayload", () => {
  it("(a) returns ok=true with correct TaskDocumentInput for a valid draft", () => {
    const draft = createDraftFromTask(sampleTask);
    const result = buildSavePayload(draft, sampleTask, catalog);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.input.code).toBe("TASK-1");
    expect(result.input.short_task).toBe("Fix the bug");
    expect(result.input.status).toBe("PENDING");
    expect(result.input.severity).toBe("MEDIUM");
    expect(result.input.agent).toBe("codex");
    expect(result.input.tags).toEqual(["frontend"]);
    expect(result.input.depends_on).toEqual([]);
    expect(result.input.duration_estimate).toBeNull();
    expect(result.input.project).toBeNull();
    expect(result.input.lane).toBeNull();
    expect(result.input.source_ref).toBeNull();
    expect(result.input.prompt).toBeNull();
    expect(result.input.acceptance).toBeNull();
    expect(result.input.out_of_scope).toBeNull();
    expect(typeof result.input.updated_at).toBe("string");
  });

  it("(a) maps optional string fields to null when empty", () => {
    const draft = {
      ...createDraftFromTask(sampleTask),
      project: "  ",
      lane: "",
      sourceRef: " ",
      prompt: "",
      acceptance: "  ",
      outOfScope: ""
    };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.input.project).toBeNull();
    expect(result.input.lane).toBeNull();
    expect(result.input.source_ref).toBeNull();
    expect(result.input.prompt).toBeNull();
    expect(result.input.acceptance).toBeNull();
    expect(result.input.out_of_scope).toBeNull();
  });

  it("(a) maps durationEstimate correctly: empty → null, number → number", () => {
    const draftWithDuration = { ...createDraftFromTask(sampleTask), durationEstimate: "3.5" };
    const resultWithDuration = buildSavePayload(draftWithDuration, sampleTask, catalog);
    expect(resultWithDuration.ok).toBe(true);
    if (!resultWithDuration.ok) {
      return;
    }
    expect(resultWithDuration.input.duration_estimate).toBe(3.5);

    const draftNoEstimate = { ...createDraftFromTask(sampleTask), durationEstimate: "" };
    const resultNoEstimate = buildSavePayload(draftNoEstimate, sampleTask, catalog);
    expect(resultNoEstimate.ok).toBe(true);
    if (!resultNoEstimate.ok) {
      return;
    }
    expect(resultNoEstimate.input.duration_estimate).toBeNull();
  });

  it("returns ok=false when shortTask is empty", () => {
    const draft = { ...createDraftFromTask(sampleTask), shortTask: "   " };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("Title");
  });

  it("returns ok=false when agent is empty", () => {
    const draft = { ...createDraftFromTask(sampleTask), agent: "" };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("Agent");
  });

  it("returns ok=false when durationEstimate is non-numeric", () => {
    const draft = { ...createDraftFromTask(sampleTask), durationEstimate: "abc" };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(false);
  });
});

// ─── (d) Validación de dependsOn rechaza códigos inexistentes del catalog ────

describe("validateDependsOn", () => {
  it("(d) returns null when all deps exist in catalog", () => {
    expect(validateDependsOn(["TASK-2", "TASK-3"], catalog, "TASK-1")).toBeNull();
  });

  it("(d) ignores the task's own code in deps (self-reference allowed by catalog logic)", () => {
    expect(validateDependsOn(["TASK-1"], catalog, "TASK-1")).toBeNull();
  });

  it("(d) returns error string when a dep is not in catalog", () => {
    const err = validateDependsOn(["TASK-2", "TASK-99"], catalog, "TASK-1");
    expect(err).not.toBeNull();
    expect(err).toContain("TASK-99");
    expect(err).not.toContain("TASK-2");
  });

  it("(d) returns error for multiple unknown codes", () => {
    const err = validateDependsOn(["TASK-99", "TASK-100"], catalog, "TASK-1");
    expect(err).not.toBeNull();
    expect(err).toContain("TASK-99");
    expect(err).toContain("TASK-100");
  });

  it("(d) returns null for empty deps list", () => {
    expect(validateDependsOn([], catalog, "TASK-1")).toBeNull();
  });
});

describe("buildSavePayload dependsOn validation", () => {
  it("(d) buildSavePayload rejects draft with unknown dependsOn codes", () => {
    const draft = { ...createDraftFromTask(sampleTask), dependsOn: "TASK-2, TASK-99" };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("TASK-99");
  });

  it("(d) buildSavePayload accepts draft with valid dependsOn codes", () => {
    const draft = { ...createDraftFromTask(sampleTask), dependsOn: "TASK-2, TASK-3" };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.input.depends_on).toEqual(["TASK-2", "TASK-3"]);
  });

  it("(d) buildSavePayload sends empty array for empty dependsOn", () => {
    const draft = { ...createDraftFromTask(sampleTask), dependsOn: "" };
    const result = buildSavePayload(draft, sampleTask, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.input.depends_on).toEqual([]);
  });
});

// ─── (b) Cancel sin cambios cierra sin prompt ────────────────────────────────
// ─── (c) Cancel con cambios muestra confirm ──────────────────────────────────

describe("handleCancelLogic", () => {
  it("(b) posts taskEditor:cancel without calling confirm when isDirty=false", () => {
    const postMessage = vi.fn();
    const confirm = vi.fn();

    handleCancelLogic(false, postMessage, confirm);

    expect(postMessage).toHaveBeenCalledWith({ type: "taskEditor:cancel" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("(c) calls confirm when isDirty=true", () => {
    const postMessage = vi.fn();
    const confirm = vi.fn().mockReturnValue(false);

    handleCancelLogic(true, postMessage, confirm);

    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("(c) posts taskEditor:cancel when isDirty=true and user confirms", () => {
    const postMessage = vi.fn();
    const confirm = vi.fn().mockReturnValue(true);

    handleCancelLogic(true, postMessage, confirm);

    expect(confirm).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: "taskEditor:cancel" });
  });
});

// ─── areDraftsEqual ──────────────────────────────────────────────────────────

describe("areDraftsEqual", () => {
  it("returns true for identical drafts", () => {
    const draft = createDraftFromTask(sampleTask);
    expect(areDraftsEqual(draft, { ...draft })).toBe(true);
  });

  it("returns false when shortTask differs", () => {
    const draft = createDraftFromTask(sampleTask);
    expect(areDraftsEqual(draft, { ...draft, shortTask: "Different" })).toBe(false);
  });

  it("returns false when dependsOn differs", () => {
    const draft = createDraftFromTask(sampleTask);
    expect(areDraftsEqual(draft, { ...draft, dependsOn: "TASK-2" })).toBe(false);
  });

  it("returns false when prompt differs (previously non-editable field)", () => {
    const draft = createDraftFromTask(sampleTask);
    expect(areDraftsEqual(draft, { ...draft, prompt: "new prompt" })).toBe(false);
  });
});
