# @cortex/mcp-server

MCP server for [Cortex](https://github.com/ChrisTkm/cortex) — exposes task management, graph snapshots, telemetry queries and planning prompts via the [Model Context Protocol](https://modelcontextprotocol.io).

Part of the **agent integration pack** (MCP + [Claude skills](../cortex-vscode-extension/.claude/skills)). The VS Code extension is a standalone visualizer; the MCP server adds agentic access to the same local MongoDB.

## Usage

```bash
npx @cortex/mcp-server
```

Requires a local MongoDB instance. Configure via environment variables:

```bash
MONGO_URL=mongodb://127.0.0.1:27017 \
MONGO_DB_NAME=nostromo_cortex \
MONGO_TASKS_COLLECTION=tasks \
npx @cortex/mcp-server
```

## Client configuration

### Claude Code

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["@cortex/mcp-server"],
      "env": {
        "MONGO_URL": "mongodb://127.0.0.1:27017",
        "MONGO_DB_NAME": "nostromo_cortex",
        "MONGO_TASKS_COLLECTION": "tasks"
      }
    }
  }
}
```

### Other MCP clients

Same pattern — spawn `npx @cortex/mcp-server` via stdio with the env vars above.

## Tools

| Tool | Description |
|------|-------------|
| `task_list` | List tasks with filters (status, agent, severity, tags, search) |
| `task_get` | Get a single task by code or ID |
| `task_ready_list` | List ready (unblocked) tasks |
| `task_blockers` | Get blockers for a task |
| `task_downstream` | Get downstream dependents |
| `graph_snapshot` | Full graph snapshot with filters |
| `critical_path_estimate` | Critical path through the DAG |
| `telemetry_recent_runs` | Recent telemetry runs |
| `telemetry_cost_summary` | Cost summary by date range |
| `task_cycles` | Detect dependency cycles |

## Prompts

- `plan_execution_from_ready_tasks` — plan execution from ready tasks
- `summarize_blockers` — summarize blockers
- `review_task_dependencies` — review dependency quality
- `suggest_parallel_work` — suggest safe parallel work

## Resources

- `cortex://tasks` — all tasks
- `cortex://tasks/{code}` — single task
- `cortex://graph/snapshot` — full graph snapshot
- `cortex://graph/ready` — ready tasks
- `cortex://telemetry/recent` — last 10 telemetry runs
- `cortex://telemetry/summary` — cost summary

## Prerequisites

- Node.js 20+
- Local MongoDB instance (see [Cortex README](../../README.md) for setup)
