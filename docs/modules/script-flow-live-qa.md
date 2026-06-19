# Script Flow Live QA guide

Script Flow Live layers runtime evidence over the static Script Flow graph.
It does not execute scripts from the VS Code extension. Evidence comes from
local or shared `.scriptflow.trace.jsonl` files written by a script, wrapper,
test runner, DB proxy, or remote worker.

## Fixture Set

End-to-end runtime fixtures live in:

```text
apps/vscode-extension/src/scriptFlow/runtimeTrace/__fixtures__/
```

Use these for QA without production data:

| Fixture | Purpose |
|---|---|
| `e2e-small.jsonl` | Minimal run with one span, overlay badge, and replay start/end. |
| `e2e-large-loop.jsonl` | Hot loop represented by aggregated `loop_sample` events. |
| `e2e-error.jsonl` | Runtime error evidence, handled error metadata, and error replay. |
| `e2e-external-script.jsonl` | Remote/container script path plus external DB call evidence. |

The parser test `runtimeTraceE2e.test.ts` validates all four.

## Manual QA Flow

1. Open `apps/vscode-extension/fixtures/script-flow/sample.ts`.
2. Run `Cortex: Open Script Flow`.
3. Confirm the graph renders normally even if no trace exists.
4. Copy or create one of the JSONL fixtures next to the script using one of the companion names:
   - `.scriptflow.trace.jsonl`
   - `sample.ts.scriptflow.trace.jsonl`
   - `sample.scriptflow.trace.jsonl`
5. Confirm the second bar shows the Live state as `watching` or `updated`.
6. Confirm runtime badges appear only for nodes whose `node_id` matches the trace.
7. Use the run selector when the trace has multiple `run_id` values.
8. Use Play/Pause/Reset/Scrub to replay `span_start`, `span_end`, and `span_error` events.
9. Export Markdown from the footer when static messages exist.

## Generating A Trace

For local TypeScript prototypes, use:

```text
apps/vscode-extension/src/scriptFlow/instrumentation/typescriptTrace.ts
```

For Python prototypes, use:

```text
apps/vscode-extension/fixtures/script-flow/instrumentation/scriptflow_trace.py
```

Workflow:

1. Instrument the script with explicit `node_id` values copied from Script Flow.
2. Run the script normally from a terminal, job runner, or remote worker.
3. Write the trace next to the analyzed script or into a mounted/synced folder.
4. Refresh Script Flow or let the file watcher update the overlay.

## UX Rules

- Static hints are analyzer output: missing `else`, missing return, unused CTE, empty loop body, broad except, etc.
- Runtime evidence is observed execution: calls, duration, active spans, loop iterations, external calls, and errors.
- Static warning colors must not imply runtime failure.
- Runtime errors must not imply the analyzer found a syntax or design defect.
- Durations are wall-clock evidence from the trace writer. They are not static estimates.
- Loop counts are often aggregated or sampled. UI labels should say runtime evidence, not exact per-iteration profiling.
- Live file watch is local-first and safe by default: no HTTP server, no WebSocket, no open port.

## Verification Commands

```powershell
.\node_modules\.bin\vitest.cmd run apps/vscode-extension/src/scriptFlow/bridge.test.ts apps/vscode-extension/src/scriptFlow/runtimeTraceParser.test.ts apps/vscode-extension/src/scriptFlow/runtimeTraceE2e.test.ts apps/vscode-extension/src/scriptFlow/instrumentation/typescriptTrace.test.ts apps/vscode-extension/src/scriptFlow/analyzers/typescript.test.ts apps/vscode-extension/src/scriptFlow/analyzers/python.test.ts apps/vscode-extension/src/scriptFlow/analyzers/sql.test.ts
python -B -m py_compile apps/vscode-extension/fixtures/script-flow/instrumentation/scriptflow_trace.py apps/vscode-extension/fixtures/script-flow/instrumented_sample.py
corepack pnpm --filter nostromo-cortex build
```

`corepack pnpm --filter nostromo-cortex typecheck` currently has unrelated
repository debt outside Script Flow Live; report it separately from the runtime
feature gate until that debt is cleaned up.
