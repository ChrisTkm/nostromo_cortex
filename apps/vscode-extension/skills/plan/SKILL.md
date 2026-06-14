---
name: plan
description: Gestiona planes de acción (1→N tareas) en MongoDB local (nostromo_cortex) para ejecución ordenada por DAG/PERT. Úsalo SIEMPRE que el usuario mencione un plan o proyecto por su código/nombre (ej. "cortex-v015", "el plan X", "dónde quedamos en X"), aunque no escriba /plan literal. Integrado con Cortex como visualizador. Soporta resume tras caída de sesión via current_task_code.
metadata: 
  author: albornoz.studio
  version: "1.0"
---

# Skill: /plan

Cuando el usuario invoque este skill, gestiona **planes de acción** y sus tareas en MongoDB local vía MCP. Un plan agrupa N tareas ejecutables en orden (DAG con `depends_on`), cada una con su prompt completo para que otra IA (Codex) pueda ejecutarla sin contexto adicional.

**Host**: `localhost:27017` · **Base de datos**: `nostromo_cortex`
**Colecciones**: `action_plans` (metadata) + `tasks` (ejecutables, compatible con Cortex PERT viewer en `c:\dev\Cortex`)

---

## ⚡ Triage — LEE ESTO ANTES DE CUALQUIER QUERY

Si el usuario menciona un plan/proyecto por nombre y quiere **verlo, revisarlo, retomarlo o ejecutar una tarea** (aunque NO escriba `/plan` literal):

1. **NUNCA** ejecutes `list-databases` ni `list-collections`. La DB es SIEMPRE `nostromo_cortex`. Las colecciones son SIEMPRE `action_plans` + `tasks`. No hay nada que descubrir.
2. **NUNCA** busques por `tags` para ubicar un plan o sus tasks. Se ubican por `code` / `plan_code`.
3. Llegar a un plan completo son **exactamente 2 queries**. Ni una más:

```json
// 1. el plan — case-insensitive SIEMPRE
{ "tool": "find", "collection": "action_plans",
  "filter": {"code": {"$regex": "^<NOMBRE>$", "$options": "i"}} }
// 2. sus tasks
{ "tool": "find", "collection": "tasks",
  "filter": {"plan_code": {"$regex": "^<NOMBRE>$", "$options": "i"}},
  "sort": {"order_hint": 1, "code": 1} }
```

### 🔑 Regla de CASE — causa #1 de "el plan no existe"

- `action_plans.code` y `tasks.plan_code` se guardan en **MAYÚSCULAS**: `CORTEX-V015`.
- `tasks.code` también en mayúsculas: `CORTEX-V015-T01`.
- `project` se guarda en **minúsculas**: `cortex-v015`.
- El usuario escribe en cualquier caso. **SIEMPRE** busca `code`/`plan_code` con `{"$regex":"^...$","$options":"i"}`.
- **0 resultados NO significa "no existe".** Si una query exacta da 0, reintenta case-insensitive ANTES de concluir nada. Solo tras el regex sin match puedes decir que no existe.

---

## Por qué existe este skill

- **Resume tras caída**: si se van tokens o cae la conexión, `/plan resume` devuelve exactamente el task en curso + su prompt completo. Cero pérdida de contexto.
- **Ejecución por otra IA**: cada task lleva su `prompt` completo ejecutable por Codex sin depender de archivos `.md` sueltos.
- **Orden jerárquico resuelto**: `depends_on` + `order_hint` + `lane` definen el DAG. Cortex lo grafica en PERT.
- **Bitácora de plan**: `notes` del plan registra decisiones/bloqueadores/progreso a nivel macro.

---

## Esquema — `action_plans`

```json
{
  "_id": "ObjectId",
  "code": "SEV-POSTREFACTOR",
  "title": "Sevastopol — post-refactor alignment",
  "description": "Qué resuelve el plan y por qué",
  "goal": "Estado final deseado",
  "context": "Stack, paths relevantes, decisiones previas",
  "status": "PLANNING | IN_PROGRESS | DONE | PAUSED | ARCHIVED",
  "project": "sevastopol-post-refactor",
  "tags": ["backend", "refactor"],
  "progress": {
    "total": 0, "pending": 0, "in_progress": 0,
    "blocked": 0, "done": 0, "failed": 0
  },
  "current_task_code": "SEV-S5a",
  "created_at": "<ISO>",
  "updated_at": "<ISO>",
  "completed_at": null,
  "notes": "Bitácora markdown con appends cronológicos"
}
```

