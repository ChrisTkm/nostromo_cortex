![Cortex Banner](assets/banner.svg)

# Cortex

Cortex es un **knowledge cockpit local-first para ingeniería**: combina grafo de ejecución, navegación de documentación, notas, logs y telemetría dentro de VS Code.

En términos de categoría, Cortex vive en la intersección de:

- **Knowledge graph local** para documentación `.md`/`.mdx`, tags, referencias y conceptos.
- **Project intelligence / execution graph** para planes, tareas dependientes, estados, bloqueos y ciclos.
- **Developer operations cockpit** para notas operativas, logs, recordatorios, archivo y telemetría.
- **Documentation architecture tool** para detectar documentos huérfanos, referencias rotas y zonas poco conectadas del conocimiento técnico.

Todo corre cerca del workspace: archivos locales, VS Code, MongoDB local cuando aplica, snapshots en memoria y webviews React Flow.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.x-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007acc?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/api)
[![React Flow](https://img.shields.io/badge/React%20Flow-Webview-ff0072?style=flat-square)](https://reactflow.dev/)

## Qué resuelve

Cortex nace como herramienta interna para no perder de vista el estado de planes complejos y conocimiento técnico disperso: refactors largos, dependencias entre tareas, documentación MD/MDX, notas técnicas y logs operativos.

El problema concreto que ataca: cuando un plan tiene veinte tareas con dependencias cruzadas o una documentación tiene decenas de páginas conectadas por tags y referencias, el listado plano no alcanza. Hace falta un grafo navegable, persistencia entre sesiones y superficies operativas a un atajo de distancia.

## Capacidades principales

- Sidebar con árbol de tareas agrupadas por plan.
- Webview con grafo PERT/DAG basado en React Flow, layout jerárquico vía Dagre.
- Panel de notas con búsqueda en vivo, tags, vínculos opcionales a tarea o plan, pinned notes.
- Panel de logs read-only con eventos agrupados por ejecución, filtro por tag y fallback para logs legacy.
- Panel de archivo para revisar planes archivados y sus tareas congeladas.
- Panel Cortex Brain para elegir una carpeta local y visualizar conexiones entre archivos `.md`/`.mdx`, tags, cuentas y referencias.
- Panel switcher (`Ctrl+Alt+N`, `Ctrl+Alt+Shift+N`) para saltar entre superficies.
- Filtros por plan, proyecto, grupo, tags, estados y severidad — todos persistidos.
- Detección automática de ciclos en dependencias.

## Vista de arquitectura

```text
VS Code Extension Host (Node)
   |
   |-- SharedMongoClient (singleton, pool reutilizado)
   |     |
   |     |-- MongoTaskStore       (tareas + ensureIndexes)
   |     |-- MongoActionPlanStore (planes + ensureIndexes)
   |     |-- MongoNoteStore       (notas + ensureIndexes)
   |     '-- Logs collection       (read-only)
   |
   |-- ExtensionTaskService
   |     '-- buildGraphSnapshot (puro, en memoria)
   |
   '-- Webviews (esbuild, IIFE, minificado en prod)
         |-- PERT Graph    (React + React Flow + Dagre)
         |-- Notes Panel   (React + Markdown editor)
         |-- Logs Panel    (React + listado paginado)
         |-- Archive Panel (React + planes archivados)
         |-- Cortex Brain  (React Flow + scan local .md/.mdx)
         '-- Script Flow   (TS / Python / SQL)
```

El webview nunca habla directo con MongoDB. La extensión resuelve los datos en el host y envía snapshots JSON serializados.

## Decisiones de diseño relevantes

- **Cliente Mongo compartido.** Una sola instancia de `MongoClient` por sesión de extensión, abierta en `activate()` y cerrada en `deactivate()`. Antes se abría y cerraba por cada operación, lo que multiplicaba handshakes en cada refresh.
- **Filter state persistente.** Zoom, pan, plan seleccionado y filtros sobreviven al reinicio de VS Code. Merge estructural defensivo contra workspaceState con shape antiguo.
- **Algoritmos puros sobre datos en memoria.** El topological sort usa Kahn's en O(V+E), evitando ordenamientos dentro del loop. Las cargas masivas usan `bulkWrite` con `ordered: false`.
- **Índices Mongo idempotentes.** `ensureIndexes()` se llama al activar la extensión. Los `code_unique` son partial filter (solo donde el campo existe y es string) para tolerar datos legacy.
- **Bundle minificado en producción.** Cuatro entry points esbuild (extension, graph, notes, logs) con sourcemaps linked. El watch mode no minifica para conservar legibilidad en errores.
- **Logging estructurado.** El extension host no usa `console.log`; toda observabilidad pasa por un logger configurable (pretty / json) con contexto por componente.

## Componentes

- `apps/vscode-extension` — extensión de VS Code con navegación textual, PERT/DAG, Notes, Logs, Archive, Cortex Brain y Script Flow.
- `apps/mcp-server` — servidor MCP local con tools, resources y prompts sobre tareas y telemetría.
- `packages/core` — dominio compartido: tipos, normalización Zod, grafo, Mongo y seeds.
- `packages/telemetry` — capa reusable de telemetría, pricing versionado, logging y persistencia local.

## Stack

- **TypeScript** estricto en todo el monorepo.
- **MongoDB** local como fuente de verdad.
- **React + React Flow + Dagre** para el grafo en webview.
- **esbuild** para bundling (extension host CJS, webviews IIFE).
- **Zod** para normalización defensiva de documentos.
- **Vitest** para tests unitarios.
- **pnpm workspaces** como gestor de paquetes.

## Panels & keyboard shortcuts

La extensión VS Code expone siete superficies. Tasks/Graph/Notes/Logs/Archive viven sobre el mismo `SharedMongoClient` (sin handshakes por operación); Cortex Brain opera sobre carpetas locales sin Mongo.

| Superficie | Comando | Keybinding |
|------------|---------|------------|
| Task Navigator (sidebar) | `cortex.openTasks` |  |
| PERT Graph | `cortex.openGraph` |  |
| Notes | `cortex.openNotes` / `cortex.newNote` | `Ctrl+Alt+Shift+N` / `Ctrl+Alt+N` |
| Logs | `cortex.openLogs` |  |
| Archive | `cortex.openArchive` / `cortex.archivePlan` |  |
| Cortex Brain | `cortex.openBrain` (`cortex.openMdxGraph` alias) |  |
| Script Flow | `cortex.openScriptFlow` / `cortex.openScriptFlowForSelection` |  |
| Panel switcher | `cortex.switchPanel` |  |

Desde cualquier panel, `cortex.showOptions` abre un QuickPick con acceso a Tasks/Graph/Notes/Logs/Archive/Cortex Brain y al resto de filtros.

## v0.1.5

Release enfocada en cerrar la operativa diaria de la extensión: archivo de planes, logs más navegables, PERT más legible y ajustes de seguridad del webview.

- **Archive panel**: nueva superficie `Cortex: Open Archive` para explorar planes archivados y sus tareas. Los planes `done` se pueden archivar desde el navigator con `cortex.archivePlan`; el destino se configura con `cortex.archivePath` y por defecto cae en `~/cortex-archive`.
- **Logs por ejecución**: el panel Logs agrupa eventos por `execution_id`, mantiene los documentos legacy en una sección `ungrouped` y agrega filtro por `tag`. El contrato esperado para productores Python queda documentado en `docs/log-contract.md`.
- **PERT graph polish**: warnings visibles para datos incompletos o inconsistentes, banner de plan más claro, espaciado ajustado y layout menos propenso a solapamientos.
- **Security hardening**: la Mongo URL se gestiona con `Cortex: Set Mongo URL` en VS Code SecretStorage; la setting `cortex.mongoUrl` queda como compatibilidad deprecada.
- **Notes panel**: corrección de scroll para que el editor y el listado mantengan una experiencia estable en sesiones largas.
- **Cortex Brain**: nuevo panel liviano para elegir una carpeta local, escanear `.md`/`.mdx` y renderizar relaciones por links, tags, rutas y cuentas contables sin depender de Mongo.
- **Build/webviews**: se agrega bundle dedicado para Archive y se actualizan assets/iconos de los paneles.

## v0.1.4

Release de mantenimiento sobre 0.1.3. Sin features nuevas, foco en estabilidad del bundle y de la conexión a Mongo.

- **Mongo URL por defecto** pasa de `mongodb://localhost:27017` a `mongodb://127.0.0.1:27017` (config, settings, service y tests). Evita la latencia/timeout que aparece cuando el resolver de Node intenta IPv6 primero en hosts dual-stack y Mongo solo escucha en IPv4.
- **esbuild CJS bundle**: `web-tree-sitter` se empaqueta inline en `dist/extension.cjs`. Se quita del array `external` y se inyecta un shim de `import.meta.url` vía `banner` + `define` para que el módulo ESM funcione dentro del bundle CommonJS de la extension host.
- **Notes panel**: el handler del mensaje `ready` del webview ya no re-emite el modo inicial cuando llega un replay del mismo evento. Se cubre con un test que verifica que `open` se postea una sola vez ante múltiples `ready`.
- Refactor interno de `useNotesController.ts` y rebuild de `media/notes.js`.

## v0.1.3

La rama `v0.1.3` cierra el ciclo de Notes + Reminders + Script Flow dentro de la extensión.

### Reminders en Notes

- Cada nota puede guardar un `remindAt` one-shot desde el editor del panel Notes.
- La campana en status bar muestra cuántos recordatorios siguen pendientes y abre Notes filtrado por recordatorios.
- Al iniciar VS Code, la extensión ejecuta `fireDue(..., "startup")` y después reprograma timers con `scheduleAll(...)`, así que los reminders vencidos mientras VS Code estaba cerrado vuelven a dispararse al reabrir.
- El flujo de reminder soporta `snooze` y `dismiss`: posponer mueve `remindAt` hacia adelante y limpia `remindedAt`; descartar marca `remindedAt` para evitar reprocesarlo.

### Script Flow panel

- El panel Script Flow ya analiza archivos `.ts`, `.tsx`, `.py` y `.sql`.
- Se puede abrir con `Cortex: Open Script Flow` o desde el context menu del editor.
- Si hay selección activa, `Cortex: Open Script Flow for Selection` limita el análisis al rango elegido.
- El panel mantiene navegación por nodos, drawer analítico, telemetry de interacción y click-to-range sobre el editor.
- SQL se resuelve en el extension host con `node-sql-parser`, intentando `postgresql` y luego `mysql` como fallback.

### Comandos nuevos y relevantes

- `cortex.openNotes`
- `cortex.newNote`
- `cortex.editNote`
- `cortex.deleteNote`
- `cortex.snoozeReminder`
- `cortex.openLogs`
- `cortex.openScriptFlow`
- `cortex.openScriptFlowForSelection`
- `cortex.togglePlanStatusFilter`

### Limitaciones conocidas

- Script Flow sigue siendo single-file: no resuelve imports ni dependencias cross-file.
- SQL cubre el MVP de `WITH`/CTE, `SELECT`, `JOIN` y subqueries comunes; no intenta cobertura total del lenguaje.
- Reminders son one-shot; no hay recurrencia ni calendario complejo.
- Los smoke tests manuales de UX siguen siendo recomendables antes del merge final porque el bundle y los fixtures no sustituyen una corrida interactiva completa en VS Code.

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

## Documentación

- [Arquitectura](./README.architecture.md)
- [Desarrollo local](./README.development.md)
- [Contrato de logs](./docs/log-contract.md)
