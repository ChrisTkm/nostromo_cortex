# Script Flow Live - Runtime trace contract

Script Flow Live overlays runtime evidence on top of the static Script Flow graph. The extension must never execute arbitrary scripts to collect that evidence. Runtimes, CLIs, test harnesses, wrappers, or remote agents write a local trace file that the extension can read later.

Default trace path:

```text
.scriptflow.trace.jsonl
```

Each line is one JSON object. The file is append-only, UTF-8, newline-delimited JSON.

The VS Code extension currently discovers local traces next to the analyzed script using the first existing candidate:

1. `.scriptflow.trace.jsonl`
2. `<script-file>.scriptflow.trace.jsonl`
3. `<script-file-without-extension>.scriptflow.trace.jsonl`

Selection-only Script Flow views do not load runtime traces because their node ranges and IDs are derived from the selected fragment, not the full file.

Live ingestion MVP:

- Transport: local file watch/tail of the same companion JSONL candidates.
- Default network posture: no HTTP server, no WebSocket, no open port.
- Remote-friendly path: a remote worker may write into a synced or mounted folder that appears locally next to the analyzed script.
- Throttle: file change bursts are debounced before reparsing so hot loops can batch `loop_sample` writes without flooding the webview.
- Fallback: if no file exists yet, Script Flow shows a waiting live state and keeps watching the candidate paths; existing static analysis and replay still work.

## Goals

- Correlate runtime events with static Script Flow nodes through `node_id`.
- Correlate the same runtime events with Domain Graph entities through optional `entity_id`.
- Keep the format small enough for long-running scripts and large loops.
- Support local and remote executions without assuming the extension host owns the process.
- Separate static hints, such as flow gaps, from runtime evidence, such as a node that actually errored or took 1.2s.
- Keep versioning explicit so future readers can reject or migrate old traces safely.

## Schema Version

Current wire version:

```json
{"version":1}
```

Rules:

- `version` is required on every line.
- Readers must ignore events with an unsupported `version`.
- Writers must not mix incompatible schemas in the same file.
- Additive fields are allowed; changing required fields requires a new `version`.

## Shared Fields

| Field | Required | Type | Notes |
|---|---:|---|---|
| `version` | yes | `1` | Runtime trace schema version. |
| `event` | yes | string | One of the event names below. |
| `run_id` | yes | string | Stable ID for one execution attempt. Prefer UUID/ULID. |
| `timestamp` | yes | ISO string | Event wall-clock time in UTC. |
| `script_path` | yes | string | Path or logical URI of the script being traced. Can be remote. |
| `script_hash` | recommended | string | Hash of the script content used to build the static snapshot. |
| `language` | recommended | string | `typescript`, `python`, `sql`, or an adapter-specific value. |
| `node_id` | event-specific | string | Static Script Flow node ID. Required for node-level events. |
| `span_id` | event-specific | string | ID for one timed span. Required for span events. |
| `parent_span_id` | no | string | Parent span if nested. |
| `machine_id` | no | string | Stable machine/agent label. Avoid secrets and hostnames if privacy matters. |
| `process_id` | no | number/string | OS PID, container PID, worker ID, or remote process ID. |
| `entity_id` | no | string | Stable Domain Graph entity ID, usually `relative/path.ext#symbol`. |
| `duration_ms` | event-specific | number | Wall-clock duration in milliseconds. |
| `status` | event-specific | string | `ok`, `error`, `cancelled`, `timeout`, or `running`. |
| `counters` | no | object | Numeric aggregates such as loop counts. |
| `metadata` | no | object | Adapter-specific data. Must be JSON-serializable and bounded. |

### Naming

The wire format uses `snake_case` because it is easier to emit from Python, SQL proxies, shell wrappers, and JS runtimes without adapter-specific conversion.

### Runtime Evidence vs Static Hints

Script Flow static hints are analyzer observations, such as:

- missing `else`
- missing explicit `return`
- empty loop body
- broad `except`
- unused CTE

Runtime trace events are evidence from an execution, such as:

- span actually ran
- span failed with an exception
- loop ran 120000 iterations
- external database call took 900 ms
- script ended with status `timeout`

Readers should display these as different layers. A static warning is a possibility; runtime evidence is something that happened during a run.

## Events

### `run_start`

