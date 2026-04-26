import { useEffect, useMemo, useRef } from "react";

import type { ScriptFlowAnalysis } from "../../../scriptFlow/types.js";

type DrawerSection = "summary" | "entryPoints" | "decisions" | "loops" | "observations";
type ActionableSection = Exclude<DrawerSection, "summary" | "observations">;

type AnalysisDrawerProps = {
  analysis: ScriptFlowAnalysis;
  nodeLabels: Map<string, string>;
  activeNodeId: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectNode: (nodeId: string, section: ActionableSection) => void;
};

type DrawerItemRefMap = Map<string, HTMLButtonElement>;

export function AnalysisDrawer(props: AnalysisDrawerProps) {
  const { activeNodeId, analysis, isCollapsed, nodeLabels, onSelectNode, onToggle } = props;
  const itemRefs = useRef<DrawerItemRefMap>(new Map());
  const activeKey = useMemo(() => resolveDrawerKey(analysis, activeNodeId), [activeNodeId, analysis]);
  const summaryLines = analysis.summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!activeKey) {
      return;
    }

    const element = itemRefs.current.get(activeKey);
    element?.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
  }, [activeKey]);

  return (
    <aside className={`script-flow-drawer${isCollapsed ? " script-flow-drawer--collapsed" : ""}`}>
      <div className="script-flow-drawer__header">
        <div>
          <div className="script-flow-drawer__eyebrow">Flow analysis</div>
          <h2 className="script-flow-drawer__title">Analysis</h2>
        </div>
        <button
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand analysis drawer" : "Collapse analysis drawer"}
          className="script-flow-drawer__toggle"
          onClick={onToggle}
          type="button"
        >
          <span className={`script-flow-drawer__chevron${isCollapsed ? "" : " script-flow-drawer__chevron--open"}`}>⌃</span>
        </button>
      </div>

      {!isCollapsed ? (
        <div className="script-flow-drawer__content">
          <section className="script-flow-drawer-section">
            <div className="script-flow-drawer-section__title">Resumen</div>
            <div className="script-flow-drawer-summary">
              {summaryLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </section>

          <section className="script-flow-drawer-section">
            <div className="script-flow-drawer-section__title">Entry points</div>
            <div className="script-flow-drawer-list">
              {analysis.entryPoints.length > 0 ? (
                analysis.entryPoints.map((nodeId) => (
                  <button
                    className={itemClassName(activeKey === `entryPoints:${nodeId}`)}
                    key={nodeId}
                    onClick={() => onSelectNode(nodeId, "entryPoints")}
                    ref={bindItemRef(itemRefs, `entryPoints:${nodeId}`)}
                    type="button"
                  >
                    <span>{nodeLabels.get(nodeId) ?? nodeId}</span>
                  </button>
                ))
              ) : (
                <div className="script-flow-drawer-empty">No entry points.</div>
              )}
            </div>
          </section>

          <section className="script-flow-drawer-section">
            <div className="script-flow-drawer-section__title">Decisiones</div>
            <div className="script-flow-drawer-list">
              {analysis.decisions.length > 0 ? (
                analysis.decisions.map((decision) => (
                  <button
                    className={itemClassName(activeKey === `decisions:${decision.nodeId}`)}
                    key={decision.nodeId}
                    onClick={() => onSelectNode(decision.nodeId, "decisions")}
                    ref={bindItemRef(itemRefs, `decisions:${decision.nodeId}`)}
                    type="button"
                  >
                    <span>{decision.label}</span>
                    <span className="script-flow-drawer-item__meta">{decision.branches} branch{decision.branches === 1 ? "" : "es"}</span>
                  </button>
                ))
              ) : (
                <div className="script-flow-drawer-empty">No decisions.</div>
              )}
            </div>
          </section>

          <section className="script-flow-drawer-section">
            <div className="script-flow-drawer-section__title">Loops</div>
            <div className="script-flow-drawer-list">
              {analysis.loops.length > 0 ? (
                analysis.loops.map((loop) => (
                  <button
                    className={itemClassName(activeKey === `loops:${loop.nodeId}`)}
                    key={loop.nodeId}
                    onClick={() => onSelectNode(loop.nodeId, "loops")}
                    ref={bindItemRef(itemRefs, `loops:${loop.nodeId}`)}
                    type="button"
                  >
                    <span>{loop.label}</span>
                    <span className="script-flow-drawer-item__meta">{loop.kind}</span>
                  </button>
                ))
              ) : (
                <div className="script-flow-drawer-empty">No loops.</div>
              )}
            </div>
          </section>

          <section className="script-flow-drawer-section">
            <div className="script-flow-drawer-section__title">Observaciones</div>
            <div className="script-flow-drawer-observations">
              {analysis.observations.length > 0 ? (
                analysis.observations.map((observation) => <p key={observation}>{observation}</p>)
              ) : (
                <div className="script-flow-drawer-empty">No observations.</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function resolveDrawerKey(analysis: ScriptFlowAnalysis, activeNodeId: string | null) {
  if (!activeNodeId) {
    return null;
  }
  if (analysis.entryPoints.includes(activeNodeId)) {
    return `entryPoints:${activeNodeId}`;
  }
  if (analysis.decisions.some((decision) => decision.nodeId === activeNodeId)) {
    return `decisions:${activeNodeId}`;
  }
  if (analysis.loops.some((loop) => loop.nodeId === activeNodeId)) {
    return `loops:${activeNodeId}`;
  }
  return null;
}

function bindItemRef(refs: { current: DrawerItemRefMap }, key: string) {
  return (element: HTMLButtonElement | null) => {
    if (element) {
      refs.current.set(key, element);
      return;
    }

    refs.current.delete(key);
  };
}

function itemClassName(isActive: boolean) {
  return `script-flow-drawer-item${isActive ? " script-flow-drawer-item--active" : ""}`;
}
