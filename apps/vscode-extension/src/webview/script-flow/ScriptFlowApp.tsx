import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import {
  isScriptFlowHostMessage,
  sendDrawerClick,
  sendReady,
  sendRefresh,
  sendSelectNode,
  type ScriptFlowHostMessage
} from "../../scriptFlow/bridge.js";
import { isScriptFlowSnapshot, type ScriptFlowNode, type ScriptFlowNodeKind, type ScriptFlowSnapshot } from "../../scriptFlow/types.js";
import { AnalysisDrawer } from "./components/AnalysisDrawer";
import { FlowNode, type FlowNodeData } from "./components/FlowNode";

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: unknown): void;
      setState(state: unknown): void;
      getState(): unknown;
    };
  }
}

const vscode = window.acquireVsCodeApi();
const nodeTypes = { scriptFlow: FlowNode };
const EMPTY_FLOW: { nodes: Array<Node<FlowNodeData>>; edges: Edge[] } = { nodes: [], edges: [] };
const NODE_WIDTH = 226;
const NODE_HEIGHT = 100;

const KIND_LABELS: Record<ScriptFlowNodeKind, string> = {
  entry: "Entry",
  function: "Function",
  branch: "Branch",
  loop: "Loop",
  tryCatch: "Try/Catch",
  return: "Return",
  call: "Call",
  cte: "CTE",
  select: "Select",
  join: "Join",
  subquery: "Subquery"
};

type ScriptFlowViewState =
  | {
      status: "empty";
      title: string;
      description: string;
    }
  | {
      status: "unsupported";
      title: string;
      description: string;
      language?: string;
    }
  | {
      status: "error";
      title: string;
      description: string;
    }
  | {
      status: "snapshot";
      title: string;
      description: string;
      snapshot: ScriptFlowSnapshot;
    };

const defaultState: ScriptFlowViewState = {
  status: "empty",
  title: "Waiting for Script Flow",
  description: "Open a TypeScript, Python, or SQL file to inspect its flow in the extension host."
};