Marks the beginning of a script execution.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`

Recommended fields:

- `script_hash`
- `language`
- `machine_id`
- `process_id`
- `metadata.invocation`

Example:

```json
{"version":1,"event":"run_start","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:00.000Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","script_hash":"sha1:9f4c...","language":"typescript","machine_id":"local-dev","process_id":18420,"metadata":{"invocation":"pnpm tsx sample.ts","cwd":"C:/dev/Cortex"}}
```

### `run_end`

Marks the end of a script execution.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`
- `status`
- `duration_ms`

Example:

```json
{"version":1,"event":"run_end","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:03.420Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","status":"ok","duration_ms":3420,"counters":{"spans":12,"errors":0,"external_calls":2}}
```

### `span_start`

Marks the start of a timed node execution. Use it for functions, branches, loops, SQL statements, try/catch regions, and other node-level work.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`
- `node_id`
- `span_id`

Example:

```json
{"version":1,"event":"span_start","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:00.120Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","entity_id":"apps/vscode-extension/fixtures/script-flow/sample.ts#loadOrders","node_id":"sf1:fn:loadorders:l12c1","span_id":"span-0001","metadata":{"label":"loadOrders"}}
```

### `span_end`

Marks a successful, cancelled, timed-out, or failed completion of a span. If the failure includes error details, emit `span_error` as well.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`
- `node_id`
- `span_id`
- `duration_ms`
- `status`

Example:

```json
{"version":1,"event":"span_end","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:00.980Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","entity_id":"apps/vscode-extension/fixtures/script-flow/sample.ts#loadOrders","node_id":"sf1:fn:loadorders:l12c1","span_id":"span-0001","duration_ms":860,"status":"ok","counters":{"calls":3}}
```

### `span_error`

Captures error evidence for a node. This is separate from static error/warning messages in the analyzer.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`
- `node_id`
- `span_id`
- `status`
- `metadata.error`

Example:

```json
{"version":1,"event":"span_error","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:01.240Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","node_id":"tryCatch:catch:45:3","span_id":"span-0004","status":"error","metadata":{"error":{"type":"TimeoutError","message":"database request exceeded 1000ms"},"handled":true}}
```

### `loop_sample`

Aggregates loop work without logging every iteration.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`
- `node_id`
- `counters.iterations`
- `counters.sample_count`
- `counters.total_ms`
- `counters.avg_ms`
- `counters.max_ms`

Example:

```json
{"version":1,"event":"loop_sample","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:02.000Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","node_id":"loop:for-of:28:3","span_id":"span-0002","counters":{"iterations":5000,"sample_count":5,"total_ms":1380,"avg_ms":0.276,"max_ms":14.8},"metadata":{"flush_reason":"iteration_threshold"}}
```

### `external_call`

Captures runtime dependencies outside the current script: HTTP, DB, filesystem, queues, child processes, or another script.

Required fields:

- `version`
- `event`
- `run_id`
- `timestamp`
- `script_path`
- `duration_ms`
- `status`
- `metadata.target_kind`
- `metadata.target`

Recommended fields:

- `node_id`
- `span_id`
- `parent_span_id`

Example:

```json
{"version":1,"event":"external_call","run_id":"01JZ8E5S3R7Q7VM96E6R4H9PNV","timestamp":"2026-06-19T17:00:00.710Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","node_id":"call:fetchOrders:18:5","span_id":"span-0003","parent_span_id":"span-0001","duration_ms":412,"status":"ok","metadata":{"target_kind":"http","target":"GET https://api.example.test/orders","status_code":200}}
```

## Loop Aggregation Rules

Do not emit one event per iteration in large loops.

Writers should maintain in-memory counters per `run_id + node_id + span_id`:

- `iterations`: total loop iterations observed.
- `sample_count`: number of samples included in the aggregate.
- `total_ms`: total measured loop time.
- `avg_ms`: `total_ms / iterations` when every iteration is measured, or an adapter estimate when sampling.
- `max_ms`: slowest observed iteration or flush window.

Flush a `loop_sample` when any threshold is reached:

- every 1000 iterations,
- every 2 seconds,
- on loop exit,
- on run end,
- before process shutdown if possible.

Adapters may sample less frequently for very hot loops. If the adapter does not measure every iteration, set `metadata.sampling`:

```json
{"mode":"interval","every_n_iterations":100}
```

