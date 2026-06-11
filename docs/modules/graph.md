# PERT Graph

Panel webview con el grafo dirigido de tareas y dependencias. React Flow + Dagre, con drawer lateral (inspector + filtros), plan banner y orphan warnings. Es la superficie visual del mismo `TaskGraph` que alimenta el [[task]] Navigator.

## Propósito

Resuelve el límite del sidebar: **ver de un vistazo qué bloquea a qué**. Cuando hay 30+ tareas con dependencias cruzadas, leer "depends_on" en un tooltip no alcanza — necesitas el grafo dibujado.

Lo que aporta concretamente:

- **Frontera activa**: las edges DONE → PENDING/IN_PROGRESS se animan en color acento. De un vistazo ves dónde está el "filo" del trabajo.
- **Plan banner + foco al `current_task_code`**: cuando el plan tiene `currentTaskCode`, el grafo hace fit-view sobre esa tarea automáticamente.
- **Orientación LR/TB** intercambiable según prefieras leer ranks de izquierda-derecha o arriba-abajo.
- **Inspector lateral** con metadata completa de la tarea seleccionada (prompt, acceptance, outOfScope, dependsOn navegables) que el sidebar no muestra.
- **Filtros visuales** que aplican tanto al grafo como al sidebar (compartido en `workspaceState`).
- **Orphan warnings** banner clickeable que vuelca al Output channel todas las dependencias hacia tareas inexistentes.

Es el panel de **análisis y revisión**: lo abres cuando quieres entender el estado del trabajo, no cuando vas a marcar 3 tareas como done.

## Modelo de datos

`GraphSnapshot` (definido en `packages/core/src/types.ts:192-213`) es lo que viaja por el message channel del webview:

| Campo              | Tipo                        | Notas                                                                                                                                                                        |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generatedAt`      | string ISO                  | Útil para versionar payloads y debug.                                                                                                                                        |
| `filters`          | `TaskFilter`                | El filtro aplicado (echo). Permite al webview saber qué se pidió.                                                                                                            |
| `nodes`            | `SnapshotNode[]`            | Subset de `TaskRecord` + `ready`, `blockedByCount`, `downstreamCount`, `tooltip`.                                                                                            |
| `edges`            | `SnapshotEdge[]`            | `{ id, source, target }`. Filtradas a edges cuyos extremos sean visibles.                                                                                                    |
| `stats`            | objeto                      | Contadores: `taskCount`, `edgeCount`, `readyCount`, `blockedCount`, `cycleCount`, `done/inProgress/pending/failedCount`, `totalEstimatedDuration`, `readyEstimatedDuration`. |
| `cycles`           | `CycleInfo[]`               | Ciclos detectados (paths y mensaje).                                                                                                                                         |
| `warnings.orphans` | `OrphanDependencyWarning[]` | Dependencias hacia códigos inexistentes.                                                                                                                                     |
| `planContext`      | `ActionPlanRecord?`         | Solo si `filter.planCode` coincide con el plan provisto (`graph.ts:356`).                                                                                                    |

El payload completo del `postMessage` además trae: `plans`, `planTasks` (mini-resumen por plan), `totals`, `state` (orientation/showMiniMap/zoom/pan/selectedTaskCode), `connection`, `filters`, `catalog`.

## Flujo de uso

```mermaid
flowchart TD
    Trigger([Usuario: Open PERT Graph])
    Trigger -->|Sidebar item icon| Open[openGraph]
    Trigger -->|Command palette| Open
    Trigger -->|Switch panel| Open

    Open --> Create{¿graphPanel<br/>existe?}
    Create -->|No| Build[createWebviewPanel<br/>+ getGraphHtml]
    Create -->|Sí| Reveal[panel.reveal]
    Build --> Reveal
    Reveal --> Ready[webview postMessage 'ready']
    Ready --> Post[postSnapshot]

    Post --> Load[loadBundle: tasks+plans]
    Load --> Resolve[resolveSelectedPlanCode<br/>+ resolveSelectedTaskCode]
    Resolve --> Sanitize[sanitizeFilterState]
    Sanitize --> Snap[buildGraphSnapshot]
    Snap --> PostMsg[postMessage snapshot]
    PostMsg --> Render[App: useEffect onMessage]

    Render --> Layout[computeLayout<br/>Dagre LR/TB]
    Layout --> RF[React Flow render]
    RF --> Wait{Acción usuario}

    Wait -->|Click nodo| Sel[selectTask + drawer]
    Wait -->|Filtro toolbar| FilterEv[updateFilter -> postSnapshot]
    Wait -->|Cambia plan| PlanEv[selectPlan -> postSnapshot]
    Wait -->|Drag/zoom| VP[viewportChanged -> updateFilterState]
    Wait -->|LR/TB toggle| Ori[orientationChanged]
    Wait -->|Edit task en drawer| EditEv[editTask en extension host]
    Wait -->|Click orphan banner| Orph[showOrphanWarnings al Output]

    Sel --> Drawer[Drawer: Inspector tab]
    EditEv --> Post
    FilterEv --> Post
    PlanEv --> Post
    Ori --> RF