export function ScriptFlowApp() {
  const [state, setState] = useState<ScriptFlowViewState>(() => {
    const persisted = vscode.getState();
    return isScriptFlowState(persisted) ? persisted : defaultState;
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    state.status === "snapshot" ? getPreferredNodeId(state.snapshot) : null
  );
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);
  const [isNarrowLayout, setIsNarrowLayout] = useState(() => window.innerWidth < 800);
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(() => window.innerWidth < 800);

  const flow = useMemo(() => {
    if (state.status !== "snapshot") {
      return EMPTY_FLOW;
    }

    return buildFlowModel(state.snapshot, selectedNodeId);
  }, [selectedNodeId, state]);

  const nodeLabels = useMemo(() => {
    if (state.status !== "snapshot") {
      return new Map<string, string>();
    }

    return new Map(state.snapshot.nodes.map((node) => [node.id, node.label]));
  }, [state]);

  const selectedNode =
    state.status === "snapshot"
      ? state.snapshot.nodes.find((node) => node.id === selectedNodeId) ??
        state.snapshot.nodes.find((node) => node.id === state.snapshot.analysis.entryPoints[0]) ??
        state.snapshot.nodes[0] ??
        null
      : null;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 800px)");
    const syncLayout = (matches: boolean) => {
      setIsNarrowLayout(matches);
      setIsDrawerCollapsed(matches);
    };

    syncLayout(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => syncLayout(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>) {
      const message = event.data;
      if (!isScriptFlowHostMessage(message)) {
        return;
      }

      const nextState = mapMessageToState(message);
      setSelectedNodeId(nextState.status === "snapshot" ? getPreferredNodeId(nextState.snapshot) : null);
      setState(nextState);
      vscode.setState(nextState);
    }

    window.addEventListener("message", onMessage);
    sendReady(vscode);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (state.status !== "snapshot" || !flowInstance || !selectedNodeId) {
      return;
    }

    const target = flow.nodes.find((node) => node.id === selectedNodeId);
    if (!target) {
      return;
    }

    flowInstance.setCenter(target.position.x + NODE_WIDTH / 2, target.position.y + NODE_HEIGHT / 2, {
      zoom: isNarrowLayout ? 0.9 : 1,
      duration: 220
    });
  }, [flow.nodes, flowInstance, isNarrowLayout, selectedNodeId, state.status]);

  return (
    <div className={`script-flow-app script-flow-app--${state.status}`}>
      <header className="script-flow-header">
        <div>
          <div className="script-flow-header__eyebrow">Extension host analyzer</div>
          <h1 className="script-flow-header__title">Script Flow</h1>
        </div>
        <div className="script-flow-header__actions">
          <button className="script-flow-button" onClick={() => sendRefresh(vscode)} type="button">
            Refresh flow
          </button>
        </div>
      </header>

      <main className="script-flow-surface">
        <section className="script-flow-panel">
          <div className="script-flow-panel__eyebrow">Bridge output</div>
          {state.status === "snapshot" ? (
            <>
              <h3 className="script-flow-panel__title">Live TypeScript flow</h3>
              <p className="script-flow-panel__text">Click a node or drawer item to jump to code and keep the flow centered.</p>
              <dl className="script-flow-meta">
                <div className="script-flow-meta__item">
                  <dt>File</dt>
                  <dd>{state.snapshot.metadata.path}</dd>
                </div>
                <div className="script-flow-meta__item">
                  <dt>Language</dt>
                  <dd>{state.snapshot.metadata.language}</dd>
                </div>
                <div className="script-flow-meta__item">
                  <dt>Nodes</dt>
                  <dd>{state.snapshot.nodes.length}</dd>
                </div>
                <div className="script-flow-meta__item">
                  <dt>Edges</dt>
                  <dd>{state.snapshot.edges.length}</dd>
                </div>
              </dl>
              {selectedNode ? (
                <div className="script-flow-detail-card">
                  <div className="script-flow-detail-card__eyebrow">{KIND_LABELS[selectedNode.kind]}</div>
                  <div className="script-flow-detail-card__title">{selectedNode.label}</div>
                  {selectedNode.range ? <div className="script-flow-detail-card__text">{formatRangeLabel(selectedNode)}</div> : null}
                </div>
              ) : null}
              <div className="script-flow-canvas">
                <ReactFlow
                  fitView
                  edges={flow.edges}
                  nodes={flow.nodes}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  onInit={setFlowInstance}
                  onNodeClick={(_, node) => {
                    setSelectedNodeId(node.id);
                    sendSelectNode(vscode, node.id);
                  }}
                  proOptions={{ hideAttribution: true }}
                >
                  <Controls />
                  <MiniMap pannable zoomable nodeColor={(node) => colorForKind((node.data as FlowNodeData).kind)} />
                  <Background color="rgba(148, 163, 184, 0.18)" gap={18} size={1} variant={BackgroundVariant.Dots} />
                </ReactFlow>
              </div>
            </>
          ) : null}
          {state.status === "empty" ? (
            <>
              <h3 className="script-flow-panel__title">Open a supported source file to render its flow.</h3>
              <p className="script-flow-panel__text">The panel parses in the extension host and renders the flow through React Flow.</p>
            </>
          ) : null}
          {state.status === "unsupported" ? (
            <>
              <h3 className="script-flow-panel__title">Script Flow does not support this source yet.</h3>
              <p className="script-flow-panel__text">
                {state.language
                  ? `The active source resolved to ${state.language}, but Script Flow currently analyzes TypeScript, Python, and SQL files only.`
                  : "Open a .ts, .tsx, .py, or .sql file to render its flow."}
              </p>
            </>
          ) : null}
          {state.status === "error" ? (
            <>
              <h3 className="script-flow-panel__title">The host failed to deliver a valid Script Flow snapshot.</h3>
              <p className="script-flow-panel__text">{state.description}</p>
            </>
          ) : null}
        </section>

        {state.status === "snapshot" ? (
          <AnalysisDrawer
            activeNodeId={selectedNodeId}
            analysis={state.snapshot.analysis}
            isCollapsed={isDrawerCollapsed}
            nodeLabels={nodeLabels}
            onSelectNode={(nodeId, section) => {
              setSelectedNodeId(nodeId);
              sendDrawerClick(vscode, section);
              sendSelectNode(vscode, nodeId);
              if (isNarrowLayout) {
                setIsDrawerCollapsed(true);
              }
            }}
            onToggle={() => setIsDrawerCollapsed((current) => !current)}
          />
        ) : (
          <section className="script-flow-state-card">
            <div className="script-flow-state-card__label">{formatStatusLabel(state.status)}</div>
            <h2 className="script-flow-state-card__title">{state.title}</h2>
            <p className="script-flow-state-card__text">{state.description}</p>
            {state.status === "unsupported" ? (
              <div className="script-flow-pill-row">
                {["typescript", "python", "sql"].map((language) => (
                  <span className="script-flow-pill" key={language}>
                    {language}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

function mapMessageToState(message: ScriptFlowHostMessage) {
  if (message.type === "scriptFlow:snapshot") {
    return {
      status: "snapshot",
      title: "Script Flow snapshot ready",
      description: "The host parsed the active file and streamed the resulting Script Flow snapshot into the panel.",
      snapshot: message.snapshot
    } satisfies ScriptFlowViewState;
  }

  if (message.type === "scriptFlow:error") {
    return {
      status: "error",
      title: "Bridge delivery failed",
      description: message.error
    } satisfies ScriptFlowViewState;
  }

  return {
    status: "unsupported",
    title: "Script Flow language not supported yet",
    description: "The bridge is active, but only the TypeScript, Python, and SQL analyzers are implemented right now.",
    ...(message.language ? { language: message.language } : {})
  } satisfies ScriptFlowViewState;
}

function formatStatusLabel(status: ScriptFlowViewState["status"]) {
  switch (status) {
    case "empty":
      return "Empty state";
    case "snapshot":
      return "Live snapshot";
    case "error":
      return "Bridge error";
    case "unsupported":
      return "Unsupported source";
  }
}

function isScriptFlowState(value: unknown): value is ScriptFlowViewState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScriptFlowViewState>;
  if (candidate.status === "empty" || candidate.status === "error") {
    return typeof candidate.title === "string" && typeof candidate.description === "string";
  }
  if (candidate.status === "unsupported") {
    return typeof candidate.title === "string" && typeof candidate.description === "string";
  }
  if (candidate.status === "snapshot") {
    return typeof candidate.title === "string" && typeof candidate.description === "string" && isScriptFlowSnapshot(candidate.snapshot);
  }
  return false;
}

function getPreferredNodeId(snapshot: ScriptFlowSnapshot) {
  return snapshot.analysis.entryPoints[0] ?? snapshot.nodes[0]?.id ?? null;
}

function buildFlowModel(snapshot: ScriptFlowSnapshot, selectedNodeId: string | null) {
  const nodes: Array<Node<FlowNodeData>> = snapshot.nodes.map((node) => ({
    id: node.id,
    type: "scriptFlow",
    selected: node.id === selectedNodeId,
    position: { x: 0, y: 0 },
    data: {
      kind: node.kind,
      kindLabel: KIND_LABELS[node.kind],
      label: node.label,
      ...(node.range ? { rangeLabel: formatRangeLabel(node) } : {})
    }
  }));

  const edges: Edge[] = snapshot.edges.map((edge, index) => ({
    id: `${edge.kind}:${edge.from}:${edge.to}:${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: edge.label === "loop",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.label === "loop" ? "#a855f7" : "#526279"
    },
    style: {
      stroke: edge.label === "loop" ? "#a855f7" : "#526279",
      strokeWidth: 2.1
    },
    ...(edge.label
      ? {
          labelStyle: {
            fill: "var(--vscode-editor-foreground)",
            fontSize: 11,
            fontWeight: 600
          }
        }
      : {})
  }));

  return computeLayout(nodes, edges);
}

function computeLayout(nodes: Array<Node<FlowNodeData>>, edges: Edge[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 36,
    ranksep: 72
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id);
      return {
        ...node,
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - NODE_HEIGHT / 2
        }
      };
    }),
    edges
  };
}

function formatRangeLabel(node: ScriptFlowNode) {
  if (!node.range) {
    return "Range unavailable";
  }

  return `L${node.range.startLine}:${node.range.startCol} - L${node.range.endLine}:${node.range.endCol}`;
}

function colorForKind(kind: ScriptFlowNodeKind) {
  switch (kind) {
    case "function":
      return "#60a5fa";
    case "branch":
      return "#facc15";
    case "loop":
      return "#a855f7";
    case "return":
      return "#22c55e";
    case "tryCatch":
      return "#f97316";
    case "call":
      return "#94a3b8";
    case "entry":
      return "#22d3ee";
    default:
      return "#64748b";
  }
}
