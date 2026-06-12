import * as path from "node:path";

export function resolveLogsFilePath(options: {
  configured: string;
  workspaceRoot: string | undefined;
}): string | null {
  const trimmed = options.configured.trim();
  if (trimmed && path.isAbsolute(trimmed)) {
    return trimmed;
  }
  if (!options.workspaceRoot) {
    return null;
  }
  const relative = trimmed || path.join("logs", "cortex.jsonl");
  return path.join(options.workspaceRoot, relative);
}
