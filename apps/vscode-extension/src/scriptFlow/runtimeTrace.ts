export const SCRIPT_FLOW_TRACE_VERSION = 1 as const;

export const SCRIPT_FLOW_TRACE_EVENTS = [
  "run_start",
  "run_end",
  "span_start",
  "span_end",
  "span_error",
  "loop_sample",
  "external_call"
] as const;

export type ScriptFlowTraceVersion = typeof SCRIPT_FLOW_TRACE_VERSION;
export type ScriptFlowTraceEventName = (typeof SCRIPT_FLOW_TRACE_EVENTS)[number];

export const SCRIPT_FLOW_TRACE_STATUSES = ["ok", "error", "cancelled", "timeout", "running"] as const;
export type ScriptFlowTraceStatus = (typeof SCRIPT_FLOW_TRACE_STATUSES)[number];

export const SCRIPT_FLOW_EXTERNAL_TARGET_KINDS = ["http", "db", "fs", "queue", "process", "script", "other"] as const;
export type ScriptFlowExternalTargetKind = (typeof SCRIPT_FLOW_EXTERNAL_TARGET_KINDS)[number];

export type ScriptFlowTraceCounters = Record<string, number>;
export type ScriptFlowTraceMetadata = Record<string, unknown>;

export interface ScriptFlowTraceBaseEvent {
  version: ScriptFlowTraceVersion;
  event: ScriptFlowTraceEventName;
  run_id: string;
  timestamp: string;
  script_path: string;
  script_hash?: string;
  language?: string;
  machine_id?: string;
  process_id?: string | number;
  entity_id?: string;
  node_id?: string;
  span_id?: string;
  parent_span_id?: string;
  duration_ms?: number;
  status?: ScriptFlowTraceStatus;
  counters?: ScriptFlowTraceCounters;
  metadata?: ScriptFlowTraceMetadata;
}

export interface ScriptFlowRunStartEvent extends ScriptFlowTraceBaseEvent {
  event: "run_start";
}

export interface ScriptFlowRunEndEvent extends ScriptFlowTraceBaseEvent {
  event: "run_end";
  status: ScriptFlowTraceStatus;
  duration_ms: number;
}

export interface ScriptFlowSpanStartEvent extends ScriptFlowTraceBaseEvent {
  event: "span_start";
  node_id: string;
  span_id: string;
}

export interface ScriptFlowSpanEndEvent extends ScriptFlowTraceBaseEvent {
  event: "span_end";
  node_id: string;
  span_id: string;
  duration_ms: number;
  status: ScriptFlowTraceStatus;
}

export interface ScriptFlowSpanErrorEvent extends ScriptFlowTraceBaseEvent {
  event: "span_error";
  node_id: string;
  span_id: string;
  status: "error";
  metadata: ScriptFlowTraceMetadata & {
    error: {
      type?: string;
      message: string;
      stack?: string;
    };
  };
}

export interface ScriptFlowLoopSampleEvent extends ScriptFlowTraceBaseEvent {
  event: "loop_sample";
  node_id: string;
  counters: ScriptFlowTraceCounters & {
    iterations: number;
    sample_count: number;
    total_ms: number;
    avg_ms: number;
    max_ms: number;
  };
}

export interface ScriptFlowExternalCallEvent extends ScriptFlowTraceBaseEvent {
  event: "external_call";
  duration_ms: number;
  status: ScriptFlowTraceStatus;
  metadata: ScriptFlowTraceMetadata & {
    target_kind: ScriptFlowExternalTargetKind;
    target: string;
  };
}

export type ScriptFlowTraceEvent =
  | ScriptFlowRunStartEvent
  | ScriptFlowRunEndEvent
  | ScriptFlowSpanStartEvent
  | ScriptFlowSpanEndEvent
  | ScriptFlowSpanErrorEvent
  | ScriptFlowLoopSampleEvent
  | ScriptFlowExternalCallEvent;

export function isScriptFlowTraceEventName(value: unknown): value is ScriptFlowTraceEventName {
  return typeof value === "string" && SCRIPT_FLOW_TRACE_EVENTS.includes(value as ScriptFlowTraceEventName);
}

export function isScriptFlowTraceStatus(value: unknown): value is ScriptFlowTraceStatus {
  return typeof value === "string" && SCRIPT_FLOW_TRACE_STATUSES.includes(value as ScriptFlowTraceStatus);
}
