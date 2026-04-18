import { z } from "zod";

import {
  PLAN_STATUSES,
  TASK_SEVERITIES,
  TASK_STATUSES,
  type ActionPlanDocument,
  type ActionPlanRecord,
  type NoteDocumentInput,
  type NoteRecord,
  type TaskDocumentInput,
  type TaskRecord
} from "./types.js";

function normalizeEnum(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

const taskSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") {
    return input;
  }

  const value = input as Record<string, unknown>;
  return {
    ...value,
    short_task: value.short_task ?? value.shortTask,
    depends_on: value.depends_on ?? value.dependsOn,
    duration_estimate: value.duration_estimate ?? value.durationEstimate,
    order_hint: value.order_hint ?? value.orderHint,
    source_ref: value.source_ref ?? value.sourceRef,
    plan_code: value.plan_code ?? value.planCode,
    out_of_scope: value.out_of_scope ?? value.outOfScope,
    created_at: value.created_at ?? value.createdAt,
    updated_at: value.updated_at ?? value.updatedAt,
    lane: value.lane ?? value.group,
    status: normalizeEnum(value.status),
    severity: normalizeEnum(value.severity)
  };
}, z.object({
  _id: z.unknown().optional(),
  code: z.string().min(1),
  project: z.string().optional().nullable(),
  short_task: z.string().min(1),
  detail: z.string().default(""),
  status: z.enum(TASK_STATUSES),
  agent: z.string().min(1),
  severity: z.enum(TASK_SEVERITIES),
  tags: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  duration_estimate: z.number().positive().optional().nullable(),
  lane: z.string().optional().nullable(),
  order_hint: z.number().optional().nullable(),
  source_ref: z.string().optional().nullable(),
  plan_code: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
  acceptance: z.string().optional().nullable(),
  out_of_scope: z.string().optional().nullable(),
  created_at: z.union([z.string(), z.date()]).optional(),
  updated_at: z.union([z.string(), z.date()]).optional()
}));

const planProgressSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") {
    return input;
  }

  const value = input as Record<string, unknown>;
  return {
    total: value.total ?? 0,
    pending: value.pending ?? 0,
    in_progress: value.in_progress ?? value.inProgress ?? 0,
    blocked: value.blocked ?? 0,
    done: value.done ?? 0,
    failed: value.failed ?? 0
  };
}, z.object({
  total: z.number().default(0),
  pending: z.number().default(0),
  in_progress: z.number().default(0),
  blocked: z.number().default(0),
  done: z.number().default(0),
  failed: z.number().default(0)
}));

const actionPlanSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") {
    return input;
  }

  const value = input as Record<string, unknown>;
  return {
    ...value,
    current_task_code: value.current_task_code ?? value.currentTaskCode,
    created_at: value.created_at ?? value.createdAt,
    updated_at: value.updated_at ?? value.updatedAt,
    completed_at: value.completed_at ?? value.completedAt,
    status: normalizeEnum(value.status)
  };
}, z.object({
  _id: z.unknown().optional(),
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  goal: z.string().default(""),
  context: z.string().default(""),
  status: z.enum(PLAN_STATUSES),
  project: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  progress: planProgressSchema.default({
    total: 0,
    pending: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    failed: 0
  }),
  current_task_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  created_at: z.union([z.string(), z.date()]).optional(),
  updated_at: z.union([z.string(), z.date()]).optional(),
  completed_at: z.union([z.string(), z.date()]).optional().nullable()
}));

const noteSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") {
    return input;
  }

  const value = input as Record<string, unknown>;
  return {
    ...value,
    task_code: value.task_code ?? value.taskCode,
    plan_code: value.plan_code ?? value.planCode,
    created_at: value.created_at ?? value.createdAt,
    updated_at: value.updated_at ?? value.updatedAt
  };
}, z.object({
  _id: z.unknown().optional(),
  code: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(""),
  tags: z.array(z.string()).default([]),
  task_code: z.string().optional().nullable(),
  plan_code: z.string().optional().nullable(),
  pinned: z.boolean().optional(),
  created_at: z.union([z.string(), z.date()]).optional(),
  updated_at: z.union([z.string(), z.date()]).optional()
}));

