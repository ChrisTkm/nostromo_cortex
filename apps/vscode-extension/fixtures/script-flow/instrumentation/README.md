# Script Flow instrumentation snippets

These helpers are opt-in snippets for local experiments. They are not loaded by
the VS Code extension and they do not execute scripts from the extension host.

Use them when a script wants to emit `.scriptflow.trace.jsonl` next to itself:

- TypeScript helper: `src/scriptFlow/instrumentation/typescriptTrace.ts`
- Python helper: `fixtures/script-flow/instrumentation/scriptflow_trace.py`
- TypeScript example: `fixtures/script-flow/instrumented-sample.ts`
- Python example: `fixtures/script-flow/instrumented_sample.py`

Workflow:

1. Open the final instrumented script in Script Flow.
2. Copy the node ID from the node you want to measure.
3. Pass that ID explicitly to `span(...)` or the loop aggregator.
4. Run the script normally from your shell or job runner.
5. Reopen or refresh Script Flow; the companion trace is picked up from the
   same folder when named `<script>.scriptflow.trace.jsonl`.

Keep loop telemetry aggregated. Do not emit one event per iteration in hot loops.