```

## Arquitectura técnica

```mermaid
flowchart LR
    subgraph ExtHost[Extension Host]
        OpenG[openGraph<br/>extension.ts:608]
        PostS[postSnapshot<br/>extension.ts:124]
        Build[buildGraphSnapshot<br/>core/graph.ts:296]
        Resolve[resolveSelectedPlanCode<br/>+ Task code<br/>+ sanitizeFilterState]
        State[(workspaceState<br/>cortex.filterState)]
        Tel[recordInteraction<br/>graph_snapshot]
    end

    subgraph WebView[Webview React IIFE]
        App[App.tsx<br/>state top-level]
        Toolbar[Toolbar.tsx<br/>filtros + plan]
        Banner[PlanBanner.tsx]
        GraphC[Graph.tsx<br/>React Flow]
        Layout[layout.ts<br/>Dagre]
        Node[TaskNode.tsx]
        Drawer[Drawer.tsx<br/>Inspector + Filters]
        Viewer[ActionPlanViewer<br/>modal]
        Status[StatusBar.tsx]
    end

    OpenG --> PostS
    PostS --> Build
    PostS --> Resolve
    Resolve --> State
    PostS -->|postMessage snapshot| App
    App --> Toolbar
    App --> Banner
    App --> GraphC
    App --> Drawer
    App --> Viewer
    App --> Status
    GraphC --> Layout
    GraphC --> Node
    App -->|postMessage events| PostS
    PostS --> Tel
```

**Puntos clave del flujo de datos**:

- El webview hace `vscode.postMessage({ type: "ready" })` al montar (`App.tsx:85`). El extension host responde con el snapshot inicial. Sin "ready", nunca llega data.
- Cada cambio de filtro o plan dispara **un round-trip completo**: extension host recalcula y reenvía snapshot entero. No hay diff/patch.
- El layout (`computeLayout` en `lib/layout.ts:10`) corre **en el webview** con Dagre, no en el extension host. La capa de presentación es independiente.
- Viewport (zoom + pan) se persiste en `workspaceState` con clamp 0.2–2.8 (`service.ts:118`).
- Se registra `recordInteraction("graph_snapshot", ...)` con `payload_size_bytes` para telemetría (`extension.ts:190`).

## Fortalezas

1. **Separación clara host/webview**. El host construye el snapshot puro; el webview se encarga solo de presentar. El message channel es el único contrato.
2. **CSP estricta** en el HTML (`webview/html.ts`). `default-src 'none'`, nonce por script, sin `unsafe-eval`. Buena base de seguridad para marketplace.
3. **Frontera activa animada** (`Graph.tsx:62-77`). Las edges DONE → PENDING/IN_PROGRESS se distinguen visualmente — affordance que el sidebar no tiene.
4. **`current-task` highlight** (`TaskNode.tsx:38`) + auto-fit-view (`Graph.tsx:122-137`) cuando el plan tiene `currentTaskCode`. Convierte el plan en una "guía" visual.
5. **Layout Dagre con `nodesep: 56, ranksep: 100`**, márgenes razonables. No es trivial calibrar; lo que está se ve limpio.
6. **`retainContextWhenHidden: true`** mantiene el estado del webview al cambiar de tab. No tienes que esperar relayout al volver.
7. **Mini map con color por status** (`Graph.tsx:156`) — orientación rápida en grafos grandes.
8. **Drawer con Inspector + Filters tabs** + `Escape` para colapsar. UX moderno, no rompe contexto.
9. **Telemetría con `payload_size_bytes`** ya implementada. Útil para detectar cuando un snapshot empieza a ser pesado.
10. **Orphan warnings clickeables** que vuelcan al Output channel. Buen feedback sin invadir la vista.

## Debilidades y problemas detectados

### Bugs y comportamientos confusos

1. **El payload incluye `connection` con `mongoUrl`** completo enviado al webview (`extension.ts:184`). Si la URL contiene credenciales (`mongodb://user:pass@host`), quedan accesibles al runtime del webview. El webview es código propio, no untrusted, pero igual: principio de menor exposición. La URL no se usa en el webview salvo para info display.
2. **`buildPlanTasks` solo trae fields básicos** (`extension.ts:1133`): code, durationEstimate, label, lane, severity, status. **Sin `dependsOn`**. El `ActionPlanViewer` no puede mostrar bloqueos del plan.
3. **`onMoveEnd` postea `viewportChanged` por cada gesto terminado** (`Graph.tsx:150`). Cada pan + zoom = 1 `workspaceState.update`. No hay debounce. Por sesión normal son 50–100 escrituras al state.
4. **`computeLayout` corre en cada cambio de snapshot**, no solo cuando cambia la estructura del grafo. Si solo cambias el status de una tarea, igual recalcula Dagre completo (`Graph.tsx:80-90`).
5. **`planContext` requiere que `filter.planCode === context.plan.code`** (`graph.ts:356`). Si por race condition se envía un plan distinto al filtro vigente, `planContext` queda undefined y el banner desaparece sin explicación.