`code` es único. `current_task_code` apunta al task `IN_PROGRESS` activo (puntero para resume). `progress` está denormalizado: se recalcula en cada transición de task.

---

## Esquema — `tasks` (compatible Cortex)

```json
{
  "_id": "ObjectId",
  "code": "SEV-S5a",
  "project": "sevastopol-post-refactor",
  "plan_code": "SEV-POSTREFACTOR",
  "short_task": "Backend CRUD params comunes",
  "detail": "Resumen corto (máx ~300 chars)",
  "status": "PENDING",
  "agent": "orchestrator",
  "severity": "HIGH",
  "tags": ["backend", "common", "parameters"],
  "depends_on": [],
  "duration_estimate": 4,
  "lane": "backend",
  "order_hint": 6,
  "source_ref": "codex-tasks/sevastopol-post-refactor-prompts.md#S5a",
  "prompt": "Prompt completo ejecutable por Codex (multilínea, markdown)",
  "acceptance": "Criterios de aceptación explícitos",
  "out_of_scope": "Qué NO está en scope",
  "created_at": "<ISO>",
  "updated_at": "<ISO>"
}
```

| Campo | Valores |
|---|---|
| `status` | `PENDING` · `IN_PROGRESS` · `BLOCKED` · `DONE` · `FAILED` |
| `agent` | `orchestrator` · `sevastopol` · `nostromo` · `jean_d_arc` · `any` |
| `severity` | `CRITICAL` · `HIGH` · `MEDIUM` · `LOW` |

**CRÍTICO**: estados son `DONE`/`FAILED` (schema Cortex), NO `COMPLETED`. Si encuentras `COMPLETED` en alguna tarea vieja, normaliza a `DONE` inmediatamente.

**Campos que alimentan el grafo PERT** (Cortex los usa en `c:\dev\Cortex\packages\core\src\graph.ts`):
- `depends_on`: aristas del DAG (precedencia dura)
- `duration_estimate`: peso del nodo (horas) → habilita camino crítico
- `lane`: swimlane (backend/frontend/etl)
- `order_hint`: desempate entre nodos *ready* del mismo nivel

---

## Operaciones

### `/plan new <code>` — Crear plan con N tareas

1. Pedir al usuario (si no los dio): `code`, `title`, `description`, `goal`, lista de tareas.
2. Para cada tarea: obtener `code` único, `short_task`, `prompt` completo, `depends_on` (codes de otras tareas del plan), `duration_estimate`, `lane`, `agent`, `severity`, `acceptance`, `out_of_scope`.
3. Validar que no hay ciclos en `depends_on` y que todos los codes referenciados existen en el plan.
4. Insertar el plan con `status: "PLANNING"`, `progress.total = N`, `progress.pending = N`, resto en 0.
5. Insertar todas las tareas con `status: "PENDING"` y `plan_code` apuntando al plan.
6. Mostrar tabla: `code | short_task | lane | deps | order`.

```json
// insert action_plan
{
  "tool": "insert-many",
  "database": "nostromo_cortex",
  "collection": "action_plans",
  "documents": [{ ...plan doc... }]
}
// insert tasks
{
  "tool": "insert-many",
  "database": "nostromo_cortex",
  "collection": "tasks",
  "documents": [...tasks...]
}
```

---

### `/plan show <code>` — Vista completa

```json
// 1. get plan
{ "tool": "find", "collection": "action_plans", "filter": {"code": {"$regex": "^<code>$", "$options": "i"}} }
// 2. get tasks
{ "tool": "find", "collection": "tasks", "filter": {"plan_code": {"$regex": "^<code>$", "$options": "i"}}, "sort": {"order_hint": 1, "code": 1} }
```

Imprimir:
- Header del plan: `code · title · status · progress (X/Y done)`
- `current_task_code` si existe
- `description`, `goal`
- Tasks agrupados por status (DONE al final), con `code · short_task · lane · deps`
- Últimas líneas de `notes` (bitácora)