## Remote Scripts

Remote or multi-machine executions are allowed. In that case:

- `script_path` can be a logical URI, such as `ssh://worker-a/jobs/import.py` or `container://billing-worker/app/job.py`.
- `machine_id` should identify the worker without leaking secrets.
- `process_id` can be a container PID, job ID, or scheduler task ID.
- `metadata.workspace_root` can point to the local source root used for static analysis.
- `metadata.remote_path` can preserve the real path when it differs from the local path.

Example:

```json
{"version":1,"event":"run_start","run_id":"01JZ8E9JSS0R76BQ5V1FS5NPN2","timestamp":"2026-06-19T17:10:00.000Z","script_path":"container://etl-worker/app/jobs/rebuild_indexes.py","language":"python","machine_id":"etl-worker-03","process_id":"k8s-job-8841","metadata":{"workspace_root":"C:/dev/DataOps","remote_path":"/app/jobs/rebuild_indexes.py"}}
```

For the current file-watch MVP, remote scripts do not connect directly to the
extension. They should write the trace into a local, mounted, synced, or copied
JSONL path that matches one of the companion file names above. Direct HTTP or
WebSocket ingestion is intentionally deferred so the extension does not expose a
listening network service by default.

## Runtime Node Mapping

`node_id` must match the static Script Flow node ID for the same script snapshot. Current analyzer IDs use the `sf1` strategy:

```text
sf1:<kind-prefix>:<symbol-or-label-slug>:l<startLine>c<startCol>[:n<localOrdinal>]
```

Examples:

- `sf1:fn:loadorders:l12c1`
- `sf1:loop:for-const-order-of-orders:l18c3`
- `sf1:cte:active-users:l4c6`

`entity_id` is separate and targets the wider Domain Graph. Use a stable ID that the static domain indexer and the runtime tracer can both emit:

```text
<workspace-relative-path>
<workspace-relative-path>#<symbol>
```

Examples:

- `apps/jobs/rebuildOrders.py`
- `apps/jobs/rebuildOrders.py#main`
- `apps/orders/orderService.ts#loadOrders`
- `db/reporting.sql#active_users`

When an event belongs to a loop, branch, catch block, SQL statement, or other fine-grained Script Flow node inside a function, keep `node_id` specific and set `entity_id` to the nearest stable domain entity, usually the enclosing function or file. This lets Script Flow paint exact runtime badges while Domain Graph paints the higher-level route.

The `script_hash` field remains separate from `node_id`. Do not include content hash inside `node_id`, because a tiny unrelated edit would churn every runtime mapping. Readers should compare `script_hash` against the current `ScriptFlowSnapshot.metadata.hash` when available and show stale/unmatched evidence when hashes diverge.

Limitations:

- Renaming a function, CTE, table alias, or call label can change the ID.
- Moving a node changes the `l<line>c<column>` range component.
- Generated SQL and anonymous expressions may fall back to a generic label plus local ordinal.
- Large refactors should be treated as a new static snapshot, even if some old IDs still match.

## Opt-In Instrumentation Helpers

Script Flow Live does not execute scripts from the VS Code extension. A script
that wants runtime evidence imports or copies a small helper and writes the JSONL
trace itself while running in its normal process, shell, job runner, container,
or remote worker.

Current local snippets:

- TypeScript: `apps/vscode-extension/src/scriptFlow/instrumentation/typescriptTrace.ts`
- Python: `apps/vscode-extension/fixtures/script-flow/instrumentation/scriptflow_trace.py`
- TS example: `apps/vscode-extension/fixtures/script-flow/instrumented-sample.ts`
- Python example: `apps/vscode-extension/fixtures/script-flow/instrumented_sample.py`

Minimal TypeScript shape:

```ts
const tracer = createScriptFlowTracer({ scriptPath: fileURLToPath(import.meta.url) });
tracer.startRun();
try {
  await tracer.span({ nodeId: "sf1:fn:work:l10c1" }, async () => {
    // measured work
  });
  tracer.endRun("ok");
} catch (error) {
  tracer.endRun("error", { errors: 1 });
  throw error;
}
```

Minimal Python shape:

