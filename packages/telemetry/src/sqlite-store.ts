import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { CostSummary, CostSummaryRange, TelemetryRun, TelemetryRunInput, TelemetryStore } from "./types.js";

export class SqliteTelemetryStore implements TelemetryStore {
  private readonly db: Database.Database;

  constructor(private readonly sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_runs (
        run_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source TEXT NOT NULL,
        actor TEXT NOT NULL,
        tool_name TEXT,
        model TEXT,
        provider TEXT,
        prompt_hash TEXT,
        task_codes TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_input_tokens INTEGER,
        reasoning_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd REAL,
        currency TEXT NOT NULL,
        billing_mode TEXT NOT NULL,
        pricing_version TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_runs_created_at ON telemetry_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telemetry_runs_success ON telemetry_runs(success);
      CREATE INDEX IF NOT EXISTS idx_telemetry_runs_source ON telemetry_runs(source);
    `);
  }

  async recordRun(run: TelemetryRunInput): Promise<TelemetryRun> {
    const createdAt = run.createdAt ?? new Date().toISOString();
    const normalized: TelemetryRun = {
      ...run,
      currency: run.currency ?? "USD",
      taskCodes: [...run.taskCodes].sort((left, right) => left.localeCompare(right)),
      metadata: run.metadata ?? {},
      createdAt
    };

    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO telemetry_runs (
        run_id, trace_id, session_id, source, actor, tool_name, model, provider, prompt_hash,
        task_codes, started_at, ended_at, duration_ms, success, error_code, error_message,
        input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, total_tokens,
        estimated_cost_usd, currency, billing_mode, pricing_version, metadata_json, created_at
      ) VALUES (
        @runId, @traceId, @sessionId, @source, @actor, @toolName, @model, @provider, @promptHash,
        @taskCodes, @startedAt, @endedAt, @durationMs, @success, @errorCode, @errorMessage,
        @inputTokens, @outputTokens, @cachedInputTokens, @reasoningTokens, @totalTokens,
        @estimatedCostUsd, @currency, @billingMode, @pricingVersion, @metadataJson, @createdAt
      )
    `);

    statement.run({
      runId: normalized.runId,
      traceId: normalized.traceId,
      sessionId: normalized.sessionId,
      source: normalized.source,
      actor: normalized.actor,
      toolName: normalized.toolName ?? null,
      model: normalized.model ?? null,
      provider: normalized.provider ?? null,
      promptHash: normalized.promptHash ?? null,
      taskCodes: JSON.stringify(normalized.taskCodes),
      startedAt: normalized.startedAt,
      endedAt: normalized.endedAt,
      durationMs: normalized.durationMs,
      success: normalized.success ? 1 : 0,
      errorCode: normalized.errorCode ?? null,
      errorMessage: normalized.errorMessage ?? null,
      inputTokens: normalized.inputTokens ?? null,
      outputTokens: normalized.outputTokens ?? null,
      cachedInputTokens: normalized.cachedInputTokens ?? null,
      reasoningTokens: normalized.reasoningTokens ?? null,
      totalTokens: normalized.totalTokens ?? null,
      estimatedCostUsd: normalized.estimatedCostUsd ?? null,
      currency: normalized.currency,
      billingMode: normalized.billingMode,
      pricingVersion: normalized.pricingVersion ?? null,
      metadataJson: JSON.stringify(normalized.metadata),
      createdAt: normalized.createdAt
    });

    return normalized;
  }

  async recentRuns(limit: number): Promise<TelemetryRun[]> {
    const rows = this.db
      .prepare(`SELECT * FROM telemetry_runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  async recentFailures(limit: number): Promise<TelemetryRun[]> {
    const rows = this.db
      .prepare(`SELECT * FROM telemetry_runs WHERE success = 0 ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  async costSummary(range?: CostSummaryRange): Promise<CostSummary> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (range?.from) {
      clauses.push(`started_at >= ?`);
      params.push(range.from);
    }
    if (range?.to) {
      clauses.push(`ended_at <= ?`);
      params.push(range.to);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM telemetry_runs ${whereClause}`).all(...params) as Array<Record<string, unknown>>;
    const summary: CostSummary = {
      totalRuns: rows.length,
      totalEstimatedCostUsd: 0,
      billingModes: {
        exact: 0,
        estimated: 0,
        unavailable: 0
      },
      bySource: {}
    };

    for (const row of rows) {
      const cost = Number(row.estimated_cost_usd ?? 0);
      summary.totalEstimatedCostUsd += Number.isFinite(cost) ? cost : 0;
      const billingMode = String(row.billing_mode) as keyof CostSummary["billingModes"];
      summary.billingModes[billingMode] += 1;
      const source = String(row.source);
      summary.bySource[source] = (summary.bySource[source] ?? 0) + cost;
    }

    summary.totalEstimatedCostUsd = Number(summary.totalEstimatedCostUsd.toFixed(6));
    return summary;
  }

  private mapRow(row: Record<string, unknown>): TelemetryRun {
    return {
      runId: String(row.run_id),
      traceId: String(row.trace_id),
      sessionId: String(row.session_id),
      source: String(row.source) as TelemetryRun["source"],
      actor: String(row.actor) as TelemetryRun["actor"],
      ...(row.tool_name ? { toolName: String(row.tool_name) } : {}),
      ...(row.model ? { model: String(row.model) } : {}),
      ...(row.provider ? { provider: String(row.provider) } : {}),
      ...(row.prompt_hash ? { promptHash: String(row.prompt_hash) } : {}),
      taskCodes: JSON.parse(String(row.task_codes)),
      startedAt: String(row.started_at),
      endedAt: String(row.ended_at),
      durationMs: Number(row.duration_ms),
      success: Boolean(row.success),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      ...(row.input_tokens !== null && row.input_tokens !== undefined ? { inputTokens: Number(row.input_tokens) } : {}),
      ...(row.output_tokens !== null && row.output_tokens !== undefined ? { outputTokens: Number(row.output_tokens) } : {}),
      ...(row.cached_input_tokens !== null && row.cached_input_tokens !== undefined
        ? { cachedInputTokens: Number(row.cached_input_tokens) }
        : {}),
      ...(row.reasoning_tokens !== null && row.reasoning_tokens !== undefined
        ? { reasoningTokens: Number(row.reasoning_tokens) }
        : {}),
      ...(row.total_tokens !== null && row.total_tokens !== undefined ? { totalTokens: Number(row.total_tokens) } : {}),
      ...(row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined
        ? { estimatedCostUsd: Number(row.estimated_cost_usd) }
        : {}),
      currency: String(row.currency),
      billingMode: String(row.billing_mode) as TelemetryRun["billingMode"],
      ...(row.pricing_version ? { pricingVersion: String(row.pricing_version) } : {}),
      metadata: JSON.parse(String(row.metadata_json)),
      createdAt: String(row.created_at)
    };
  }
}
