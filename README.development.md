# Desarrollo local

## Requisitos

- Node.js 20+
- `pnpm` (o `corepack`)
- Docker opcional para Mongo local
- VS Code 1.100+

## Instalación

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
```

## Variables de entorno

Copiar `.env.example` a `.env` si quieres personalizar rutas y conexiones.

Variables clave:

- `MONGO_URL` (default: `mongodb://127.0.0.1:27017`)
- `MONGO_DB_NAME` (default: `cortex`)
- `MONGO_TASKS_COLLECTION` (default: `tasks`)
- `TELEMETRY_BACKEND` (default: `sqlite`; usa `jsonl` para archivo JSONL)
- `TELEMETRY_SQLITE_PATH` (default: `./data/telemetry/cortex-telemetry.db`)
- `TELEMETRY_JSONL_PATH` (default: `./data/telemetry/cortex-telemetry.jsonl`)
- `LOG_LEVEL` (default: `info`)
- `LOG_FORMAT` (default: `pretty`; usa `json` para logs estructurados)
- `SNAPSHOT_MAX_TASKS` (default: `500`)

La extensión de VS Code guarda la Mongo URL en SecretStorage mediante `Cortex: Set Mongo URL`; estas variables aplican principalmente al MCP server, scripts y configuración compartida de `@cortex/core`.

## Levantar Mongo local

```bash
pnpm mongo:up
pnpm seed
```

## Dataset seed

El seed crea estas relaciones:

- `S1 -> S2`
- `S2 -> S2.1`
- `S2.1 -> S3`
- `S2.1 -> S4`
- `S5a -> S5b`
- `S2.1 -> S5b`

`S5a` queda paralelo a `S2.1`.

## Desarrollo

```bash
pnpm dev
```

Esto deja watchers para:

- `@cortex/core`
- `@cortex/telemetry`
- `@cortex/mcp-server`
- `@cortex/vscode-extension`

## Build, lint y tests

```bash
pnpm build
pnpm lint
pnpm test
```

## Servidor MCP

Construir y ejecutar:

```bash
pnpm --filter @cortex/mcp-server build
node apps/mcp-server/dist/index.js
```

## Extensión VS Code

1. ejecutar `pnpm --filter @cortex/vscode-extension build`
2. abrir `C:\dev\Cortex` en VS Code
3. lanzar la extensión con `F5` desde el workspace
4. usar comandos:
   - `Cortex: Open PERT graph`
   - `Cortex: Refresh tasks`
   - `Cortex: Set search query`
   - `Cortex: Set tag filter`
   - `Cortex: List dependency cycles`

## Inspección y debugging

```bash
pnpm inspect:snapshot
pnpm inspect:telemetry:runs
pnpm inspect:telemetry:failures
pnpm inspect:cost
pnpm check:cycles
```

## Registro del MCP en Codex

Usa el archivo de ejemplo `.codex/config.toml.example`.
