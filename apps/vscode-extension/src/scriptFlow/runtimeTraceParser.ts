import { promises as fs } from "node:fs";

import {
  SCRIPT_FLOW_TRACE_VERSION,
  isScriptFlowTraceEventName,
  isScriptFlowTraceStatus,
  type ScriptFlowExternalCallEvent,
  type ScriptFlowLoopSampleEvent,
  type ScriptFlowSpanErrorEvent,
  type ScriptFlowSpanEndEvent,
  type ScriptFlowSpanStartEvent,
  type ScriptFlowTraceEvent,
  type ScriptFlowTraceStatus
} from "./runtimeTrace.js";

export interface ScriptFlowTraceParseOptions {
  runId?: string;
}

export interface ScriptFlowTraceWarning {
  line: number;
  code: "invalid_json" | "invalid_event" | "unsupported_version" | "missing_field";
  message: string;
  raw?: string;
}

export interface ScriptFlowRuntimeError {
  timestamp: string;
  spanId?: string;
  type?: string;
  message: string;
  handled?: boolean;
}

export interface ScriptFlowRuntimeActiveSpan {
  spanId: string;
  parentSpanId?: string;
  nodeId: string;
  startedAt: string;
  lastSeenAt: string;
  status: "running" | "error";
}

export interface ScriptFlowRuntimeReplayEvent {
  index: number;
  timestamp: string;
  event: "span_start" | "span_end" | "span_error";
  runId: string;
  nodeId: string;
  spanId?: string;
  parentSpanId?: string;
  status?: ScriptFlowTraceStatus;
  durationMs?: number;
  errorType?: string;
  errorMessage?: string;
}

export interface ScriptFlowRuntimeNodeAggregate {
  nodeId: string;
  eventCount: number;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  lastStatus?: ScriptFlowTraceStatus;
  lastTimestamp?: string;
  errorCount: number;
  errors: ScriptFlowRuntimeError[];
  activeSpans: ScriptFlowRuntimeActiveSpan[];
  loop: {
    iterations: number;
    sampleCount: number;
    totalMs: number;
    avgMs: number;
    maxMs: number;
  };
  externalCalls: {
    count: number;
    totalMs: number;
    avgMs: number;
    maxMs: number;
    errors: number;
    slowest?: {
      durationMs: number;
      target?: string;
      targetKind?: string;
      timestamp: string;
    };
  };
}

export interface ScriptFlowRuntimeRunAggregate {
  runId: string;
  scriptPath: string;
  scriptHash?: string;
  language?: string;
  startedAt?: string;
  endedAt?: string;
  lastTimestamp?: string;
  status?: ScriptFlowTraceStatus;
  durationMs?: number;
  eventCount: number;
  nodeCount: number;
  machineIds: string[];
  processIds: Array<string | number>;
  counters: Record<string, number>;
  nodes: Record<string, ScriptFlowRuntimeNodeAggregate>;
  activeSpans: ScriptFlowRuntimeActiveSpan[];
  events: ScriptFlowRuntimeReplayEvent[];
}

export interface ScriptFlowTraceParseResult {
  runs: ScriptFlowRuntimeRunAggregate[];
  runsById: Record<string, ScriptFlowRuntimeRunAggregate>;
  latestRunId?: string;
  selectedRunId?: string;
  selectedRun?: ScriptFlowRuntimeRunAggregate;
  warnings: ScriptFlowTraceWarning[];
  acceptedLines: number;
  skippedLines: number;
}

interface MutableRun extends Omit<ScriptFlowRuntimeRunAggregate, "nodes" | "activeSpans" | "nodeCount" | "machineIds" | "processIds"> {
  nodeMap: Map<string, MutableNode>;
  activeSpanMap: Map<string, ScriptFlowRuntimeActiveSpan>;
  machineIdSet: Set<string>;
  processIdSet: Map<string, string | number>;
}

interface MutableNode extends Omit<ScriptFlowRuntimeNodeAggregate, "activeSpans"> {
  activeSpanMap: Map<string, ScriptFlowRuntimeActiveSpan>;
}

export async function readScriptFlowTraceFile(filePath: string, options: ScriptFlowTraceParseOptions = {}) {
  const content = await fs.readFile(filePath, "utf8");
  return parseScriptFlowTraceJsonl(content, options);
}

