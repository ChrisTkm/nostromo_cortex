# Cortex

Monorepo TypeScript con `pnpm` para gestión visual de tareas dependientes en VS Code, exposición MCP para agentes/skills y telemetría local detallada.

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

