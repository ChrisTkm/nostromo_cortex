// Flow-gap "sección sin cerrar": la función no termina en return.
// Sintaxis válida → ESLint, Prettier y el TS server de VS Code no reportan nada,
// pero Script Flow marca el nodo con un flow-gap ("no explicit return").
//
// Contraste a propósito: `enrich` SÍ cierra (tiene return); `trackEvent` y
// `record` quedan abiertas.

export function trackEvent(name: string, value: number) {
  const enriched = enrich(name, value);
  if (enriched.value > 0) {
    record(enriched);
  }
  // sin return → el flujo de trackEvent queda abierto (+ if sin else)
}

function enrich(name: string, value: number) {
  return { name, value, at: Date.now() };
}

function record(event: { name: string; value: number; at: number }) {
  console.log(event.name, event.value, event.at);
  // sin return → record también queda abierta
}