export function parseScriptFlowTraceJsonl(content: string, options: ScriptFlowTraceParseOptions = {}): ScriptFlowTraceParseResult {
  const warnings: ScriptFlowTraceWarning[] = [];
  const runs = new Map<string, MutableRun>();
  let acceptedLines = 0;
  let skippedLines = 0;

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const event = parseTraceLine(line, lineNumber, warnings);
    if (!event) {
      skippedLines += 1;
      continue;
    }

    acceptedLines += 1;
    applyEvent(getOrCreateRun(runs, event), event);
  }

  const finalizedRuns = Array.from(runs.values()).map(finalizeRun);
  const runsById = Object.fromEntries(finalizedRuns.map((run) => [run.runId, run]));
  const latestRunId = findLatestRunId(finalizedRuns);
  const selectedRunId = options.runId ?? latestRunId;

  return {
    runs: finalizedRuns,
    runsById,
    latestRunId,
    selectedRunId,
    selectedRun: selectedRunId ? runsById[selectedRunId] : undefined,
    warnings,
    acceptedLines,
    skippedLines
  };
}

function parseTraceLine(line: string, lineNumber: number, warnings: ScriptFlowTraceWarning[]): ScriptFlowTraceEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    warnings.push({
      line: lineNumber,
      code: "invalid_json",
      message: `Line ${lineNumber} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      raw: line
    });
    return undefined;
  }

  if (!isRecord(parsed)) {
    warnings.push({
      line: lineNumber,
      code: "invalid_event",
      message: `Line ${lineNumber} must be a JSON object.`,
      raw: line
    });
    return undefined;
  }

  if (parsed.version !== SCRIPT_FLOW_TRACE_VERSION) {
    warnings.push({
      line: lineNumber,
      code: "unsupported_version",
      message: `Line ${lineNumber} uses unsupported trace version ${String(parsed.version)}.`,
      raw: line
    });
    return undefined;
  }

  if (!isScriptFlowTraceEventName(parsed.event)) {
    warnings.push({
      line: lineNumber,
      code: "invalid_event",
      message: `Line ${lineNumber} has unsupported event ${String(parsed.event)}.`,
      raw: line
    });
    return undefined;
  }

  const missing = collectMissingCommonFields(parsed);
  missing.push(...collectMissingEventFields(parsed));
  if (missing.length > 0) {
    warnings.push({
      line: lineNumber,
      code: "missing_field",
      message: `Line ${lineNumber} is missing required field(s): ${missing.join(", ")}.`,
      raw: line
    });
    return undefined;
  }

  return parsed as unknown as ScriptFlowTraceEvent;
}

function collectMissingCommonFields(event: Record<string, unknown>) {
  const missing: string[] = [];
  if (typeof event.run_id !== "string" || !event.run_id) missing.push("run_id");
  if (typeof event.timestamp !== "string" || !event.timestamp) missing.push("timestamp");
  if (typeof event.script_path !== "string" || !event.script_path) missing.push("script_path");
  return missing;
}

function collectMissingEventFields(event: Record<string, unknown>) {
  const missing: string[] = [];
  switch (event.event) {
    case "run_end":
      requireStatusAndDuration(event, missing);
      break;
    case "span_start":
      requireString(event, "node_id", missing);
      requireString(event, "span_id", missing);
      break;
    case "span_end":
      requireString(event, "node_id", missing);
      requireString(event, "span_id", missing);
      requireStatusAndDuration(event, missing);
      break;
    case "span_error":
      requireString(event, "node_id", missing);
      requireString(event, "span_id", missing);
      if (event.status !== "error") missing.push("status=error");
      if (!hasErrorMetadata(event)) missing.push("metadata.error.message");
      break;
    case "loop_sample":
      requireString(event, "node_id", missing);
      for (const field of ["iterations", "sample_count", "total_ms", "avg_ms", "max_ms"]) {
        if (!isRecord(event.counters) || typeof event.counters[field] !== "number") {
          missing.push(`counters.${field}`);
        }
      }
      break;
    case "external_call":
      requireStatusAndDuration(event, missing);
      if (!isRecord(event.metadata) || typeof event.metadata.target_kind !== "string") missing.push("metadata.target_kind");
      if (!isRecord(event.metadata) || typeof event.metadata.target !== "string") missing.push("metadata.target");
      break;
  }
  return missing;
}

function requireStatusAndDuration(event: Record<string, unknown>, missing: string[]) {
  if (!isScriptFlowTraceStatus(event.status)) missing.push("status");
  if (typeof event.duration_ms !== "number") missing.push("duration_ms");
}

function requireString(event: Record<string, unknown>, field: string, missing: string[]) {
  if (typeof event[field] !== "string" || !event[field]) {
    missing.push(field);
  }
}

function hasErrorMetadata(event: Record<string, unknown>) {
  return isRecord(event.metadata) && isRecord(event.metadata.error) && typeof event.metadata.error.message === "string";
}

function getOrCreateRun(runs: Map<string, MutableRun>, event: ScriptFlowTraceEvent) {
  let run = runs.get(event.run_id);
  if (!run) {
    run = {
      runId: event.run_id,
      scriptPath: event.script_path,
      scriptHash: event.script_hash,
      language: event.language,
      eventCount: 0,
      counters: {},
      nodeMap: new Map(),
      activeSpanMap: new Map(),
      machineIdSet: new Set(),
      processIdSet: new Map(),
      events: []
    };
    runs.set(event.run_id, run);
  }
  return run;
}

function applyEvent(run: MutableRun, event: ScriptFlowTraceEvent) {
  run.eventCount += 1;
  run.scriptPath = event.script_path || run.scriptPath;
  run.scriptHash = event.script_hash ?? run.scriptHash;
  run.language = event.language ?? run.language;
  run.lastTimestamp = maxIso(run.lastTimestamp, event.timestamp);
  if (event.machine_id) run.machineIdSet.add(event.machine_id);
  if (event.process_id !== undefined) run.processIdSet.set(String(event.process_id), event.process_id);
  mergeCounters(run.counters, event.counters);

  if (event.event === "run_start") {
    run.startedAt = event.timestamp;
  }
  if (event.event === "run_end") {
    run.endedAt = event.timestamp;
    run.status = event.status;
    run.durationMs = event.duration_ms;
  }

  if (!event.node_id) {
    return;
  }

  if (isReplayEvent(event)) {
    run.events.push(toReplayEvent(run.eventCount, event));
  }

  const node = getOrCreateNode(run, event.node_id);
  node.eventCount += 1;
  node.lastTimestamp = maxIso(node.lastTimestamp, event.timestamp);
  if (event.status) {
    node.lastStatus = event.status;
  }

  if (typeof event.duration_ms === "number") {
    addDuration(node, event.duration_ms);
  }

  switch (event.event) {
    case "span_start":
      applySpanStart(run, node, event);
      break;
    case "span_end":
      closeSpan(run, node, event.span_id);
      if (event.status === "error") {
        node.errorCount += 1;
      }
      break;
    case "span_error":
      applySpanError(run, node, event);
      break;
    case "loop_sample":
      applyLoopSample(node, event);
      break;
    case "external_call":
      applyExternalCall(node, event);
      if (event.status === "error") {
        node.errorCount += 1;
      }
      break;
  }
}

function getOrCreateNode(run: MutableRun, nodeId: string) {
  let node = run.nodeMap.get(nodeId);
  if (!node) {
    node = {
      nodeId,
      eventCount: 0,
      count: 0,
      totalMs: 0,
      avgMs: 0,
      maxMs: 0,
      errorCount: 0,
      errors: [],
      activeSpanMap: new Map(),
      loop: {
        iterations: 0,
        sampleCount: 0,
        totalMs: 0,
        avgMs: 0,
        maxMs: 0
      },
      externalCalls: {
        count: 0,
        totalMs: 0,
        avgMs: 0,
        maxMs: 0,
        errors: 0
      }
    };
    run.nodeMap.set(nodeId, node);
  }
  return node;
}

function addDuration(node: MutableNode, durationMs: number) {
  node.count += 1;
  node.totalMs += durationMs;
  node.maxMs = Math.max(node.maxMs, durationMs);
  node.avgMs = node.count > 0 ? node.totalMs / node.count : 0;
}

function applySpanStart(run: MutableRun, node: MutableNode, event: ScriptFlowSpanStartEvent) {
  const activeSpan: ScriptFlowRuntimeActiveSpan = {
    spanId: event.span_id,
    parentSpanId: event.parent_span_id,
    nodeId: event.node_id,
    startedAt: event.timestamp,
    lastSeenAt: event.timestamp,
    status: "running"
  };
  node.activeSpanMap.set(event.span_id, activeSpan);
  run.activeSpanMap.set(event.span_id, activeSpan);
}

function closeSpan(run: MutableRun, node: MutableNode, spanId: string) {
  node.activeSpanMap.delete(spanId);
  run.activeSpanMap.delete(spanId);
}

function applySpanError(run: MutableRun, node: MutableNode, event: ScriptFlowSpanErrorEvent) {
  node.errorCount += 1;
  const error = event.metadata.error;
  node.errors.push({
    timestamp: event.timestamp,
    spanId: event.span_id,
    type: error.type,
    message: error.message,
    handled: typeof event.metadata.handled === "boolean" ? event.metadata.handled : undefined
  });

  const activeSpan = node.activeSpanMap.get(event.span_id) ?? run.activeSpanMap.get(event.span_id);
  if (activeSpan) {
    activeSpan.status = "error";
    activeSpan.lastSeenAt = event.timestamp;
  }
}

function applyLoopSample(node: MutableNode, event: ScriptFlowLoopSampleEvent) {
  node.loop.iterations += event.counters.iterations;
  node.loop.sampleCount += event.counters.sample_count;
  node.loop.totalMs += event.counters.total_ms;
  node.loop.maxMs = Math.max(node.loop.maxMs, event.counters.max_ms);
  node.loop.avgMs = node.loop.iterations > 0 ? node.loop.totalMs / node.loop.iterations : 0;
}

function applyExternalCall(node: MutableNode, event: ScriptFlowExternalCallEvent) {
  node.externalCalls.count += 1;
  node.externalCalls.totalMs += event.duration_ms;
  node.externalCalls.maxMs = Math.max(node.externalCalls.maxMs, event.duration_ms);
  node.externalCalls.avgMs = node.externalCalls.count > 0 ? node.externalCalls.totalMs / node.externalCalls.count : 0;
  if (event.status === "error") {
    node.externalCalls.errors += 1;
  }
  if (!node.externalCalls.slowest || event.duration_ms > node.externalCalls.slowest.durationMs) {
    node.externalCalls.slowest = {
      durationMs: event.duration_ms,
      target: event.metadata.target,
      targetKind: event.metadata.target_kind,
      timestamp: event.timestamp
    };
  }
}

function finalizeRun(run: MutableRun): ScriptFlowRuntimeRunAggregate {
  const nodes = Object.fromEntries(Array.from(run.nodeMap.values()).map((node) => [node.nodeId, finalizeNode(node)]));
  const activeSpans = Array.from(run.activeSpanMap.values());
  return {
    runId: run.runId,
    scriptPath: run.scriptPath,
    scriptHash: run.scriptHash,
    language: run.language,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    lastTimestamp: run.lastTimestamp,
    status: run.status,
    durationMs: run.durationMs,
    eventCount: run.eventCount,
    nodeCount: Object.keys(nodes).length,
    machineIds: Array.from(run.machineIdSet),
    processIds: Array.from(run.processIdSet.values()),
    counters: run.counters,
    nodes,
    activeSpans,
    events: run.events.slice().sort(sortReplayEvents)
  };
}

function isReplayEvent(event: ScriptFlowTraceEvent): event is ScriptFlowSpanStartEvent | ScriptFlowSpanEndEvent | ScriptFlowSpanErrorEvent {
  return event.event === "span_start" || event.event === "span_end" || event.event === "span_error";
}

function toReplayEvent(index: number, event: ScriptFlowSpanStartEvent | ScriptFlowSpanEndEvent | ScriptFlowSpanErrorEvent): ScriptFlowRuntimeReplayEvent {
  const metadataError = event.event === "span_error" ? event.metadata.error : undefined;
  return {
    index,
    timestamp: event.timestamp,
    event: event.event,
    runId: event.run_id,
    nodeId: event.node_id,
    spanId: event.span_id,
    parentSpanId: event.parent_span_id,
    status: event.status,
    durationMs: event.duration_ms,
    errorType: metadataError?.type,
    errorMessage: metadataError?.message
  };
}

function sortReplayEvents(left: ScriptFlowRuntimeReplayEvent, right: ScriptFlowRuntimeReplayEvent) {
  const byTime = safeTime(Date.parse(left.timestamp)) - safeTime(Date.parse(right.timestamp));
  return byTime === 0 ? left.index - right.index : byTime;
}

function finalizeNode(node: MutableNode): ScriptFlowRuntimeNodeAggregate {
  return {
    nodeId: node.nodeId,
    eventCount: node.eventCount,
    count: node.count,
    totalMs: node.totalMs,
    avgMs: node.avgMs,
    maxMs: node.maxMs,
    lastStatus: node.lastStatus,
    lastTimestamp: node.lastTimestamp,
    errorCount: node.errorCount,
    errors: node.errors,
    activeSpans: Array.from(node.activeSpanMap.values()),
    loop: node.loop,
    externalCalls: node.externalCalls
  };
}

function mergeCounters(target: Record<string, number>, counters: Record<string, number> | undefined) {
  if (!counters) {
    return;
  }
  for (const [key, value] of Object.entries(counters)) {
    if (typeof value === "number") {
      target[key] = (target[key] ?? 0) + value;
    }
  }
}

function findLatestRunId(runs: ScriptFlowRuntimeRunAggregate[]) {
  return runs
    .slice()
    .sort((left, right) => {
      const rightTime = Date.parse(right.endedAt ?? right.lastTimestamp ?? right.startedAt ?? "");
      const leftTime = Date.parse(left.endedAt ?? left.lastTimestamp ?? left.startedAt ?? "");
      return safeTime(rightTime) - safeTime(leftTime);
    })[0]?.runId;
}

function maxIso(current: string | undefined, next: string) {
  if (!current) {
    return next;
  }
  return safeTime(Date.parse(next)) >= safeTime(Date.parse(current)) ? next : current;
}

function safeTime(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