function normalizeIsoDate(value: string | Date | undefined): string {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function normalizeTaskDocument(input: TaskDocumentInput): TaskRecord {
  const parsed = taskSchema.parse(input);
  return {
    ...(parsed._id ? { id: String(parsed._id) } : {}),
    code: parsed.code.trim(),
    ...(parsed.project ? { project: parsed.project.trim() } : {}),
    shortTask: parsed.short_task.trim(),
    detail: parsed.detail.trim(),
    status: parsed.status,
    agent: parsed.agent.trim(),
    severity: parsed.severity,
    tags: dedupeSorted(parsed.tags),
    dependsOn: dedupeSorted(parsed.depends_on),
    ...(typeof parsed.duration_estimate === "number" ? { durationEstimate: parsed.duration_estimate } : {}),
    ...(parsed.lane ? { lane: parsed.lane } : {}),
    ...(typeof parsed.order_hint === "number" ? { orderHint: parsed.order_hint } : {}),
    ...(parsed.source_ref ? { sourceRef: parsed.source_ref } : {}),
    ...(parsed.plan_code ? { planCode: parsed.plan_code } : {}),
    ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
    ...(parsed.acceptance ? { acceptance: parsed.acceptance } : {}),
    ...(parsed.out_of_scope ? { outOfScope: parsed.out_of_scope } : {}),
    createdAt: normalizeIsoDate(parsed.created_at),
    updatedAt: normalizeIsoDate(parsed.updated_at)
  };
}

export function normalizeActionPlan(input: ActionPlanDocument): ActionPlanRecord {
  const parsed = actionPlanSchema.parse(input);
  return {
    ...(parsed._id ? { id: String(parsed._id) } : {}),
    code: parsed.code.trim(),
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    goal: parsed.goal.trim(),
    context: parsed.context.trim(),
    status: parsed.status,
    ...(parsed.project ? { project: parsed.project.trim() } : {}),
    tags: dedupeSorted(parsed.tags),
    progress: {
      total: parsed.progress.total,
      pending: parsed.progress.pending,
      in_progress: parsed.progress.in_progress,
      blocked: parsed.progress.blocked,
      done: parsed.progress.done,
      failed: parsed.progress.failed
    },
    ...(parsed.current_task_code ? { currentTaskCode: parsed.current_task_code.trim() } : {}),
    ...(parsed.notes ? { notes: parsed.notes.trim() } : {}),
    createdAt: normalizeIsoDate(parsed.created_at),
    updatedAt: normalizeIsoDate(parsed.updated_at),
    ...(typeof parsed.completed_at !== "undefined"
      ? { completedAt: parsed.completed_at ? normalizeIsoDate(parsed.completed_at) : null }
      : {})
  };
}

export function normalizeNote(input: NoteDocumentInput): NoteRecord {
  const parsed = noteSchema.parse(input);
  return {
    ...(parsed._id ? { id: String(parsed._id) } : {}),
    code: parsed.code.trim(),
    title: parsed.title.trim(),
    body: parsed.body,
    tags: dedupeSorted(parsed.tags),
    ...(parsed.task_code ? { taskCode: parsed.task_code.trim() } : {}),
    ...(parsed.plan_code ? { planCode: parsed.plan_code.trim() } : {}),
    pinned: Boolean(parsed.pinned),
    createdAt: normalizeIsoDate(parsed.created_at),
    updatedAt: normalizeIsoDate(parsed.updated_at)
  };
}

export function normalizeTasks(inputs: TaskDocumentInput[]): TaskRecord[] {
  const tasks = inputs.map(normalizeTaskDocument);
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.code)) {
      duplicates.add(task.code);
    }
    seen.add(task.code);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate task codes detected: ${[...duplicates].join(", ")}`);
  }
  return tasks.sort((left, right) => {
    const orderDiff = (left.orderHint ?? Number.MAX_SAFE_INTEGER) - (right.orderHint ?? Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return left.code.localeCompare(right.code);
  });
}
