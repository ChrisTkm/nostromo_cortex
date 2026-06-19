// Abre este archivo en Script Flow para ver warnings de loops como notas.
// Esperado: cada loop vacio recibe una flecha/nota con color de loop.

export function idle() {
  for (const item of []) {}
  while (true) {}
  return 1;
}
