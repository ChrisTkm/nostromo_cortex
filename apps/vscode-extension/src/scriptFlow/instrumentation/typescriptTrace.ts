import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

export type ScriptFlowTraceStatus = "ok" | "error" | "cancelled" | "timeout" | "running";

export interface ScriptFlowTracerOptions {
  scriptPath: string;
  tracePath?: string;
  runId?: string;
  scriptHash?: string;
  language?: string;
  machineId?: string;
  processId?: string | number;
  now?: () => Date;
}

export interface ScriptFlowSpanOptions {
  nodeId: string;
  spanId?: string;
  parentSpanId?: string;
  metadata?: Record<string, unknown>;
}

export interface ScriptFlowLoopOptions {
  nodeId: string;
  spanId?: string;
  parentSpanId?: string;
  flushEveryIterations?: number;
  flushEveryMs?: number;
  metadata?: Record<string, unknown>;
}

type TraceEvent = Record<string, unknown>;

export function createScriptFlowTracer(options: ScriptFlowTracerOptions) {
  return new ScriptFlowTracer(options);
}

export class ScriptFlowTracer {
  readonly runId: string;
  readonly tracePath: string;

  private readonly options: Required<Pick<ScriptFlowTracerOptions, "language" | "now">> &
    Omit<ScriptFlowTracerOptions, "language" | "now">;
  private readonly startedAt = performance.now();
  private readonly loops = new Set<ScriptFlowLoopAggregator>();
  private sequence = 0;
  private ended = false;

  constructor(options: ScriptFlowTracerOptions) {
    this.options = {
      language: "typescript",
      now: () => new Date(),
      ...options,
    };
    this.runId = options.runId ?? randomUUID();
    this.tracePath =
      options.tracePath ?? join(dirname(options.scriptPath), `${basename(options.scriptPath)}.scriptflow.trace.jsonl`);
  }

  startRun(metadata?: Record<string, unknown>) {
    this.write({
      event: "run_start",
      metadata,
    });
  }

  endRun(status: ScriptFlowTraceStatus = "ok", counters?: Record<string, number>) {
    if (this.ended) {
      return;
    }
    for (const loop of this.loops) {
      loop.flush("run_end");
    }
    this.write({
      event: "run_end",
      duration_ms: Math.round(performance.now() - this.startedAt),
      status,
      counters,
    });
    this.ended = true;
  }

  async span<T>(options: ScriptFlowSpanOptions, fn: () => Promise<T> | T): Promise<T> {
    const spanId = options.spanId ?? this.nextSpanId(options.nodeId);
    const startedAt = performance.now();
    this.write({
      event: "span_start",
      node_id: options.nodeId,
      parent_span_id: options.parentSpanId,
      span_id: spanId,
      metadata: options.metadata,
    });

    try {
      const result = await fn();
      this.write({
        event: "span_end",
        node_id: options.nodeId,
        parent_span_id: options.parentSpanId,
        span_id: spanId,
        duration_ms: Math.round(performance.now() - startedAt),
        status: "ok",
      });
      return result;
    } catch (error) {
      this.write({
        event: "span_error",
        node_id: options.nodeId,
        parent_span_id: options.parentSpanId,
        span_id: spanId,
        duration_ms: Math.round(performance.now() - startedAt),
        status: "error",
        metadata: {
          ...options.metadata,
          error: serializeError(error),
        },
      });
      throw error;
    }
  }

  createLoopAggregator(options: ScriptFlowLoopOptions) {
    const loop = new ScriptFlowLoopAggregator(this, options);
    this.loops.add(loop);
    return loop;
  }

  emitLoopSample(options: ScriptFlowLoopOptions & {
    iterations: number;
    sampleCount: number;
    totalMs: number;
    maxMs: number;
    metadata?: Record<string, unknown>;
  }) {
    if (options.iterations <= 0 || options.sampleCount <= 0) {
      return;
    }
    this.write({
      event: "loop_sample",
      node_id: options.nodeId,
      parent_span_id: options.parentSpanId,
      span_id: options.spanId,
      counters: {
        iterations: options.iterations,
        sample_count: options.sampleCount,
        total_ms: roundMs(options.totalMs),
        avg_ms: roundMs(options.totalMs / options.iterations),
        max_ms: roundMs(options.maxMs),
      },
      metadata: options.metadata,
    });
  }

  write(event: TraceEvent) {
    mkdirSync(dirname(this.tracePath), { recursive: true });
    appendFileSync(this.tracePath, `${JSON.stringify(this.withCommonFields(event))}\n`, "utf8");
  }

  private withCommonFields(event: TraceEvent) {
    return compactObject({
      version: 1,
      ...event,
      run_id: this.runId,
      timestamp: this.options.now().toISOString(),
      script_path: this.options.scriptPath,
      script_hash: this.options.scriptHash,
      language: this.options.language,
      machine_id: this.options.machineId,
      process_id: this.options.processId,
    });
  }

  private nextSpanId(nodeId: string) {
    this.sequence += 1;
    return `${nodeId}:${this.sequence}`;
  }
}

export class ScriptFlowLoopAggregator {
  private readonly startedAt = performance.now();
  private readonly flushEveryIterations: number;
  private readonly flushEveryMs: number;
  private iterations = 0;
  private sampleCount = 0;
  private totalMs = 0;
  private maxMs = 0;
  private lastFlushAt = performance.now();

  constructor(
    private readonly tracer: ScriptFlowTracer,
    private readonly options: ScriptFlowLoopOptions,
  ) {
    this.flushEveryIterations = options.flushEveryIterations ?? 1000;
    this.flushEveryMs = options.flushEveryMs ?? 2000;
  }

  sample(durationMs: number, iterations = 1) {
    if (iterations <= 0) {
      return;
    }
    this.iterations += iterations;
    this.sampleCount += 1;
    this.totalMs += durationMs;
    this.maxMs = Math.max(this.maxMs, durationMs);

    const now = performance.now();
    if (this.iterations >= this.flushEveryIterations || now - this.lastFlushAt >= this.flushEveryMs) {
      this.flush("threshold");
    }
  }

  measure<T>(fn: () => T, iterations = 1): T {
    const startedAt = performance.now();
    try {
      return fn();
    } finally {
      this.sample(performance.now() - startedAt, iterations);
    }
  }

  flush(reason = "manual") {
    if (this.iterations <= 0 || this.sampleCount <= 0) {
      return;
    }
    this.tracer.emitLoopSample({
      ...this.options,
      iterations: this.iterations,
      sampleCount: this.sampleCount,
      totalMs: this.totalMs,
      maxMs: this.maxMs,
      metadata: {
        ...this.options.metadata,
        flush_reason: reason,
        window_ms: roundMs(performance.now() - this.startedAt),
      },
    });
    this.iterations = 0;
    this.sampleCount = 0;
    this.totalMs = 0;
    this.maxMs = 0;
    this.lastFlushAt = performance.now();
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    type: typeof error,
    message: String(error),
  };
}

function compactObject<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function roundMs(value: number) {
  return Math.round(value * 1000) / 1000;
}
