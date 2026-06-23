# Auto-Run: registro automático de agent_runs

## Resumen

Cuando una tarea se marca como `DONE` en la UI de Cortex, el extension host crea automáticamente un documento en `agent_runs` con `status: "completed"` y los metadatos básicos (task_code, agent, timestamps). Cuando una IA termina una tarea, debe usar el MCP tool `task_complete`: esa tool marca la tarea `DONE`/`FAILED` y completa el run con datos reales de la sesión (tokens, files, commits). `record_run` queda para reportes manuales que no cambian el estado de la tarea.

## Flujo

```
Usuario marca task DONE en UI
  → extension host: ensureDoneTaskRun()
    → crea agent_run con datos mínimos, id = task-{code}-{uuid}
    → status: "completed"

Agente IA finaliza trabajo
  → llama MCP tool task_complete(code, agent_slug, tokens_in, tokens_out, files, commits)
    → writeAgentRun() busca en agent_runs por task_codes
    → encuentra el auto-run → lo actualiza (merge de datos)
    → si no encuentra → inserta nuevo (comportamiento normal)
```

## writeAgentRun — búsqueda por task_codes

Cuando `task_complete` o `record_run` se invoca sin `id` pero con `task_codes`, `writeAgentRun` busca un documento existente en `agent_runs` cuyo `task_codes` incluya alguno de los códigos provistos. Si lo encuentra, actualiza ese registro en vez de insertar uno nuevo. Esto permite que el agente complete el auto-run creado por la UI.

Si encuentra un run legacy insertado directo en Mongo sin `id` o con `files` en vez de `files_touched`, Cortex lo adopta: asigna un `id`, migra `files` a `files_touched` y evita duplicar la fila.

## Uso desde un agente IA

```json
// 1. Al empezar una task (opcional, marca IN_PROGRESS)
// MCP tool: task_start
{
  "agent_slug": "big-pickle",
  "task_codes": ["AR-01"]
}

// 2. Al terminar, cerrar task y completar el run
// MCP tool: task_complete
{
  "code": "AR-01",
  "agent_slug": "big-pickle",
  "tokens_in": 8500,
  "tokens_out": 1200,
  "files": ["apps/mcp-server/src/index.ts", "apps/vscode-extension/src/service.ts"],
  "commits": ["abc123"],
  "status": "completed"
}
```

No insertar documentos directos en `agent_runs`. El schema persistido usa `id` autogenerado y `files_touched`; el parámetro MCP se llama `files` sólo como input normalizado por el server.

## ensureDoneTaskRun

`service.ts` — método privado que:
1. Busca si ya existe un run para `task_codes: [task.code]`
2. Si existe → lo actualiza
3. Si no → inserta uno nuevo con id `task-{code}-{uuid}`
4. Retorna el ID del run creado/actualizado

Independientemente de quién cree el run primero (UI o MCP), el segundo en llegar lo encuentra y completa.
