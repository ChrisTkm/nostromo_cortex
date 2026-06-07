export function clampAutoRefreshSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(600, Math.trunc(numeric));
}

export function clampLogsLimit(value: number): number {
  if (!Number.isFinite(value)) return 500;
  return Math.max(50, Math.min(5000, Math.trunc(value)));
}
