import type { TaskDocumentInput, TaskRecord } from "@cortex/core";

import type { TaskEditorDraft } from "../types";

export function createDraftFromTask(task: TaskRecord): TaskEditorDraft {
  return {
    code: task.code,
    shortTask: task.shortTask,
    detail: task.detail,
    status: task.status,
    severity: task.severity,
    project: task.project ?? "",
    agent: task.agent,
    lane: task.lane ?? "",
    durationEstimate: typeof task.durationEstimate === "number" ? String(task.durationEstimate) : "",
    tags: task.tags.join(", "),
    dependsOn: task.dependsOn.join(", "),
    sourceRef: task.sourceRef ?? "",
    prompt: task.prompt ?? "",
    acceptance: task.acceptance ?? "",
    outOfScope: task.outOfScope ?? ""
  };
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function areDraftsEqual(a: TaskEditorDraft, b: TaskEditorDraft): boolean {
  return (
    a.shortTask === b.shortTask &&
    a.detail === b.detail &&
    a.status === b.status &&
    a.severity === b.severity &&
    a.project === b.project &&
    a.agent === b.agent &&
    a.lane === b.lane &&
    a.durationEstimate === b.durationEstimate &&
    a.tags === b.tags &&
    a.dependsOn === b.dependsOn &&
    a.sourceRef === b.sourceRef &&
    a.prompt === b.prompt &&
    a.acceptance === b.acceptance &&
    a.outOfScope === b.outOfScope
  );
}

export function validateDependsOn(deps: string[], catalog: string[], selfCode: string): string | null {
  const invalid = deps.filter((dep) => dep !== selfCode && !catalog.includes(dep));
  if (invalid.length > 0) {
    return `Unknown task codes: ${invalid.join(", ")}`;
  }
  return null;
}

export function buildSavePayload(
  draft: TaskEditorDraft,
  task: TaskRecord,
  catalog: string[]
): { ok: true; input: TaskDocumentInput } | { ok: false; error: string } {
  const shortTask = draft.shortTask.trim();
  if (!shortTask) {
    return { ok: false, error: "Title is required." };
  }

  const agent = draft.agent.trim();
  if (!agent) {
    return { ok: false, error: "Agent is required." };
  }

  const depsArr = splitCsv(draft.dependsOn);
  const depsError = validateDependsOn(depsArr, catalog, draft.code);
  if (depsError) {
    return { ok: false, error: depsError };
  }

  let durationEstimate: number | null = null;
  if (draft.durationEstimate.trim()) {
    const parsed = Number(draft.durationEstimate.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: "Duration must be a positive number." };
    }
    durationEstimate = parsed;
  }

  return {
    ok: true,
    input: {
      code: draft.code,
      short_task: shortTask,
      detail: draft.detail,
      status: draft.status,
      severity: draft.severity,
      agent,
      project: draft.project.trim() || null,
      lane: draft.lane.trim() || null,
      duration_estimate: durationEstimate,
      tags: splitCsv(draft.tags),
      depends_on: depsArr,
      source_ref: draft.sourceRef.trim() || null,
      prompt: draft.prompt.trim() || null,
      acceptance: draft.acceptance.trim() || null,
      out_of_scope: draft.outOfScope.trim() || null,
      created_at: task.createdAt,
      updated_at: new Date().toISOString()
    }
  };
}

/** Extracted cancel logic so it can be tested independently of the React hook. */
export function handleCancelLogic(
  isDirty: boolean,
  postMessage: (msg: unknown) => void,
  confirmFn: (msg: string) => boolean
): void {
  if (!isDirty) {
    postMessage({ type: "taskEditor:cancel" });
    return;
  }
  if (confirmFn("Discard unsaved changes?")) {
    postMessage({ type: "taskEditor:cancel" });
  }
}
