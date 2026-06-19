import type { ScriptFlowAutoObservation } from "../../scriptFlow/types.js";

export function getScriptFlowFixHint(observation: ScriptFlowAutoObservation) {
  const message = observation.message.toLowerCase();
  if (message.includes("no explicit return")) {
    return "Agrega un return explícito en todos los caminos de salida.";
  }
  if (message.includes("no explicit else")) {
    return "Cubre el caso contrario con else, early return o una salida explícita.";
  }
  if (message.includes("no default path")) {
    return "Agrega default o documenta por qué todos los casos ya están cubiertos.";
  }
  if (message.includes("unreachable")) {
    return "Mueve o elimina el bloque que quedó después de una salida terminal.";
  }
  if (message.includes("catch block is empty")) {
    return "Registra, relanza o maneja el error para que no se pierda silencio.";
  }
  if (message.includes("loop body is empty") || message.includes("pass-only")) {
    return "Agrega trabajo real al loop o explica la espera con una condición clara.";
  }
  if (message.includes("broad except") || message.includes("baseexception")) {
    return "Captura una excepción más específica y deja visible el manejo esperado.";
  }
  if (message.includes("unused cte")) {
    return "Usa el CTE en la consulta final o elimínalo si quedó obsoleto.";
  }
  if (message.includes("select *")) {
    return "Enumera columnas para evitar acoplar el flujo a cambios de esquema.";
  }
  if (message.includes("cartesian")) {
    return "Agrega una condición ON/WHERE si el cruce no es intencional.";
  }
  if (observation.severity === "warning") {
    return "Revisa si este patrón es intencional y deja explícita la intención.";
  }
  if (observation.severity === "error") {
    return "Corrige este punto antes de confiar en el flujo resultante.";
  }
  return "Úsalo como nota de revisión para mejorar legibilidad o mantenimiento.";
}
