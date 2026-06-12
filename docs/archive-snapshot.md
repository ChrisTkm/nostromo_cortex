# Shape del JSON snapshot del archive

Cada plan archivado produce un archivo JSON en `<archivePath>/plans/<code>.json` con esta estructura:

```json
{
  "archived_at": "ISO 8601 UTC",
  "plan": { /* documento completo de action_plans en el momento del archive */ },
  "tasks": [ /* documentos de tasks asociadas (plan_code == plan.code) */ ],
  "notes": [ /* documentos de notes vinculadas por plan_code o task_code */ ],
  "logs": [ /* documentos de logs vinculados por plan_code o task_code, sort timestamp asc */ ]
}
```

## Vinculación de `logs`

Según `docs/log-contract.md`, los campos obligatorios de un log son `execution_id, timestamp, tag, class, method, title, message, level`. **`plan_code` y `task_code` NO son obligatorios** — son extensiones opcionales que algunos producers Python agregan.

La query del snapshot busca logs con cualquiera de estos campos:

```js
{ $or: [
  { plan_code: "<plan.code>" },
  { task_code: { $in: [...taskCodes] } }
]}
```

Si ninguno de los logs trae esos campos extras, `logs` queda como `[]`. Es lo esperado, no es un bug.

## Efectos secundarios

- `action_plans`/`tasks`/`notes` se **mueven** a las collections `archived_*`.
- `logs` **no se mueven** ni se borran — quedan en la collection activa como histórico.
- El JSON snapshot se conserva en disco aunque después se restaure el plan via `cortex.restorePlan` (CMP-ARCH-03) — actúa como backup adicional.
