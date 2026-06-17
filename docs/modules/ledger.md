# Cortex Ledger

Captura de **sesiones de agentes IA ejecutando tareas** sobre el repo: qué agente trabajó, qué tasks tocó, qué archivos cambió, qué commits dejó y, si el runtime lo sabe, cuántos tokens usó. Una fila por sesión, persistida en MongoDB y consultable desde el panel Ledger o vía MCP.

El agente se reporta a sí mismo al cerrar (vía MCP `record_run` o hook Stop de Claude Code) — Ledger no intercepta llamadas API. Eso lo hace independiente del provider y del SDK.

## Propósito

Hoy no hay forma de responder preguntas básicas como:

- ¿Cuántas tasks cerró Big Pickle esta semana?
- ¿En qué archivos trabaja más Codex vs Claude Code?
- ¿Qué agente cuesta menos por task completada?
- ¿Cuál fue el último run sobre `apps/vscode-extension/`?

`tasks.agent` apunta a quién la hizo, pero falta la unidad **sesión**: el bloque temporal donde un agente atacó N tasks, dejó M commits, gastó X tokens. Ledger introduce esa unidad.

Es el módulo de **observabilidad de agentes**: se mira para entender qué pasó y para alimentar decisiones futuras (qué agente asignar, qué tasks le caen mejor).

## Pre-requisitos (schema bumps)

Ledger no es solo una collection nueva. Requiere tocar `tasks` / `action_plans` / agregar `ai_agents` primero. Sin estos cambios, los runs no se pueden anclar a nada tipado.

| Cambio                                    | Dónde                               | Por qué                                                       |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| Extender enum `TaskAgent`                 | `packages/core/src/types.ts`        | Agregar `codex`, `big-pickle`, `claude-code`, `copilot`, etc. |
| `tasks.started_at` / `tasks.completed_at` | `packages/core/src/types.ts`        | Sin ellos no hay duración por task ni latencia agente→cierre. |
| `action_plans.author` / `assigned_agent`  | `packages/core/src/types.ts`        | Atribución a nivel plan (humano que pidió, agente líder).     |
| Collection `ai_agents` (catálogo)         | `nostromo_cortex.ai_agents` (nueva) | Selects definidos en UI, iconos, model_family, no free-text.  |

`tasks.started_at` se setea cuando una task pasa a `IN_PROGRESS` (por ejemplo, vía `/plan next` o la transición manual en UI). `tasks.completed_at` se setea cuando pasa a `DONE` o `FAILED`. Ambos son opcionales; tasks históricas sin estos campos siguen siendo válidas. El backfill de tasks legacy queda fuera del MVP inicial.

El catálogo `ai_agents` es config-driven en MVP: 5 seeds (`codex`, `big-pickle`, `claude-code`, `copilot`, `gemini`) con `{slug, display_name, icon_path, model_family, vendor, active}`. Iconos SVG en `apps/vscode-extension/media/icons/` (varios ya existen: `codex.svg`, `claude.svg`, `copilot.svg`, `gemini.svg`).

## Modelo de datos

Collection Mongo `agent_runs` en `nostromo_cortex`. Una fila por sesión. Se muta con `update-many` + `$set`, nunca delete+insert ([[mongo-updates-not-delete-insert]]).

| Campo           | Tipo                                 | Notas                                                        |
| --------------- | ------------------------------------ | ------------------------------------------------------------ |
| `id`            | string (uuid)                        | PK estable del run.                                          |
| `agent_slug`    | string                               | FK a `ai_agents.slug` (`codex` / `big-pickle` / ...).        |
| `model_id`      | string?                              | Modelo concreto (`claude-opus-4-7`, `gpt-5-codex`).          |
| `started_at`    | string ISO                           | Cuándo arrancó la sesión.                                    |
| `ended_at`      | string ISO?                          | `null` mientras `status === "running"`.                      |
| `duration_ms`   | number?                              | Calculado desde `started_at` / `ended_at`.                    |
| `task_codes`    | string[]                             | Tasks tocadas en la sesión (cero o más).                     |
| `plan_codes`    | string[]                             | Plans derivados de las tasks o reportados explícitamente.     |
| `files_touched` | string[]                             | Rutas relativas modificadas en la sesión.                    |
| `commits`       | string[]                             | Hashes corridos por el agente.                               |
| `tokens_in`     | number?                              | Reportado por el agente; opcional.                           |
| `tokens_out`    | number?                              | Idem.                                                        |
| `status`        | `running` \| `completed` \| `failed` | Estado terminal de la sesión.                                |
| `notes`         | string?                              | Texto libre, idealmente 1–2 líneas: "cerró 4 tasks de PREP". |
| `created_at`    | string ISO                           | Para histórico.                                              |
| `updated_at`    | string ISO                           | Última mutación.                                             |

Índices:

- `{ agent_slug: 1, started_at: -1 }` para "últimos runs de Big Pickle".
- `{ started_at: -1 }` para feed cronológico.
- `{ task_codes: 1 }` para "qué run cerró esta task".

## Captura

