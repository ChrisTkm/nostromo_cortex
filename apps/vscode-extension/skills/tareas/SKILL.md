---
name: tareas
description: Gestiona tareas del ecosistema Nostromo en MongoDB local (localhost:27017) (daily briefing, crear, actualizar, consultar) usando el protocolo MCP.
metadata: 
  author: albornoz.studio
  version: "1.0"
---

# Skill: /tareas

Cuando el usuario invoque este skill, gestiona las tareas del proyecto usando MongoDB local via MCP.

**Host**: `localhost:27017` · **Base de datos**: `nostromo_cortex` · **Colección**: `tasks`

## Esquema de tarea

```json
{
  "short_task": "Descripción breve (máx 150 chars)",
  "detail": "Contexto ampliado, links a archivos, dependencias. Markdown permitido.",
  "status": "PENDING",
  "agent": "any",
  "severity": "MEDIUM",
  "created_at": "2026-01-10T00:00:00Z",
  "updated_at": "2026-01-10T00:00:00Z",
  "tags": ["backend", "api"]
}
```

| Campo | Valores válidos |
|---|---|
| `status` | `PENDING` · `IN_PROGRESS` · `DONE` · `BLOCKED` · `ARCHIVED` |
| `agent` | `claude` · `codex` · `any` |
| `severity` | `CRITICAL` · `HIGH` · `MEDIUM` · `LOW` |

### El campo `agent` — quién ejecuta la tarea

`agent` identifica **la IA que ejecuta la tarea**, no un dominio.

- `any` — tarea sin tomar; cualquier IA puede agarrarla.
- `claude` — la está ejecutando (o la ejecutó) Claude.
- `codex` — la está ejecutando (o la ejecutó) Codex.

**REGLA OBLIGATORIA — al empezar a trabajar una tarea:**
Cuando una IA toma una tarea para ejecutarla, en la MISMA operación debe:
1. Cambiar `status` → `IN_PROGRESS` (mayúsculas).
2. Setear `agent` con su propio nombre: si la ejecuta Codex → `codex`; si la ejecuta Claude → `claude`.
3. Refrescar `updated_at`.

Nunca dejes una tarea en `IN_PROGRESS` con `agent: "any"` — siempre debe quedar registrado quién la tomó.

> El **dominio** de la tarea (backend, frontend, etl, docs…) va en `tags`, NO en `agent`.

---

## Operaciones disponibles

### "¿Qué hay para hoy?" — Daily Briefing

Consultar tareas pendientes. MCP tool: `find`. `<AGENTE>` es la IA actual (`claude` o `codex`).

```json
{
  "database": "nostromo_cortex",
  "collection": "tasks",
  "filter": {
    "status": { "$in": ["PENDING", "IN_PROGRESS", "BLOCKED"] },
    "agent": { "$in": ["<AGENTE>", "any"] }
  },
  "sort": { "severity": 1, "created_at": 1 }
}
```

Trae las tareas ya tomadas por la IA actual (`<AGENTE>`) más las libres (`any`). Mostrar resultados ordenados: `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`.

Para acotar por dominio, filtrar además por `tags` (ej. `"tags": { "$in": ["backend"] }`).

---

### Crear tarea — `insertOne`

```json
{
  "database": "nostromo_cortex",
  "collection": "tasks",
  "document": {
    "short_task": "Título de la tarea",
    "detail": "Descripción detallada con contexto.",
    "status": "PENDING",
    "agent": "any",
    "severity": "HIGH",
    "created_at": "<ISO_NOW>",
    "updated_at": "<ISO_NOW>",
    "tags": ["backend"]
  }
}
```

Una tarea nueva se crea con `agent: "any"` (sin tomar). El `agent` se asigna recién cuando una IA la toma y la pasa a `IN_PROGRESS`. Antes de crear, verificar que no exista una tarea duplicada con filtro `short_task`.

---

### Actualizar estado — `update-many` + `$set`

⚠️ **NUNCA usar delete + re-insert para mutar una tarea.** Ese patrón ya causó pérdida irrecuperable de documentos (prompts completos). Mutar siempre con `update-many` y `$set` por campo: solo los campos que cambian van en el `$set`, el resto del documento queda intacto.

Ejemplo: Claude toma una tarea libre y empieza a trabajarla → `status: IN_PROGRESS` + `agent: claude`:
```json
{
  "tool": "update-many",
  "database": "nostromo_cortex",
  "collection": "tasks",
  "filter": { "short_task": "Título exacto de la tarea" },
  "update": {
    "$set": {
      "status": "IN_PROGRESS",
      "agent": "claude",
      "updated_at": "<ISO_NOW>"
    }
  }
}
```

Verificar que el resultado reporte `matchedCount: 1`. Si matchea 0, revisar el filtro (preferir `code` si la tarea lo tiene) antes de reintentar.

**Transiciones de estado válidas:**
- `PENDING` → `IN_PROGRESS` — al comenzar a trabajar. **Setear también `agent` = la IA que toma la tarea (`claude` o `codex`).**
- `IN_PROGRESS` → `DONE` (al terminar)
- `IN_PROGRESS` → `BLOCKED` (si hay un bloqueador)
- `BLOCKED` → `PENDING` (cuando se resuelve el bloqueador)
- Cualquier → `ARCHIVED` (tarea deprecada o irrelevante)

