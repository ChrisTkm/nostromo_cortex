# Cortex — Knowledge cockpit for VS Code

Cortex is a **local-first knowledge and execution cockpit** for VS Code. It turns your MongoDB task database into a navigable PERT graph, connects notes, logs, and archive in one place, and scans local Markdown folders for knowledge graph exploration.

> 🖼️ Screenshots coming soon. See the [monorepo README](https://github.com/anomalyco/cortex) for the development preview.

## Features

### Task Navigator (sidebar)
Tree view of tasks grouped by plan, with status badges, severity indicators, and filter bar. Supports filters by project, group, tags, status, and severity.

### PERT Graph
Force-directed graph of your action plans with:
- Layout via Dagre (hierarchical, left-to-right by default)
- Mini-map and zoom controls
- Cycle detection in dependency chains
- Click-to-edit on any task

### Notes Panel
CRUD notes stored in MongoDB:
- Markdown body, tags, optional link to task/plan
- Pinned notes, search-as-you-type
- One-shot reminders with status-bar badge and timers

### Logs Panel
Browser for MongoDB log documents:
- Grouped by execution ID
- Filter by tag, level, process
- Legacy ungrouped fallback for pre-standardization documents

### Archive Panel
Explore archived plans and their frozen task snapshots. Archive any DONE plan from the task navigator.

### Cortex Brain
Point at a local folder of `.md`/`.mdx` files and visualize:
- Links between documents
- Tag connections
- Account/reference networks
- Orphan detection

### Script Flow
Analyze `.ts`, `.tsx`, `.py`, and `.sql` files directly in the editor:
- Function/module tree
- Click to navigate to source range
- SQL parser with CTE/subquery support

### Panel Switcher
QuickPick to jump between Task Navigator, PERT Graph, Notes, Logs, Archive, Cortex Brain, and Script Flow.

## Requirements

- **MongoDB** 6+ running locally (or accessible via network)
- VS Code 1.100+

### MongoDB Setup

The extension needs a local or remote MongoDB instance. Options:

**Option A — Docker (recommended)**
```bash
docker run -d --name cortex-mongo -p 27017:27017 mongo:7
```

**Option B — Docker Compose** (from the repo)
```yml
# docker-compose.yml — standalone Mongo for Cortex
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - cortex-mongo-data:/data/db
volumes:
  cortex-mongo-data:
```

**Option C — Local install**
Install MongoDB Community Server and start the `mongod` service.

After setting up Mongo:
1. Run `Cortex: Set Mongo URL` to configure the connection
2. Run `Cortex: Create sample local database` to seed sample tasks

> The Mongo URL is stored in VS Code SecretStorage (not in settings files).

## First Run

On first activation Cortex shows a welcome message with two quick actions:
- **Set Mongo URL** — configure your MongoDB connection string
- **Create Sample Database** — seed sample tasks and plans

If MongoDB is unreachable, the extension activates gracefully with a guided message.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cortex.mongoDbName` | `cortex` | MongoDB database name |
| `cortex.mongoTasksCollection` | `tasks` | Tasks collection name |
| `cortex.mongoNotesCollection` | `notes` | Notes collection name |
| `cortex.mongoLogsCollection` | `logs` | Logs collection name |
| `cortex.mongoPlansCollection` | `action_plans` | Plans collection name |
| `cortex.archivePath` | `~/cortex-archive` | Archive output directory |
| `cortex.brainRootPath` | — | Default folder for Cortex Brain |

## Commands

| Command | Title |
|---------|-------|
| `cortex.refresh` | Refresh tasks |
| `cortex.openGraph` | Open PERT graph |
| `cortex.openNotes` | Open notes panel |
| `cortex.newNote` | New note |
| `cortex.openLogs` | Open logs panel |
| `cortex.openArchive` | Open Archive |
| `cortex.openBrain` | Open Cortex Brain |
| `cortex.openScriptFlow` | Open Script Flow |
| `cortex.setMongoUrl` | Set Mongo URL |
| `cortex.bootstrapDatabase` | Create sample local database |
| `cortex.selectPlan` | Select Action Plan |
| `cortex.archivePlan` | Archive Plan |
| `cortex.listCycles` | List dependency cycles |
| `cortex.installSkills` | Install agent skills (plan/tareas) |

## Agent Integration Pack (optional)

For Claude Code / Codex integration, Cortex provides an optional **agent pack**:

- **MCP server** (`@cortex/mcp-server`) — tools, resources, and prompts over tasks and telemetry
- **Skills** (`plan`, `tareas`) — reusable prompts for plan/task management from the assistant

Install separately:
```bash
npx @cortex/mcp-server
cortex.installSkills  # copies skills to ~/.claude/skills/
```

See the [monorepo](https://github.com/) for details.

## Known Limitations

- Single-file Script Flow analysis (no cross-file imports)
- One-shot reminders (no recurrence)
- No bundled MongoDB — requires an external instance
- The extension is a **visualizer only**; plan/task creation requires the agent pack or CLI

## Release Notes

### 0.1.5
Archive panel, logs by execution, PERT polish, SecretStorage for Mongo URL, Cortex Brain panel, Script Flow improvements.

### 0.1.4
Mongo URL default switched to `127.0.0.1` (IPv4), web-tree-sitter CJS bundle fix, Notes panel stability.

### 0.1.3
Notes CRUD with reminders, Script Flow panel (TS/TSX/PY/SQL), logs panel, Cortex Brain preview.

## Repository

[github.com/anomalyco/cortex](https://github.com/anomalyco/cortex) — monorepo with all packages, scripts, and development guide.