Un run se crea cuando arranca la sesión y se cierra cuando termina. Dos vías, ambas livianas:

1. **MCP tool `task_start`** (`apps/mcp-server`): cuando una IA toma una task, llama con `{code, agent_slug, model_id?}`. El server setea `tasks.status = IN_PROGRESS`, `tasks.agent`, `tasks.started_at`, recalcula el plan y crea/actualiza un run `running`.
2. **MCP tool `task_complete`** (`apps/mcp-server`): cuando termina, llama con `{code, agent_slug, run_id?, files, commits, tokens_in?, tokens_out?, notes, status}`. El server setea `tasks.status = DONE|FAILED`, `tasks.completed_at`, recalcula/cierra el plan si corresponde y registra/cierra el run en Ledger.
3. **MCP tool `record_run`** (`apps/mcp-server`): compatibilidad y reportes manuales. Acepta `{id?, agent_slug, model_id?, started_at?, ended_at?, task_codes, plan_codes?, tokens_in?, tokens_out?, files, commits, notes, status}` y calcula `duration_ms` cuando puede.
4. **Extensión VS Code `saveTask`**: cuando una task cambia de cualquier estado a `DONE`, crea automáticamente un run simple `completed` con `agent_slug`, `task_codes: [code]`, `plan_codes`, `started_at/ended_at` y arrays vacíos para `files_touched`/`commits`. Antes de insertar busca `agent_runs` por `task_codes: code`; si existe, lo actualiza. Regla de producto: 1 task cerrada manualmente = máximo 1 run automático.
5. **Hook Stop de Claude Code** (`~/.claude/settings.json`): un script local invoca el mismo contrato al cerrar Claude Code. Sirve para self-tracking del propio Claude.

Ledger **no** intercepta llamadas API, no parsea logs, no lee SQLite de telemetry. El agente es responsable de reportarse — y si no se reporta, no aparece. Trade-off consciente: simplicidad sobre cobertura.

## MCP tools

Para que cualquier agente IA pueda consultar el histórico antes de empezar:

| Tool                                 | Devuelve                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `task_start(code, agent_slug, ...)`   | Marca una task `IN_PROGRESS`, asigna agente, pone `started_at` y crea run.  |
| `task_complete(code, agent_slug, ...)`| Marca una task `DONE`/`FAILED`, pone `completed_at` y cierra run.           |
| `record_run(...)`                    | Inserta o cierra un run manual/compatibilidad.                              |
| `query_runs(agent?, since?, limit?)` | Lista de runs filtrada.                                                     |
| `agent_stats(agent_slug)`            | `{total_runs, total_tasks_done, avg_duration_h, agg_tokens, success_rate}`. |

Ranking entre agentes (qué conviene para esta task) **no** está en MVP; se evalúa cuando haya datos.

## Panel webview

Comando `cortex.openLedger`. Webview React, reusa el shape de los paneles Logs/Notes para minimizar surface nueva.

Contenido:

- **Tabla de runs**: ícono del agente, `started_at`, duración, tasks tocadas (chips), `tokens_in/out`, status. Filtros por agente y por rango de fechas.
- **Chart simple**: tasks/día por agente (barras apiladas). Una sola gráfica, sin drill-down.
- **Logo** `ledger-activity.svg` en activity bar.

Selects de agente en task editor y plan editor (PREP-03 alimenta el dropdown desde `ai_agents`): adiós al free-text en `tasks.agent` / `action_plans.assigned_agent`.

## MVP

Lo que entra (alineado al plan `CORTEX-LEDGER`):

1. **PREP** (6 tasks · ~4h): enum `TaskAgent` extendido, `author`/`assigned_agent` en plans, collection `ai_agents` + seeds + iconos, `started_at`/`completed_at` en tasks, backfill best-effort de tasks/plans históricos.
2. **LEDGER** (5 tasks · ~6h): schema `agent_runs` + índices + tests, MCP `record_run` + hook doc, panel Ledger (tabla + chart), MCP `query_runs` + `agent_stats`, select de agente en editores.

Fuera del MVP: ranking de agentes, recomendaciones, drill-down por run, export CSV, auto-extracción de tokens/costos.

## Riesgos

| Riesgo                                    | Mitigación                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Agentes que no se reportan → datos huecos | Hook Stop de Claude Code para self-tracking; tabla muestra "untracked".  |
| Tokens reportados a ojo                   | Tokens son best-effort; si la IA no los sabe, se omiten.                 |
| Schema bumps rompen tasks históricas      | Todos los campos nuevos son opcionales; backfill por scripts dedicados.  |
| Tabla de runs crece rápido                | Índice por `started_at`; el panel pagina y filtra por defecto a 30 días. |

## Frase corta

```txt
Ledger captura una fila por sesión de agente IA: qué tocó, cuánto costó y en qué terminó — para mirar y decidir.
```

## Relacionados

- Plan de implementación: `CORTEX-LEDGER` (split de `CORTEX-LEDGER-REM` archivado el 2026-06-09).
- Contraparte parqueada: [[rem]] (`docs/future/rem.md`) — orquestador de contexto, fuera de scope hasta nuevo aviso.