### UX

6. **No hay swimlanes**. El campo `lane` existe en el modelo y se muestra en `TaskNode`, pero Dagre no lo usa para agrupar. Tareas de la misma lane quedan dispersas por ranks de dependencia.
7. **No hay critical path overlay**. `criticalPathEstimate` (`graph.ts:360`) está implementado y testeado, nunca se renderiza. Es una capacidad latente que ya pagaste.
8. **No hay export PNG/SVG** del grafo. Script Flow sí exporta PNG (`ScriptFlowApp.tsx:426`). Inconsistencia y feature obvio que faltaría.
9. **No hay búsqueda "centrar en tarea X"** en el grafo. Solo `Ctrl+K` para foco al campo de búsqueda del toolbar (que filtra, no centra). El sidebar tiene click-para-foco, el grafo no.
10. **El mensaje vacío no distingue causas**: "No tasks match the current filters" se muestra tanto si no hay tareas en la base como si los filtros las ocultan (`App.tsx:253`). El usuario nuevo cree que el panel está roto.
11. **`PlanBanner` ocupa espacio fijo** arriba del grafo. En layouts angostos (panel lateral o monitor pequeño) consume vertical.
12. **Sin multi-select**. No puedes seleccionar 3 nodos y aplicar acción en batch ("mark all done").
13. **No hay tooltip de edge**. Si X bloquea a Y, hover sobre la edge no dice nada.
14. **TaskNode no muestra `durationEstimate` ni `tags`** aunque el snapshot los trae. El nodo solo muestra code + status + label + lane + severity dot.
15. **No hay visual distinto para `blockedByCount > 0`** que no sea consultar el drawer. Una tarea con 5 bloqueadores se ve igual que una sin ninguno.

### Lógica

16. **`fitView` y `setViewport` compiten en un solo useEffect** (`Graph.tsx:92-103`). Si llega snapshot nuevo con zoom persistido, hace `setViewport`; si no, `fitView`. Pero cualquier re-render que cambie alguna dep dispara el efecto. En la práctica funciona pero es flaky.
17. **`recordInteraction("graph_snapshot")`** se invoca dentro de `postSnapshot` (`extension.ts:190`) → si el panel está abierto y cambias filtros 10 veces, son 10 eventos de telemetría. Razonable, pero antes de marketplace conviene agrupar por sesión.
18. **El `selectedTaskCode` se persiste en workspaceState** pero al limpiar filtros (`extension.ts:674`) sí se borra, mientras que al cambiar plan también (`extension.ts:632`). Buena consistencia, pero al volver al panel sin filtros, el último seleccionado queda sticky — puede confundir.
19. **No hay invalidación de filtros incompatibles con planContext**. Si seleccionas plan A y luego cambias `selectedGroups` a un grupo que no existe en A, el grafo queda vacío sin avisar.

### Proceso / publicación

20. **Sin telemetría agregada** de uso del Graph. `payload_size_bytes` se registra por snapshot, pero no hay agregación tipo "p95 de tamaño de payload" o "tiempo medio entre apertura y primera interacción". Útil para decidir cuándo virtualizar.
21. **No hay screenshots ni assets** del panel en `assets/` o `docs/`. Marketplace listing necesita capturas.
22. **No hay test del flujo "ready → snapshot → render"**. Webview tests son difíciles, pero al menos un test de contrato sobre la forma del payload (`postMessage` matches `SnapshotMessage` shape) cubriría regresiones.

## Mejoras propuestas

### Técnicas