---

### `/plan resume [code]` — Recuperar hilo tras caída

**La operación más importante del skill.** Úsala al inicio de cada sesión o cuando el usuario dice "dónde quedamos".

1. Si no se pasa `code`: buscar plan con `status: "IN_PROGRESS"` (si hay varios, listar y preguntar).
2. Leer el plan → tomar `current_task_code`.
3. Leer ese task completo.
4. Imprimir **literalmente**:
   - Plan code + title + progreso
   - Tarea activa: code, short_task, status
   - **Prompt completo** de la tarea (para que Codex/otra IA lo retome sin leer nada más)
   - Acceptance + out_of_scope
   - Últimas 10 líneas de `notes` del plan

```json
{ "tool": "find", "collection": "action_plans", "filter": {"status": "IN_PROGRESS"} }
{ "tool": "find", "collection": "tasks", "filter": {"code": {"$regex": "^<current_task_code>$", "$options": "i"}} }
```

---

### `/plan next <code>` — Seleccionar próximo task ejecutable

Calcula el próximo task *ready*: `PENDING` + todas sus `depends_on` en estado `DONE`.

1. Leer todos los tasks del plan.
2. Construir set `doneCodes = {tasks con status DONE}`.
3. Filtrar: `status == "PENDING" AND depends_on.every(d => doneCodes.has(d))`.
4. Sort: `severity` (CRITICAL primero) → `order_hint` asc → `code`.
5. Tomar el primero. Si no hay, reportar "sin tareas ready" (revisar BLOCKED/IN_PROGRESS).
6. Marcar el elegido como `IN_PROGRESS` (`update-many` + `$set`, ver Patrón de mutación).
7. Actualizar el plan: `current_task_code = <elegido>`, `status = "IN_PROGRESS"` si estaba en PLANNING, recalcular `progress`.
8. Mostrar el task completo con prompt.

---

### `/plan done <task_code>` — Completar tarea

1. Leer el task.
2. Marcarlo `DONE` vía `update-many` + `$set` (`status`, `updated_at`, `completed_at`).
3. Recalcular `progress` del plan (count por status).
4. Limpiar `current_task_code` del plan (queda null hasta el próximo `/plan next`).
5. Si `progress.done == progress.total` → marcar plan como `DONE` con `completed_at`.
6. **Reportar la sesión al Ledger** (insert en `nostromo_cortex.agent_runs`). El panel Ledger valida cada doc con Zod y **una sola fila malformada rompe TODA la lista**. Campos **obligatorios**: `id` (string, formato `run-<uuid>`), `agent_slug`, `started_at` (ISO), `ended_at` (ISO), `task_codes` (array), `files_touched` (array — NO `files`), `commits` (array), `status` (`"completed"`/`"failed"`), `created_at`, `updated_at`. Doc mínimo válido:

```json
{
  "id": "run-<uuid>",
  "agent_slug": "<agente>",
  "started_at": "<ISO_INICIO>",
  "ended_at": "<ISO_FIN>",
  "task_codes": ["<task_code>"],
  "files_touched": ["ruta/uno", "ruta/dos"],
  "commits": ["<hash>"],
  "status": "completed",
  "created_at": "<ISO>",
  "updated_at": "<ISO>"
}
```

⚠️ Errores comunes que rompen el panel: omitir `id` o `started_at`, o usar `files` en vez de `files_touched`. Sin este paso (o con un doc malformado) el Ledger no carga.
7. Sugerir al usuario: *"Ejecutar /plan next <plan_code> para seguir"*.

---

### `/plan block <task_code> <motivo>` — Bloquear

1. Task → `BLOCKED`, append motivo a `detail`.
2. Plan: recalcular `progress`, mantener `current_task_code` (el bloqueador sigue activo).
3. Append a `notes` del plan: `[ISO] BLOCKED <task_code>: <motivo>`.

---

### `/plan note <code> <texto>` — Append a bitácora del plan

```json
{
  "tool": "update-many",
  "filter": {"code": "<plan_code>"},
  "update": {
    "$set": {"updated_at": "<ISO>"},
    "$push": { }
  }
}
```

