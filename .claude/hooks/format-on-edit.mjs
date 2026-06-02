#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve, relative, sep } from "node:path";

const SKIP_PREFIXES = [
  "node_modules" + sep,
  "dist" + sep,
  ".git" + sep,
  "data" + sep,
  ["apps", "vscode-extension", "media"].join(sep) + sep,
];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let file;
  try {
    const o = JSON.parse(raw || "{}");
    file =
      o.tool_input?.file_path ||
      o.tool_response?.filePath ||
      o.tool_response?.file_path;
  } catch {
    process.exit(0);
  }
  if (!file) process.exit(0);

  const repo = process.cwd();
  const abs = resolve(repo, file);
  const rel = relative(repo, abs);
  if (rel.startsWith("..") || SKIP_PREFIXES.some((p) => rel.startsWith(p))) {
    process.exit(0);
  }

  const quoted = '"' + abs.replace(/"/g, '\\"') + '"';
  spawnSync(
    `pnpm exec prettier --write --ignore-unknown --log-level=silent ${quoted}`,
    { stdio: "ignore", shell: true },
  );
  process.exit(0);
});
