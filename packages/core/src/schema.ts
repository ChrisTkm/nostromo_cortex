import { z } from "zod";

import { TASK_SEVERITIES, TASK_STATUSES, type TaskDocumentInput, type TaskRecord } from "./types.js";

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
