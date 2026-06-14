# Copilot Instructions — Cortex

## Repository shape

pnpm workspace monorepo (pnpm 10.11.0, Node 20+, TypeScript 5.8 strict, ESM throughout).

| Package | Path | Description |
|---|---|---|
| `@cortex/vscode-extension` | `apps/vscode-extension` | VS Code extension (host CJS via esbuild, webviews IIFE) |
| `@cortex/mcp-server` | `apps/mcp-server` | Local MCP server over tasks/telemetry (tsup) |
| `@cortex/core` | `packages/core` | Domain layer: Zod schemas, Kahn DAG, MongoDB stores, seed data |
| `@cortex/telemetry` | `packages/telemetry` | Telemetry with SQLite (default) or JSONL backend |

Scripts live in `scripts/` and are run with `tsx`.

## Commands

```bash
pnpm install              # install all workspaces
pnpm dev                  # concurrent watchers for all packages (prefer this over per-package dev)
pnpm build                # build all packages
pnpm test                 # run all tests with vitest
pnpm lint                 # eslint across the monorepo
pnpm format               # prettier

# Single test / pattern
vitest run <file>
vitest -t '<test name pattern>'

# MongoDB (requires Docker)
pnpm mongo:up             # docker compose up -d mongo
pnpm mongo:down
pnpm seed                 # populate Mongo with sample DAG (needs Mongo up)

# Utilities
pnpm check:cycles         # detect dependency cycles in live Mongo data
pnpm inspect:snapshot     # dump graph snapshot to stdout
pnpm inspect:telemetry:runs / :failures / pnpm inspect:cost

# Build single package
pnpm --filter @cortex/vscode-extension build
pnpm --filter @cortex/mcp-server build
```

Tests live next to source as `*.test.ts`. Vitest picks up `packages/**/*.test.ts` and `apps/**/*.test.ts`.

## Architecture: data flow

The most important constraint — webviews **never** talk to MongoDB directly:

```
MongoDB
  └─► Extension Host (Node.js)
        └─► packages/core: buildGraphSnapshot() — pure, in-memory
              └─► serialized JSON snapshot posted over VS Code webview message channel
                    └─► React webview renders (no Mongo imports allowed here)
```

The same MongoDB singleton also feeds the MCP server directly for its tools.

Telemetry uses a separate SQLite database (or JSONL fallback), never MongoDB.

## esbuild bundles

The extension has **seven** esbuild entry points:

| Entry | Output | Format | Notes |
|---|---|---|---|
| `src/extension.ts` | `dist/extension.cjs` | CJS | Extension host; `vscode` is external |
| `src/webview/index.tsx` | `media/webview.js` | IIFE | PERT/DAG graph (React + React Flow + Dagre) |
| `src/webview/notes/index.tsx` | `media/notes.js` | IIFE | Notes CRUD panel |
| `src/webview/logs/index.tsx` | `media/logs.js` | IIFE | Logs read-only panel |
| `src/webview/archive/index.tsx` | `media/archive.js` | IIFE | Archive panel |
| `src/webview/md-graph/index.tsx` | `media/md-graph.js` | IIFE | Cortex Brain (local .md/.mdx graph) |
| `src/webview/script-flow/index.tsx` | `media/script-flow.js` | IIFE | Script Flow panel |

`media/*.js|css|map` are **generated and committed** — never hand-edit them. Edit React sources under `src/webview/**` and rebuild. Watch mode skips minification; production minifies with linked sourcemaps.

## Key conventions

- **`127.0.0.1` not `localhost`** for all Mongo URLs. On dual-stack hosts Node tries IPv6 first, Mongo only listens on IPv4 — `localhost` causes multi-second timeouts. All defaults, env vars, and tests use `127.0.0.1`.
- **No `console.log` in the extension host.** Use the structured logger (pretty/json, per-component context). Console output bypasses the Logs panel and telemetry.
- **Mongo client is a singleton.** Opened in `activate()`, closed in `deactivate()`. Never reopen per operation.
- **Mass Mongo writes use `bulkWrite({ ordered: false })`.**
- **`ensureIndexes()` is idempotent** and called at extension activation. Indexes use partial filters (`code_unique` only where field exists as string) to tolerate legacy documents.
- **Mongo URL for the VS Code extension lives in SecretStorage**, set via `Cortex: Set Mongo URL`. The `cortex.mongoUrl` setting is deprecated. Env vars (`MONGO_URL`, etc.) apply to scripts and the MCP server only.
- **Strict TypeScript everywhere** — no `any`, no implicit returns.
- **Docs and README prose are in Spanish; code and identifiers are in English.** Match the language of surrounding prose when editing documentation.
- **Smoke-testing the extension is manual.** Build with `pnpm --filter @cortex/vscode-extension build`, then `F5` in VS Code. Vitest alone won't catch webview regressions.

## packages/core internals

- `schema.ts` — Zod schemas for `TaskRecord`, `ActionPlanRecord`, `NoteRecord`, etc.
- `graph.ts` — Kahn's topological sort (O(V+E)), cycle detection, `buildGraphSnapshot()` pure function.
- `mongo.ts` — `MongoTaskStore`, `MongoActionPlanStore`, `MongoNoteStore` with `ensureIndexes()`.
- `types.ts` — TypeScript types derived from Zod schemas.

## Task data model (core fields)

`code`, `short_task`, `detail`, `status`, `agent`, `severity`, `tags`, `depends_on`, `duration_estimate`, `lane`, `order_hint`, `source_ref`, `created_at`, `updated_at`

## Script Flow

`src/scriptFlow/` in the extension host centralizes types, the host/webview bridge, and per-language analyzers. Python uses `web-tree-sitter` + `tree-sitter-python.wasm`; SQL uses `node-sql-parser` with postgresql→mysql fallback. Results are `ScriptFlowSnapshot` objects rendered in the webview.

## Telemetry fields

Each run can record: `run_id`, `trace_id`, `session_id`, `source`, `actor`, `tool_name`, `provider`, `model`, input/output/cached/reasoning tokens, `estimated_cost_usd`, `billing_mode`, `pricing_version`, `success`, `error_code`, duration, Mongo query counts, payload sizes.

Pricing is centralized in `packages/telemetry/src/pricing.ts` and versioned — never hardcode prices.

## MCP server tools

`task_list`, `task_get`, `task_ready_list`, `task_blockers`, `task_downstream`, `graph_snapshot`, `critical_path_estimate`, `task_cycles`, `telemetry_recent_runs`, `telemetry_cost_summary`. Responses use stable key ordering to minimize diff noise across runs.

## Log document contract (Python producers → Mongo `logs` collection)

```json
{
  "execution_id": "uuid4 or null",
  "timestamp": "UTC datetime",
  "tag": "BEGIN | END | READ | INSERT | ERROR | WARNING | INFO | ...",
  "class": "ClassName",
  "method": "method_name",
  "title": "short label",
  "message": "longer message",
  "level": "INFO | WARNING | ERROR"
}
```

Logs without `execution_id` are valid and rendered in an `ungrouped` section.
