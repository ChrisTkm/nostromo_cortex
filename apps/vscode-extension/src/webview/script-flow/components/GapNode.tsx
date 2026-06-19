import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";

export type GapNodeData = {
  accentColor: string;
  message: string;
};

/**
 * Nodo "fantasma" que materializa un flow-gap: una nota de texto descriptiva a
 * la que apunta una flecha con el color del mensaje. No es un nodo del análisis
 * (no tiene range ni se selecciona); es pura señal visual.
 */
export function GapNode({ data }: NodeProps<Node<GapNodeData>>) {
  return (
    <div
      className="sf-gap-note"
      style={{ "--sf-gap-color": data.accentColor } as CSSProperties}
      title={data.message}
    >
      <Handle
        className="sf-gap-note__handle"
        position={Position.Left}
        type="target"
      />
      <span aria-hidden="true" className="sf-gap-note__icon">
        ⚠
      </span>
      <span className="sf-gap-note__text">{data.message}</span>
    </div>
  );
}
