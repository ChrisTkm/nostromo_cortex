# Cortex Log Contract v2

## Overview

Python producers emit one JSON object per log event to a `.jsonl` file.
Cortex reads these files from a local directory (`cortex.logsSources`) and
renders them in the Logs panel. Cortex never stores logs — it is a
read-only viewer.

---

## Canonical Event

### Core (required)

| field | type | description |
|---|---|---|
| `timestamp` | string (ISO 8601) | UTC datetime of the event |
| `level` | string | `INFO` / `WARN` / `ERROR` |
| `process` | string | logical process name, e.g. `cargas_sii` |
| `event` | string | `BEGIN` / `STEP` / `INFO` / `WARN` / `ERROR` / `END` |
| `message` | string | human-readable description |

Minimal valid event:

```json
{"timestamp": "2026-06-14T10:00:00Z", "level": "INFO", "process": "cargas_sii", "event": "INFO", "message": "Starting extraction"}
```

### Optional — execution tracking

| field | type | description |
|---|---|---|
| `execution_id` | string | UUID that groups events belonging to the same run |
| `duration_ms` | number | elapsed wall-clock ms (typically set on the END event) |

### Facets — data movement

| field | type | description |
|---|---|---|
| `source` | string | origin system, e.g. `sap`, `oracle`, `api:xero` |
| `target` | string | destination system, e.g. `mongo`, `bigquery`, `csv` |
| `operation` | string | verb, e.g. `extract`, `transform`, `load` |
| `rows_read` | number | rows read in this operation |
| `rows_inserted` | number | rows inserted |
| `rows_updated` | number | rows updated |
| `rows_deleted` | number | rows deleted |
| `entity` | string | logical entity, e.g. `impuesto_2cat`, `clients` |

### Context — environment

| field | type | description |
|---|---|---|
| `host` | string | machine name |
| `project` | string | project or repository name |
| `script` | string | script filename |
| `env` | string | deployment environment, e.g. `prod`, `staging` |

### Open bag

Any extra fields not listed above are preserved in the details section
and displayed in the Logs detail panel. Use them for domain-specific
metadata (e.g. `nemo`, `fondo`, `periodo`, `file`, `schema`, `table`).

---

## Contract Levels

| level | description | required fields |
|---|---|---|
| 1 — Appear in history | the event shows up in the historical view by process | `timestamp`, `level`, `process`, `event`, `message` |
| 2 — Group as a run | events are grouped into a single execution | `execution_id` (same value on BEGIN and END) |
| 3 — Measure duration | duration is computed and displayed | `BEGIN` + `END` events, or `duration_ms` on END |
| 4 — Audit data movement | rows affected and data lineage are shown | `source`, `target`, `operation`, `rows_*` facets |

A single process can operate at different levels for different runs.

---

## Event Vocabulary

| event | meaning | expected usage |
|---|---|---|
| `BEGIN` | start of a logical unit of work | first event of a run |
| `STEP` | intermediate progress | one or more between BEGIN and END |
| `INFO` | informational message | standalone or between steps |
| `WARN` | warning, non-fatal | non-blocking issue |
| `ERROR` | error, may be fatal | problem that requires attention |
| `END` | end of a logical unit of work | last event of a run (may carry `duration_ms`) |

Use `BEGIN`/`END` to delimit runs. `STEP`/`INFO` inside a run are
displayed on the run timeline. `START` is **not** recognised — use `BEGIN`.

---

## Legacy Synonyms

The normalizer accepts these legacy field names and maps them silently:

| legacy | canonical |
|---|---|
| `severity` | `level` |
| `status` | `level` |
| `proc` | `process` |
| `job` | `process` |
| `msg` | `message` |
| `created_at` | `timestamp` |

Older logs that use these field names continue to work without changes.

---

## Good Examples

### Level 1 — simple INFO event

```json
{"timestamp": "2026-06-14T08:00:00Z", "level": "INFO", "process": "sii_loader", "event": "INFO", "message": "Configuration loaded"}
```

### Levels 2+3 — run with BEGIN/END and duration

```json
{"timestamp": "2026-06-14T10:00:00Z", "level": "INFO", "process": "cargas_sii", "event": "BEGIN", "execution_id": "a1b2c3d4", "message": "Starting carga"}
{"timestamp": "2026-06-14T10:05:00Z", "level": "INFO", "process": "cargas_sii", "event": "STEP", "execution_id": "a1b2c3d4", "message": "Processing batch 1"}
{"timestamp": "2026-06-14T10:10:00Z", "level": "INFO", "process": "cargas_sii", "event": "END", "execution_id": "a1b2c3d4", "duration_ms": 600000, "message": "Carga completed"}
```

### Levels 2+3+4 — full audit trail

```json
{"timestamp": "2026-06-14T11:00:00Z", "level": "INFO", "process": "cargas_sii", "event": "BEGIN", "execution_id": "e5f6g7h8", "source": "sap", "target": "mongo", "operation": "extract", "entity": "impuesto_2cat", "message": "Begin extract"}
{"timestamp": "2026-06-14T11:02:00Z", "level": "INFO", "process": "cargas_sii", "event": "STEP", "execution_id": "e5f6g7h8", "rows_read": 5000, "rows_inserted": 5000, "message": "Extracted 5000 rows"}
{"timestamp": "2026-06-14T11:05:00Z", "level": "INFO", "process": "cargas_sii", "event": "END", "execution_id": "e5f6g7h8", "duration_ms": 300000, "rows_read": 5000, "rows_inserted": 5000, "message": "Extract done"}
```

---

## Bad Examples

### Missing required fields

```json
{"process": "loader", "message": "done"}
```

Problem: no `timestamp`, no `level`, no `event`. This event will still
appear (timestamp falls back to epoch, level defaults to INFO) but will
be essentially invisible in the timeline.

### START instead of BEGIN

```json
{"timestamp": "2026-06-14T12:00:00Z", "level": "INFO", "process": "loader", "event": "START", "message": "start"}
```

Problem: `START` is not a recognised vocabulary event. This event is
treated as generic INFO, so the run will appear as `abierta` (no END)
and no duration is measured.

### Duration on wrong event

```json
{"timestamp": "2026-06-14T12:00:00Z", "level": "INFO", "process": "loader", "event": "BEGIN", "duration_ms": 300000, "message": "start"}
{"timestamp": "2026-06-14T12:05:00Z", "level": "INFO", "process": "loader", "event": "END", "message": "done"}
```

Problem: `duration_ms` on BEGIN is ignored when END also exists.
Always set `duration_ms` on the END event. Without it, Cortex falls
back to `endedAt - startedAt` (5 min = 300000 ms — correct in this
case but fragile).

### Rows outside facets

```json
{"timestamp": "2026-06-14T13:00:00Z", "level": "INFO", "process": "loader", "event": "STEP", "message": "inserted 100 rows", "inserted": 100}
```

Problem: `inserted` is not a recognised facet field. Use `rows_inserted`.
The unknown field goes into the detail bag, not into the data movement
section.
