# Cortex

Monorepo TypeScript con `pnpm` para gestión visual de tareas dependientes en VS Code, exposición MCP para agentes/skills y telemetría local detallada.

## Panels & keyboard shortcuts

La extensión VS Code expone cuatro superficies. Todas viven sobre el mismo
`SharedMongoClient` (sin handshakes por operación).

| Superficie | Comando | Keybinding |
|------------|---------|------------|
| Task Navigator (sidebar) | `cortex.openTasks` |  |
| PERT Graph | `cortex.openGraph` |  |
| Notes | `cortex.openNotes`  `cortex.newNote` | `Ctrl+Alt+Shift+N`  `Ctrl+Alt+N` |
| Logs | `cortex.openLogs` |  |
| Panel switcher | `cortex.switchPanel` |  |

Desde cualquier panel, `cortex.showOptions` abre un QuickPick con acceso a
Tasks/Graph/Notes/Logs y al resto de filtros.

### Notes

Panel CRUD de notas persistido en la misma instancia Mongo que tareas/planes.

- Campos: `code`, `title`, `body` (markdown), `tags[]`, `taskCode?`, `planCode?`, `pinned`, `createdAt`, `updatedAt`.
- Comandos: `Cortex: Open notes panel`, `Cortex: New note`, `Cortex: Edit note`, `Cortex: Delete note`.
- Config: `cortex.mongoNotesCollection` (default `notes`).
- Índices: `code_unique`, `task_code_idx`, `plan_code_idx`, `updated_at_desc_idx`.

### Logs

Panel read-only que muestra los últimos 500 eventos persistidos en Mongo.

- Config: `cortex.mongoLogsCollection` (default `logs`).
- Índices: `logs_source_timestamp`, `logs_level_timestamp`, `logs_process_timestamp`.

## Componentes

- `apps/vscode-extension` — extensión de VS Code con navegación textual y webview PERT/DAG.
- `apps/mcp-server` — servidor MCP local con tools, resources y prompts sobre tareas y telemetría.
- `packages/core` — dominio compartido: tipos, normalización, grafo, Mongo y seeds.
- `packages/telemetry` — capa reusable de telemetría, pricing versionado, logging y persistencia local.

## Principios de diseño

- MongoDB es la fuente de verdad de tareas.
- El webview nunca habla directo con Mongo.
- La extensión resuelve Mongo en el host y envía snapshots JSON serializados al webview.
- El layout principal del grafo es jerárquico DAG mediante Cytoscape + dagre.
- Telemetría desacoplada del MCP, con backend principal SQLite y fallback JSONL.

## Scripts raíz

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm mongo:up`
- `pnpm seed`
- `pnpm check:cycles`
- `pnpm inspect:snapshot`
- `pnpm inspect:telemetry:runs`
- `pnpm inspect:telemetry:failures`
- `pnpm inspect:cost`

## Entregables incluidos

- ✅ monorepo base completo
- ✅ README de arquitectura
- ✅ README de desarrollo local
- ✅ `.env.example`
- ✅ `.codex/config.toml.example`
- ✅ seeds Mongo con dataset S1/S2/S2.1/S3/S4/S5a/S5b
- ✅ decisiones de diseño justificadas
- ✅ backlog de mejoras
- ✅ checklist de aceptación
- ⚠️ capturas/GIF no incluidas: requieren levantar VS Code y capturarlas manualmente

## Documentación

- [Arquitectura](./README.architecture.md)
- [Desarrollo local](./README.development.md)
