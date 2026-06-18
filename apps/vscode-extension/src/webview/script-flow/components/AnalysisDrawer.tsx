import { Fragment, useEffect, useMemo, useRef } from "react";

import {
  SCRIPT_FLOW_NODE_KINDS,
  type ScriptFlowAutoObservation,
  type ScriptFlowNode,
  type ScriptFlowNodeKind,
} from "../../../scriptFlow/types.js";
import { Button } from "../../components/atoms";
import { DrawerShell } from "../../components/molecules";
import { KIND_LABELS } from "./FlowNode";

type AnalysisDrawerProps = {
  nodes: ScriptFlowNode[];
  activeNodeId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
};

type NodeGroup = {
  kind: ScriptFlowNodeKind;
  label: string;
  items: ScriptFlowNode[];
};

export function AnalysisDrawer(props: AnalysisDrawerProps) {
  const { activeNodeId, isOpen, nodes, onClose, onSelectNode } = props;
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const groups = useMemo<NodeGroup[]>(() => {
    const byKind = new Map<ScriptFlowNodeKind, ScriptFlowNode[]>();
    for (const node of nodes) {
      const list = byKind.get(node.kind) ?? [];
      list.push(node);
      byKind.set(node.kind, list);
    }
    return SCRIPT_FLOW_NODE_KINDS.filter((kind) => byKind.has(kind)).map(
      (kind) => ({
        kind,
        label: KIND_LABELS[kind],
        items: byKind.get(kind) ?? [],
      }),
    );
  }, [nodes]);

  useEffect(() => {
    if (!isOpen || !activeNodeId) {
      return;
    }
    itemRefs.current.get(activeNodeId)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeNodeId, isOpen]);

  const header = (
    <>
      <div className="drawer-header__code">OUTLINE</div>
      <h2 className="drawer-header__title">{nodes.length} nodos</h2>
    </>
  );

  const actions = (
    <Button className="is-active" intent="change" size="small">
      Nodos
    </Button>
  );

  return (
    <DrawerShell actions={actions} header={header} isOpen={isOpen} onClose={onClose}>
      {groups.length === 0 ? (
        <div className="drawer-empty">El script no tiene nodos.</div>
      ) : (
        <div className="drawer-panel">
          {groups.map((group, index) => (
            <Fragment key={group.kind}>
              {index > 0 ? <div className="drawer-divider" /> : null}
              <section className="drawer-section drawer-section--spacious">
                <div className="drawer-section__label">
                  {group.label} · {group.items.length}
                </div>
                <div className="drawer-list drawer-list--stack">
                  {group.items.map((node) => (
                    <button
                      className={`drawer-link${
                        activeNodeId === node.id ? " is-active" : ""
                      }`}
                      key={node.id}
                      onClick={() => onSelectNode(node.id)}
                      ref={bindItemRef(itemRefs, node.id)}
                      title={node.label}
                      type="button"
                    >
                      <span>{node.label}</span>
                      <NodeSignalSummary node={node} />
                    </button>
                  ))}
                </div>
              </section>
            </Fragment>
          ))}
        </div>
      )}
    </DrawerShell>
  );
}

function NodeSignalSummary(props: { node: ScriptFlowNode }) {
  const observations = Array.isArray(props.node.meta?.autoObservations)
    ? (props.node.meta.autoObservations as ScriptFlowAutoObservation[])
    : [];
  if (observations.length === 0) {
    return null;
  }
  const hasError = observations.some((item) => item.severity === "error");
  const hasWarning = observations.some((item) => item.severity === "warning");
  return (
    <span
      className={`drawer-link__signals${
        hasError ? " drawer-link__signals--error" : hasWarning ? " drawer-link__signals--warning" : ""
      }`}
      title={observations.map((item) => item.message).join("\n")}
    >
      {observations.length}
    </span>
  );
}

function bindItemRef(
  refs: { current: Map<string, HTMLButtonElement> },
  key: string,
) {
  return (element: HTMLButtonElement | null) => {
    if (element) {
      refs.current.set(key, element);
      return;
    }
    refs.current.delete(key);
  };
}