Para append a `notes`: leer el plan → concatenar `notes + "\n[ISO] <texto>"` en memoria → `update-many` con `$set: {notes: <texto completo>, updated_at: <ISO>}`. Nunca delete + re-insert.

---

### `/plan list` — Planes activos

```json
{ "tool": "find", "collection": "action_plans",
  "filter": {"status": {"$in": ["PLANNING", "IN_PROGRESS", "PAUSED"]}},
  "sort": {"updated_at": -1} }
```

Imprimir tabla: `code · title · status · progress (X/Y) · current_task · updated_at`.

---

### `/plan archive <code>` — Archivar

Solo plans en `DONE`. Setea `status: "ARCHIVED"`. Tasks permanecen intactos en la colección para histórico.

---

## Patrón de mutación: `update-many` + `$set` (crítico)

⚠️ **NUNCA usar delete + re-insert para mutar `tasks` ni `action_plans`.** Ese patrón ya causó pérdida irrecuperable de documentos (prompts completos de tasks). Toda mutación es `update-many` con `$set` por campo: solo los campos que cambian van en el `$set`, el resto del documento queda intacto en Mongo.

```json
{
  "tool": "update-many",
  "database": "nostromo_cortex",
  "collection": "tasks",
  "filter": { "code": "SEV-S5a" },
  "update": {
    "$set": { "status": "DONE", "updated_at": "<ISO_NOW>" }
  }
}
```

Reglas:
- Filtrar siempre por `code` (tasks) o `code` (plan) — campo único.
- Verificar `matchedCount: 1` en el resultado. Si matchea 0, revisar case del filtro antes de reintentar.
- Transiciones multi-doc (ej: task A → DONE, task B → IN_PROGRESS, plan actualizado) son simplemente N llamadas `update-many` independientes, una por doc. No hay nada que "preservar" porque nada se borra.
- `delete-many` solo se usa para eliminar de verdad (y eso casi nunca pasa — archivar es `$set` de status).

---

## Recálculo de `progress`

Después de CADA transición de estado de un task:

```js
const tasks = find({plan_code: <code>})
const progress = {
  total: tasks.length,
  pending: tasks.filter(t => t.status === 'PENDING').length,
  in_progress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
  blocked: tasks.filter(t => t.status === 'BLOCKED').length,
  done: tasks.filter(t => t.status === 'DONE').length,
  failed: tasks.filter(t => t.status === 'FAILED').length
}
```

Aplicar al plan vía `update-many` + `$set: {progress: <objeto completo>, updated_at: <ISO>}`.

---

## Integración con Cortex (visualizador PERT)

- Cortex (`c:\dev\Cortex`) lee directo de `nostromo_cortex.tasks` y grafica DAG jerárquico con dagre + cytoscape.
- Los campos `plan_code`, `prompt`, `acceptance`, `out_of_scope` fueron agregados como opcionales en `packages/core/src/types.ts` y `schema.ts` — Cortex los ignora en el grafo pero los conserva.
- Para ver un plan completo en Cortex: filtrar por `project` (el project del plan coincide con el de sus tasks).
- NUNCA escribir `status: "COMPLETED"` — Cortex solo conoce `DONE` y `FAILED`.

---

## Buenas prácticas

- **`code` de task** = `<PLAN_PREFIX>-<SUB>`: p.ej. `SEV-S5a`, `SEV-S5b` dentro de plan `SEV-POSTREFACTOR`.
- **`prompt`**: autocontenido. Debe incluir contexto mínimo (paths, stack, PREREQUISITE, TASK numerado, ACCEPTANCE, OUT OF SCOPE). Una IA fría lo debe poder ejecutar.
- **`depends_on`**: solo dependencias duras (bloqueos reales). Orden débil va en `order_hint`.
- **`duration_estimate`**: horas estimadas. Es lo que habilita camino crítico en Cortex.
- **Al iniciar sesión**: ejecutar `/plan list` o `/plan resume` antes de tocar código.
- **Al cerrar sesión**: si hay task IN_PROGRESS, append a `notes` del plan con el estado actual (`[ISO] Pausa sesión: SEV-S5a 60% — falta tests unitarios`).
- **No mezclar con `/tareas`**: `/tareas` es para tareas sueltas sin plan. `/plan` es para grupos coordinados con DAG.
