// Varias secciones "abiertas" en un solo archivo — pensado para probar TAMBIÉN
// las flechas nuevas del panel:
//   · la flecha del proceso main (entry → ingest) sale en cyan (acento del entry)
//   · al pinchar una función, su subgrafo se resalta y el resto se atenúa
//
// Todo resuelve y se usa, así que ni ESLint ni Prettier ni VS Code reportan nada;
// los huecos son puramente de flujo (sin return / if sin else).

export function ingest(lines: readonly string[]) {
  const cache = new Map<string, number>();
  for (const line of lines) {
    if (line.startsWith("#")) {
      cache.set(line, Date.now());
    }
    persist(line, cache.size);
  }
  // sin return → ingest queda abierta
}

export function persist(line: string, count: number) {
  const trimmed = line.trim();
  if (trimmed.length > 0) {
    console.log(trimmed, count);
  }
  // sin return + if sin else
}

function summarize(total: number) {
  return `processed ${total}`;
}

export function report(total: number) {
  return summarize(total);
}
