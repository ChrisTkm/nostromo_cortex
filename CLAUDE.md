# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

pnpm workspace monorepo (pnpm 10.11.0 via corepack, Node 20+, TypeScript 5.8 strict, ESM).

- `apps/vscode-extension` — the VS Code extension itself. Extension host is CommonJS bundled by esbuild; webviews are React + React Flow bundled as IIFE into `media/*.js`.
- `apps/mcp-server` — local MCP server over tasks/telemetry (tsup).
- `packages/core` — domain layer: Zod schemas, graph (Kahn topo sort + cycle detection), MongoDB stores, seed data. Path alias `@cortex/core`.
- `packages/telemetry` — telemetry with SQLite (default) or JSONL backend. Path alias `@cortex/telemetry`.
- `scripts/` — `tsx`-run utilities (seed, check-cycles, inspect snapshots/telemetry).

## Commands worth knowing

Standard ones (`pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`) work as expected. Less obvious:

- `pnpm dev` — concurrent watchers for core, telemetry, mcp-server, vscode-extension. Use this, not per-package `dev`.
- `pnpm seed` — populates Mongo with sample S1→S2→S2.1→S3/S4 graph. Needs Mongo up.
- `pnpm mongo:up` / `pnpm mongo:down` — Docker compose for local Mongo 7.
- `pnpm check:cycles` — runs `scripts/check-cycles.ts` against current Mongo data.
- `pnpm inspect:snapshot` / `pnpm inspect:telemetry:runs` / `:failures` / `pnpm inspect:cost` — debug helpers.
- `vitest run <file>` or `vitest -t '<name>'` — single test / pattern. Tests live next to source as `*.test.ts`.

## Gotchas

- **Mongo URL must be `127.0.0.1`, not `localhost`.** On dual-stack hosts Node's resolver tries IPv6 first and Mongo only listens on IPv4 — `localhost` adds a multi-second timeout per handshake. All defaults and tests use `127.0.0.1`; keep it that way.
- **For the VS Code extension, Mongo URL lives in SecretStorage.** Set it via the `Cortex: Set Mongo URL` command. The `cortex.mongoUrl` setting is kept for back-compat but deprecated. Env vars (`MONGO_URL` etc., see `README.development.md`) apply to scripts and the MCP server, not the extension.
- **No `console.log` in the extension host.** Use the structured logger (pretty / json formatter with per-component context). Console output bypasses the logs panel and telemetry.
- **Webviews never talk to MongoDB directly.** The extension host resolves data and posts JSON snapshots over the webview message channel. Don't import `mongodb` from `src/webview/**`.
- **`apps/vscode-extension/media/*` is generated.** `.js`, `.js.map`, `.css`, `.css.map` under `media/` are esbuild output committed so the packaged `.vsix` ships them — edit the React sources under `src/webview/**` and rebuild, never hand-edit `media/`. ESLint already ignores this directory.
- **esbuild watch is unminified; prod is minified.** If you're debugging a stack trace from a packaged extension, the line/column won't match watch-mode output — use sourcemaps.
- **Smoke-testing the extension is manual.** Bundles + fixtures don't substitute a real run. Launch from VS Code with `F5` (or build via `pnpm --filter @cortex/vscode-extension build` first) and exercise the touched panel — Vitest alone won't catch webview regressions.

## Conventions

- Strict TypeScript everywhere — no `any` slips, no implicit returns.
- `bulkWrite({ ordered: false })` for mass Mongo writes; `ensureIndexes()` is idempotent and called at activate.
- Mongo client is a singleton opened in `activate()` and closed in `deactivate()`. Don't reopen per operation.
- README and most docs are written in Spanish — match the language of surrounding prose when editing them, and keep code/identifiers in English.

## Other docs

- `@README.architecture.md` — extension host ↔ webview architecture, share patterns.
- `@README.development.md` — env vars, MCP server build/run, F5 launch steps.
- `@docs/log-contract.md` — log document shape expected by the Logs panel.

If you add module-specific instructions for `apps/vscode-extension`, `apps/mcp-server`, `packages/core`, or `packages/telemetry`, drop a `CLAUDE.md` inside that directory — it's loaded automatically when Claude works there.
