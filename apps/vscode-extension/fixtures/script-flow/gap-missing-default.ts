// Flow-gap: switch sin default ("Switch has no default path").
// La regla `default-case` no está activa, así que ESLint no se queja;
// Prettier y VS Code tampoco. Solo Script Flow lo marca como sección abierta.

export function route(command: string) {
  switch (command) {
    case "start":
      return "launched";
    case "stop":
      return "halted";
    case "pause":
      return "suspended";
  }
  return "idle";
}
