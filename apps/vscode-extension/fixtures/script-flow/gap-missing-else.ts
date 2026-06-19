// Flow-gap aislado: decisión sin rama else. La función SÍ cierra con return,
// así que el único hueco que marca Script Flow es el if sin else
// ("Branch has no explicit else path"). Limpio para ESLint/Prettier/VS Code.

export function classify(score: number) {
  let label = "low";
  if (score >= 80) {
    label = "high";
  }
  return label;
}
