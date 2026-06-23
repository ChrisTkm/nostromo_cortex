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
node apps/mcp-server/dist/cli.cjs
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

### Assets runtime (wasm)

El analyzer de Python carga `web-tree-sitter.wasm` y `tree-sitter-python.wasm` en runtime desde `apps/vscode-extension/media/`. El build los copia desde `node_modules` vía `copyStaticAssets()` en `esbuild.mjs` y verifica su presencia al final — si faltan, el build falla con un error explícito.

El `files` de `package.json` los empaqueta vía el glob `"media/**"`. NO restringir ese glob a subsets como `"media/*.{js,css}"`: el `.vsix` quedaría sin wasm y el panel Script Flow para Python rompería en runtime con 'could not find tree-sitter-python.wasm'.

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

## Registro del MCP en Claude Code

Añadir a `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["C:/dev/Cortex/apps/mcp-server/dist/cli.cjs"],
      "env": {
        "MONGO_URL": "mongodb://127.0.0.1:27017",
        "MONGO_DB_NAME": "nostromo_cortex",
        "MONGO_TASKS_COLLECTION": "tasks",
        "TELEMETRY_BACKEND": "jsonl",
        "TELEMETRY_JSONL_PATH": "C:/dev/Cortex/data/telemetry/cortex-telemetry.jsonl"
      }
    }
  }
}
```

## Registro del MCP en Cursor

Añadir a `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["C:/dev/Cortex/apps/mcp-server/dist/cli.cjs"],
      "env": {
        "MONGO_URL": "mongodb://127.0.0.1:27017",
        "MONGO_DB_NAME": "nostromo_cortex",
        "MONGO_TASKS_COLLECTION": "tasks",
        "TELEMETRY_BACKEND": "jsonl",
        "TELEMETRY_JSONL_PATH": "C:/dev/Cortex/data/telemetry/cortex-telemetry.jsonl"
      }
    }
  }
}
```

## Registro del MCP en opencode

El repo incluye `opencode.json` en la raíz con dos servers MCP locales: `cortex` (tools de dominio: `task_list`, `task_start`, `task_complete`, `record_run`, `query_runs`, etc. — requiere build previo con `pnpm --filter @cortex/mcp-server build`) y `mongodb` (el oficial `mongodb-mcp-server` vía npx, CRUD genérico sobre `nostromo_cortex` que usan las skills `/tareas` y `/plan`). opencode los carga automáticamente al abrir `C:/dev/Cortex` — verificar con `/mcp` que aparezcan ambos.

Para cerrar una tarea ejecutada por una IA, usar siempre `task_complete`. Esa tool marca la task `DONE`/`FAILED`, recalcula el plan y registra o completa el run de Ledger. No insertar directo en `agent_runs`: el schema persistido usa `id` autogenerado y `files_touched`; el MCP acepta `files` como input y lo normaliza.

### Tool `record_run`

Registra una sesión de agente en la colección `agent_runs`. Pensado para que el agente (Claude Code, Codex, etc.) lo invoque al finalizar una tarea o al recibir un "Stop" hook.

**Parámetros:**

| Campo        | Tipo                                   | Default     | Descripción                                         |
| ------------ | -------------------------------------- | ----------- | --------------------------------------------------- |
| `agent_slug` | `string`                               | —           | Slug del agente (`big-pickle`, `claude-code`, etc.) |
| `task_codes` | `string[]`                             | `[]`        | Códigos de las tasks tocadas en la sesión           |
| `tokens_in`  | `number` (opcional)                    | —           | Tokens de entrada consumidos                        |
| `tokens_out` | `number` (opcional)                    | —           | Tokens de salida generados                          |
| `files`      | `string[]`                             | `[]`        | Rutas relativas de archivos modificados             |
| `status`     | `"running" \| "completed" \| "failed"` | `"running"` | Estado de la sesión                                 |

**Ejemplo de invocación desde Claude Code Stop hook** (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": {
      "stop": {
        "condition": "toolName === 'task_update' || toolName === 'task_create'",
        "trigger": "mcp_cortex record_run",
        "params": {
          "agent_slug": "claude-code",
          "task_codes": ["$touchedCodes"],
          "tokens_in": "$tokensIn",
          "tokens_out": "$tokensOut",
          "files": "$changedFiles",
          "status": "completed"
        }
      }
    }
  }
}
```

La extracción precisa de `tokens_in`/`tokens_out` desde el contexto de Claude Code depende del cliente — el agente debe pasar estos valores explícitamente al tool. No hay extracción automática desde la API de Anthropic.