- **No mandar `connection.mongoUrl` al webview**. Cambiar a `connection: { dbName, tasksCollection, plansCollection, notesCollection, logsCollection }`. El webview no usa la URL en ninguna parte funcional, solo info display.
- **Debounce de `viewportChanged`** a 150–300ms. Reduce escrituras al state durante drags largos.
- **Cachear `computeLayout`** por hash de `(snapshot.nodes.length + snapshot.edges.length + orientation)`. Si solo cambia status de un nodo, no relayout.
- **Diff/patch en lugar de full snapshot** cuando solo cambian propiedades de nodos existentes. El número de edges/nodos suele ser estable; lo que cambia es `status` y `ready`. El webview puede aplicar parches con `setNodes(prev => …)`.
- **Incluir `dependsOn` en `buildPlanTasks`** para que el `ActionPlanViewer` muestre el árbol de bloqueos.
- **Telemetría agregada por sesión**: contar interacciones del Graph en bucket de 60s en lugar de evento por snapshot.

### Visuales

- **Swimlanes por `lane`**. Dagre soporta clusters (`dagre.graphlib.Graph().setNode("lane:frontend", { ... })` con `setParent`). Implementar reagrupa nodos por lane sin perder el orden topológico.
- **Critical path overlay**. Cuando `criticalPathEstimate.available === true`, marcar las edges del path con color especial y mostrar `totalDuration` en el status bar.
- **Export PNG/SVG** vía `html-to-image` (ya está en deps por Script Flow). Botón en StatusBar.
- **Búsqueda y centrado por código**. Ctrl+Shift+G (o reusar Ctrl+K en modo "centrar") con autocomplete sobre `snapshot.nodes.code`.
- **Estado vacío diferenciado**: "no tasks in database — bootstrap sample?" vs "no tasks match filters — clear filters".
- **Mini-stats en TaskNode**: `blockedByCount` y `downstreamCount` como badges pequeños. Útil para identificar hotspots.
- **Tooltip de edge**: "S2.1 bloquea a S3 (S3 está PENDING)".
- **Modo "heatmap"** que colorea nodos por `downstreamCount` (más rojo = más downstream). Útil para identificar "tareas frontera".

### Lógicas

- **Refresh granular**: cuando se edita una sola tarea, mandar `{ type: "patch", task: SnapshotNode }` en lugar de regenerar todo el snapshot.
- **Multi-select**: `event.metaKey + click` para acumular nodos seleccionados; drawer cambia a modo "batch" con acciones aplicables.
- **Plan switcher en banner**: dropdown directo en `PlanBanner` para cambiar de plan sin pasar por la toolbar.
- **Limpiar `selectedTaskCode` si queda fuera del filtro vigente** (hoy queda sticky aunque el nodo no esté visible).

### Proceso / uso

- **3–5 screenshots del Graph** en `assets/screenshots/graph/` para README de marketplace.
- **Vídeo corto** (asciinema o GIF) mostrando frontera activa + plan focus + drawer.
- **Test de contrato** sobre el payload `postMessage`: dado un fixture de tareas, verificar que `snapshot.nodes`/`edges`/`stats` tienen la forma esperada.

## Próximos pasos sugeridos (orden propuesto)

1. **Quitar `mongoUrl` del payload al webview** — fix de seguridad, ~10 minutos.
2. **`dependsOn` en `buildPlanTasks`** — un cambio de 5 líneas que desbloquea el plan viewer con bloqueos.
3. **Debounce de viewport** — ~15 minutos, reduce escrituras al state ~80%.
4. **Cache de `computeLayout`** — ~30 minutos, ganancia clara cuando solo cambian status de nodos.
5. **Critical path overlay** — toda la lógica ya existe en core, solo hay que pasarla por el snapshot y pintarla. ~2h.
6. **Swimlanes por lane** — mayor cambio visual, ~3–4h con Dagre clusters.
7. **Export PNG/SVG** — ~1h con `html-to-image`.

## Tests existentes

- `packages/core/src/core.test.ts` cubre `buildGraphSnapshot`, `criticalPathEstimate`, ciclos, ruta crítica.
- `apps/vscode-extension/src/extension.test.ts` cubre `postSnapshot` con mocks (`as any`).
- `apps/vscode-extension/src/webview/components/Drawer.test.ts` — único test de componente del webview.

**Gaps**:

- Sin tests sobre `Graph.tsx` ni `App.tsx`.
- Sin tests sobre `computeLayout` (Dagre wrapper).
- Sin test de contrato sobre el payload `postMessage`.
- Sin test de "panel sin data" / "snapshot vacío".