```python
tracer = ScriptFlowTracer(script_path=__file__)
tracer.start_run()
try:
    with tracer.span("sf1:fn:work:l10c1"):
        # measured work
        pass
    tracer.end_run("ok")
except Exception:
    tracer.end_run("error", {"errors": 1})
    raise
```

Mapping workflow:

1. Instrument the script where you want spans.
2. Open the final instrumented script in Script Flow.
3. Copy the current `node_id` from the node you want to measure.
4. Pass that ID explicitly to `span(...)`, `loop_aggregator(...)`, or `emit_loop_sample(...)`.
5. Run the script normally outside the extension.
6. Refresh Script Flow; local companion traces are discovered next to the script.

The helpers default to `<script-path>.scriptflow.trace.jsonl`, which matches the
extension's local discovery rule. Use `tracePath` / `trace_path` to write
somewhere else, then move or symlink the result next to the analyzed script.

### Instrumentation Overhead

The helpers are intentionally synchronous and append one JSONL line per event.
This keeps them simple and reliable for local use, but it is not free:

- Do not wrap every tiny expression in a span.
- Prefer one span per function, query, branch, try/catch, or meaningful I/O boundary.
- Keep `metadata` bounded and do not include request bodies, secrets, or full raw SQL with sensitive literals.
- Use loop aggregation for hot loops instead of writing per-iteration events.
- For very large jobs, emit `loop_sample` every N iterations or every few seconds.

The helpers are prototypes, not auto-instrumentation. They are safe to copy into
another repo because they depend only on Node/Python standard libraries.

For manual QA, fixture coverage, and the exact verification commands, see
[`script-flow-live-qa.md`](./script-flow-live-qa.md).

## TypeScript Example

```jsonl
{"version":1,"event":"run_start","run_id":"ts-run-1","timestamp":"2026-06-19T17:20:00.000Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","script_hash":"sha1:9f4c","language":"typescript"}
{"version":1,"event":"span_start","run_id":"ts-run-1","timestamp":"2026-06-19T17:20:00.010Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","node_id":"function:main:6:1","span_id":"s1"}
{"version":1,"event":"external_call","run_id":"ts-run-1","timestamp":"2026-06-19T17:20:00.050Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","node_id":"call:fetch:8:9","span_id":"s2","parent_span_id":"s1","duration_ms":120,"status":"ok","metadata":{"target_kind":"http","target":"GET https://api.example.test/health","status_code":200}}
{"version":1,"event":"span_end","run_id":"ts-run-1","timestamp":"2026-06-19T17:20:00.190Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","node_id":"function:main:6:1","span_id":"s1","duration_ms":180,"status":"ok"}
{"version":1,"event":"run_end","run_id":"ts-run-1","timestamp":"2026-06-19T17:20:00.200Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.ts","duration_ms":200,"status":"ok"}
```

## Python Example

```jsonl
{"version":1,"event":"run_start","run_id":"py-run-1","timestamp":"2026-06-19T17:30:00.000Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.py","language":"python","process_id":9211}
{"version":1,"event":"span_start","run_id":"py-run-1","timestamp":"2026-06-19T17:30:00.020Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.py","node_id":"function:sync_accounts:10:1","span_id":"p1"}
{"version":1,"event":"loop_sample","run_id":"py-run-1","timestamp":"2026-06-19T17:30:02.030Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.py","node_id":"loop:for:12:5","span_id":"p2","parent_span_id":"p1","counters":{"iterations":1000,"sample_count":10,"total_ms":1780,"avg_ms":1.78,"max_ms":22.4},"metadata":{"flush_reason":"time_threshold","sampling":{"mode":"interval","every_n_iterations":100}}}
{"version":1,"event":"span_error","run_id":"py-run-1","timestamp":"2026-06-19T17:30:02.200Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.py","node_id":"tryCatch:except:20:5","span_id":"p3","status":"error","metadata":{"error":{"type":"ValueError","message":"invalid account id"},"handled":true}}
{"version":1,"event":"run_end","run_id":"py-run-1","timestamp":"2026-06-19T17:30:02.260Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.py","duration_ms":2260,"status":"error","counters":{"errors":1}}
```

## SQL / DB Proxy Example

SQL tracing usually happens through a DB proxy, query wrapper, migration runner, or application adapter. `node_id` should target the static SQL node when the query maps to a known script; otherwise keep it out and rely on `metadata.query_hash`.

