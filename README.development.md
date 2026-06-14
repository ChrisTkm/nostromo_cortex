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

⚠️ **Warning — split-brain de DB name.** `MONGO_DB_NAME` (.env) es la única fuente para CLI + MCP server.
La extensión VS Code tiene su PROPIO setting `cortex.mongoDbName` en `.vscode/settings.json`.
Ambos DEBEN coincidir. Si divergen, el CLI escribe en una DB y la extensión lee de otra, creando
colecciones vacías en la DB default. Síntoma: la DB `cortex` queda vacía mientras los datos reales
están en otra (ej. `nostromo_cortex`).

La extensión de VS Code guarda la Mongo URL en SecretStorage mediante `Cortex: Set Mongo URL`; estas variables aplican principalmente al MCP server, scripts y configuración compartida de `@cortex/core`.

## Mongo local

Cortex usa por defecto el Mongo compartido `nostromo-mongo` en `mongodb://127.0.0.1:27017`.

```bash
pnpm mongo:up
pnpm seed
```

> **🧊 Clon fresco sin el ecosistema Nostromo.** `pnpm mongo:up` ejecuta `docker start nostromo-mongo` y asume que el contenedor ya existe. Si no lo tienes, levanta Mongo con el compose del repo en un puerto alternativo:
>
> ```bash
> docker compose --profile local-mongo up -d mongo
> MONGO_URL=mongodb://127.0.0.1:27018 pnpm seed
> ```
>
> Luego configura `cortex.mongoUrl` en VS Code via `Cortex: Set Mongo URL`

El `docker-compose.yml` de este repo queda solo como fallback aislado para pruebas puntuales. Si necesitas levantarlo, usa el profile `local-mongo` y configura `MONGO_URL=mongodb://127.0.0.1:27018` para esa sesion.

```bash
docker compose --profile local-mongo up -d mongo
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

## Telemetría

La extensión de VS Code y los scripts de inspección (`inspect:telemetry:runs`, `inspect:cost`)
comparten el **mismo backend y ruta** definidos por `loadConfig` de `@cortex/core`:

| Fuente | Backend | Ruta |
|---|---|---|
| CLI / scripts | `TELEMETRY_BACKEND` (`.env`) | `TELEMETRY_SQLITE_PATH` / `TELEMETRY_JSONL_PATH` |
| Extensión VS Code | `cortex.telemetryBackend` (`.vscode/settings.json`) | `cortex.telemetrySqlitePath` / `cortex.telemetryJsonlPath` |

Ambos deben apuntar al mismo archivo para que las interacciones del extension
sean visibles via `pnpm inspect:cost`. El default es sqlite en
`./data/telemetry/cortex-telemetry.db`.

⚠️ Si cambias el backend en un lado, cámbialo también en el otro.
Síntoma de drift: el extension graba interacciones pero `inspect:telemetry:runs`
no muestra nada.

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
