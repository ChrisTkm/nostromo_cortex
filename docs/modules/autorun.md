# Auto-Run: registro automático de agent_runs

## Resumen

Cuando una tarea se marca como `DONE` en la UI de Cortex, el extension host crea automáticamente un documento en `agent_runs` con `status: "completed"` y los metadatos básicos (task_code, agent, timestamps). Luego, el agente IA puede completar ese registro con datos reales de la sesión (tokens, files, commits) mediante el MCP tool `record_run`.

## Flujo

```
Usuario marca task DONE en UI
  → extension host: ensureDoneTaskRun()
    → crea agent_run con datos mínimos, id = task-{code}-{uuid}
    → status: "completed"

Agente IA finaliza trabajo
  → llama MCP tool record_run(task_codes=[code], tokens_in, tokens_out, files, commits)
    → writeAgentRun() busca en agent_runs por task_codes
    → encuentra el auto-run → lo actualiza (merge de datos)
    → si no encuentra → inserta nuevo (comportamiento normal)
```

## writeAgentRun — búsqueda por task_codes

Cuando `record_run` se invoca sin `id` pero con `task_codes`, `writeAgentRun` busca un documento existente en `agent_runs` cuyo `task_codes` incluya alguno de los códigos provistos. Si lo encuentra, actualiza ese registro en vez de insertar uno nuevo. Esto permite que el agente complete el auto-run creado por la UI.

## Uso desde un agente IA

```json
// 1. Al empezar una task (opcional, marca IN_PROGRESS)
// MCP tool: task_start
{
  "agent_slug": "big-pickle",
  "task_codes": ["AR-01"]
}

// 2. Al terminar, completar el auto-run
// MCP tool: record_run
{
  "agent_slug": "big-pickle",
  "task_codes": ["AR-01"],
  "tokens_in": 8500,
  "tokens_out": 1200,
  "files": ["apps/mcp-server/src/index.ts", "apps/vscode-extension/src/service.ts"],
  "commits": ["abc123"],
  "status": "completed"
}
```

## ensureDoneTaskRun

`service.ts` — método privado que:
1. Busca si ya existe un run para `task_codes: [task.code]`
2. Si existe → lo actualiza
3. Si no → inserta uno nuevo con id `task-{code}-{uuid}`
4. Retorna el ID del run creado/actualizado

Independientemente de quién cree el run primero (UI o MCP), el segundo en llegar lo encuentra y completa.