```jsonl
{"version":1,"event":"run_start","run_id":"sql-run-1","timestamp":"2026-06-19T17:40:00.000Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.sql","language":"sql","metadata":{"adapter":"db-proxy","database":"postgres"}}
{"version":1,"event":"span_start","run_id":"sql-run-1","timestamp":"2026-06-19T17:40:00.005Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.sql","node_id":"select:main:8:1","span_id":"q1"}
{"version":1,"event":"external_call","run_id":"sql-run-1","timestamp":"2026-06-19T17:40:00.006Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.sql","node_id":"select:main:8:1","span_id":"q1","duration_ms":742,"status":"ok","metadata":{"target_kind":"db","target":"postgres://analytics/orders","rows":18420,"query_hash":"sha256:4b7e..."}}
{"version":1,"event":"span_end","run_id":"sql-run-1","timestamp":"2026-06-19T17:40:00.750Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.sql","node_id":"select:main:8:1","span_id":"q1","duration_ms":745,"status":"ok","counters":{"rows":18420}}
{"version":1,"event":"run_end","run_id":"sql-run-1","timestamp":"2026-06-19T17:40:00.760Z","script_path":"C:/dev/Cortex/apps/vscode-extension/fixtures/script-flow/sample.sql","duration_ms":760,"status":"ok"}
```

## Reader Expectations

A reader should aggregate by:

1. `run_id`
2. `script_path`
3. `node_id`
4. `span_id`

For each node, the future overlay can derive:

- `hit_count`
- `total_ms`
- `avg_ms`
- `max_ms`
- `last_status`
- `error_count`
- `loop_iterations`
- `external_call_count`
- `slowest_external_call`

If a trace references a `node_id` that does not exist in the current static snapshot, the reader should keep the event in an "unmatched runtime evidence" bucket instead of dropping it. This is expected after edits, renames, generated SQL, or remote scripts with path differences.

The local parser returns:

- `runs`: all valid runs found in the JSONL content.
- `latestRunId`: the most recent run by `run_end`, last event, or `run_start`.
- `selectedRun`: the requested run when a `run_id` filter is provided, otherwise the latest run.
- per-run `events`: replayable `span_start`, `span_end`, and `span_error` events ordered by timestamp and source order.
- `warnings`: invalid JSON, unsupported versions, unsupported event names, and missing required fields.
- per-node aggregates: `count`, `totalMs`, `avgMs`, `maxMs`, `lastStatus`, `errorCount`, `activeSpans`, `loop`, and `externalCalls`.

Invalid lines never abort parsing. They are skipped and reported as warnings so long traces can still produce useful overlay data.

## Overlay UX

When a trace is available, Script Flow shows a runtime evidence layer over the static graph:

- Node badges: `active`, `calls`, `avg`, `max`, `err`, and `iter`.
- Edge accents: runtime-colored edges for nodes with trace data.
- Summary pill: selected run status, traced node count, active spans, and errors.
- Run selector: choose any parsed run and inspect `run_id`, `started_at`, `machine_id`, status, and total duration.
- Replay controls: play/pause/reset/scrub through `span_start`, `span_end`, and `span_error` events.
- Replay highlight: the current event highlights its node and nearby edges; error events use the runtime error tone.
- Live status: `waiting`, `watching`, `updated`, or `error` for the local file watcher.
- Legend: explicitly labels the layer as runtime evidence.

Runtime evidence is visually separate from static hints and analyzer warnings. Static gaps still use the warning/error message language; runtime cost uses cyan/blue for low/medium evidence, amber for hot nodes, and red for runtime errors.

Incomplete traces are valid input. A run without `run_end` can still show active spans and replayable events, while invalid JSONL lines are skipped into parser warnings instead of breaking the UI.

## Privacy and Size Limits

Writers should avoid:

- secrets in `metadata`
- raw SQL with sensitive literals
- request/response bodies
- per-iteration loop logs
- unbounded stack traces

Recommended limits:

- one JSONL line below 64 KB
- `metadata` below 16 KB
- stack traces trimmed to the first relevant frames
- query text replaced with `query_hash` unless the script itself is already local source

## Future Compatibility Notes

- T02 should define how analyzer `node_id` values become stable enough for this contract.
- T03 should parse this JSONL format into per-run and per-node aggregates.
- UI overlays must label this layer as runtime evidence, not static analysis.
