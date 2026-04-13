import fs from "node:fs";
import path from "node:path";

import type { CostSummary, CostSummaryRange, TelemetryRun, TelemetryRunInput, TelemetryStore } from "./types.js";

export class JsonlTelemetryStore implements TelemetryStore {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  initialize(): void {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, "");
    }
  }

  async recordRun(run: TelemetryRunInput): Promise<TelemetryRun> {
    const normalized: TelemetryRun = {
      ...run,
      currency: run.currency ?? "USD",
      createdAt: run.createdAt ?? new Date().toISOString(),
      taskCodes: [...run.taskCodes].sort((left, right) => left.localeCompare(right)),
      metadata: run.metadata ?? {}
    };

    fs.appendFileSync(this.filePath, `${JSON.stringify(normalized)}\n`, "utf8");
    return normalized;
  }

  async recentRuns(limit: number): Promise<TelemetryRun[]> {
    return this.readAll().slice(-limit).reverse();
  }

  async recentFailures(limit: number): Promise<TelemetryRun[]> {
    return this.readAll()
      .filter((run) => !run.success)
      .slice(-limit)
      .reverse();
  }

  async costSummary(range?: CostSummaryRange): Promise<CostSummary> {
    const runs = this.readAll().filter((run) => {
      if (range?.from && run.startedAt < range.from) {
        return false;
      }
      if (range?.to && run.endedAt > range.to) {
        return false;
      }
      return true;
    });

    return runs.reduce<CostSummary>(
      (summary, run) => {
        summary.totalRuns += 1;
        summary.totalEstimatedCostUsd += run.estimatedCostUsd ?? 0;
        summary.billingModes[run.billingMode] += 1;
        summary.bySource[run.source] = (summary.bySource[run.source] ?? 0) + (run.estimatedCostUsd ?? 0);
        summary.totalEstimatedCostUsd = Number(summary.totalEstimatedCostUsd.toFixed(6));
        return summary;
      },
      {
        totalRuns: 0,
        totalEstimatedCostUsd: 0,
        billingModes: {
          exact: 0,
          estimated: 0,
          unavailable: 0
        },
        bySource: {}
      }
    );
  }

  private readAll(): TelemetryRun[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    return fs
      .readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TelemetryRun);
  }
}