---

### Cierre con commit - obligatorio antes de `DONE`

Cuando una tarea `IN_PROGRESS` se completa y el trabajo produjo cambios en un repositorio git, crear un commit **antes** de marcar la tarea como `DONE`. Aplicar el Protocolo de Commits Nostromo definido en `C:\dev\Estudios\guias\git.md`.

1. Ejecutar `git status --short` y revisar el diff relevante.
2. Incluir solo archivos relacionados con la tarea. No agregar ni revertir cambios ajenos del usuario u otras tareas.
3. Mantener commits atomicos: si hay cambios logicos distintos, separarlos en commits distintos o pedir criterio al usuario.
4. Correr las verificaciones razonables del repo si están disponibles y no son prohibitivas.
5. Crear un commit con Conventional Commits:

```text
<type>(<scope>): <descripcion corta> [<task-code-or-short-task>]
```

Tipos validos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Scopes sugeridos: `core`, `ui`, `conf`, `auth`, `db`, `docs`, `deps`, o el nombre del proyecto/modulo cuando aplique.

Reglas del mensaje: usar imperativo presente, todo en minusculas, sin punto final, maximo 72 caracteres si es razonable. No usar mensajes vagos como `wip`, `arreglos varios` o `cambios`.

Ejemplos:

```text
feat(nostromo): añadir cierre con commit en tareas [TAREAS]
fix(ui): corregir alineacion en header movil [TASK-03]
docs(readme): actualizar instrucciones de instalacion [docs]
chore(deps): actualizar mongoose a v6 [deps]
```

Usar `task.code` si existe. Si la tarea no tiene `code`, usar `project`, un tag principal, o una version corta de `short_task` entre corchetes. Si no hay cambios git, si el directorio no es un repo, o si el usuario pidio explicitamente no commitear, registrar eso y continuar con el cierre.

Despues del commit exitoso, actualizar la tarea a `DONE` con `update-many` + `$set` (`status`, `updated_at`, y `completed_at` si el esquema lo usa). Si las verificaciones fallan o el commit no puede hacerse por cambios mezclados, dejar la tarea en `IN_PROGRESS` o pasarla a `BLOCKED` con el motivo.

---

### Registro en Ledger — `record_run` obligatorio al cerrar

Después de marcar la tarea `DONE` (o `FAILED`), el agente DEBE reportar su sesión al Ledger de Cortex. Si no se reporta, el run NO aparece en el panel Ledger — el Ledger no intercepta nada, depende de este paso.

Vía preferida — tool `record_run` del MCP server `cortex`:

```json
{
  "tool": "record_run",
  "agent_slug": "<claude-code | codex | big-pickle | copilot | gemini>",
  "task_codes": ["<codes de las tasks tocadas en la sesión>"],
  "files": ["<rutas relativas de archivos modificados>"],
  "tokens_in": 0,
  "tokens_out": 0,
  "status": "completed"
}
```

`tokens_in`/`tokens_out` son opcionales (omitir si no se conocen). `status` es `completed` o `failed` según cómo terminó la sesión.

Si el server `cortex` no está disponible en la sesión, fallback: insert directo en `nostromo_cortex.agent_runs` (esquema en `c:\dev\Cortex\docs\modules\ledger.md`) y avisar al usuario que el MCP `cortex` no está registrado en este cliente.

---

### Consultas útiles

**Tareas críticas sin completar (todos los agentes):**
```json
{
  "filter": { "severity": "CRITICAL", "status": { "$ne": "DONE" } }
}
```

**Tareas por tag:**
```json
{
  "filter": { "tags": { "$in": ["etl"] }, "status": "PENDING" }
}
```

**Tareas bloqueadas:**
```json
{
  "filter": { "status": "BLOCKED" }
}
```

---

## Protocolo de sesión (Daily Workflow)

Al iniciar sesión de trabajo, la IA debe:

1. **Consultar** tareas pendientes con el Daily Briefing
2. **Revisar bloqueadores** — verificar si las tareas `BLOCKED` ya tienen su bloqueador resuelto
3. **Seleccionar** la tarea de mayor severidad
4. **Tomar** la tarea seleccionada: `status` → `IN_PROGRESS` **y** `agent` → la IA actual (`claude` o `codex`), en la misma operación
5. **Ejecutar** el trabajo
6. **Cerrar con commit** si hubo cambios git relacionados con la tarea
7. **Marcar** como `DONE` al terminar, o `BLOCKED` si surge un impedimento
8. **Reportar la sesión** al Ledger con `record_run` (ver sección Registro en Ledger)

---

## Buenas prácticas

- Siempre actualizar `updated_at` al modificar una tarea
- Al finalizar una tarea con cambios git, commitear antes de marcar `DONE`
- Cerrar siempre la sesión con `record_run` — sin reporte no hay fila en el panel Ledger
- Al pasar una tarea a `IN_PROGRESS`, estampar siempre `agent` con la IA que la toma — nunca dejarla en `any`
- Usar `short_task` descriptivos — evitar "Fix bug", "Arreglar error"
- En `detail`: incluir links a archivos, mencionar dependencias, referenciar documentación
- Usar `tags` consistentes entre tareas del mismo dominio (backend, frontend, etl, docs…)
- Archivar periódicamente las tareas `DONE` para reducir ruido en queries
