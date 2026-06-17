import type {
  ScriptFlowAutoObservation,
  ScriptFlowNode,
} from "./types.js";

export function appendNodeObservation(
  node: ScriptFlowNode,
  observation: ScriptFlowAutoObservation,
) {
  const existing = Array.isArray(node.meta?.autoObservations)
    ? (node.meta.autoObservations as ScriptFlowAutoObservation[])
    : [];
  node.meta = {
    ...(node.meta ?? {}),
    autoObservations: [...existing, observation],
  };
}
