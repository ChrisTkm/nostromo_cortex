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
  type ReactFlowInstance,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import { useEffect, useMemo, useState } from "react";

import {
  isScriptFlowHostMessage,
  sendDrawerClick,
  sendOpenGlossary,
  sendReady,
  sendRefresh,
  sendSelectNode,
  type ScriptFlowHostMessage,
} from "../../scriptFlow/bridge.js";
import {
  isScriptFlowSnapshot,
  type ScriptFlowNode,
  type ScriptFlowNodeKind,
  type ScriptFlowSnapshot,
} from "../../scriptFlow/types.js";
import { AnalysisDrawer } from "./components/AnalysisDrawer";
import { FlowNode, type FlowNodeData } from "./components/FlowNode";
import { vscode } from "./vscodeApi";
const nodeTypes = { scriptFlow: FlowNode };
const EMPTY_FLOW: { nodes: Array<Node<FlowNodeData>>; edges: Edge[] } = {
  nodes: [],
  edges: [],
};
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
  subquery: "Subquery",
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
  description:
    "Open a TypeScript, Python, or SQL file to inspect its flow in the extension host.",
};

export function ScriptFlowApp() {
  const [state, setState] = useState<ScriptFlowViewState>(() => {
    const persisted = vscode.getState();
    if (persisted && typeof persisted === "object" && "view" in persisted) {
      const view = (persisted as { view?: unknown }).view;
      return isScriptFlowState(view) ? view : defaultState;
    }
    return isScriptFlowState(persisted) ? persisted : defaultState;
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    state.status === "snapshot" ? getPreferredNodeId(state.snapshot) : null,
  );
  const [orientation, setOrientation] = useState<"LR" | "TB">(() => {
    const persisted = vscode.getState();
    if (
      persisted &&
      typeof persisted === "object" &&
      "orientation" in persisted
    ) {
      const o = (persisted as { orientation?: unknown }).orientation;
      if (o === "LR" || o === "TB") return o;
    }
    return "LR";
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<
    Node<FlowNodeData>,
    Edge
  > | null>(null);
  const [isNarrowLayout, setIsNarrowLayout] = useState(
    () => window.innerWidth < 800,
  );
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(
    () => window.innerWidth < 800,
  );

  const nodeLabels = useMemo(() => {
    if (state.status !== "snapshot") {
      return new Map<string, string>();
    }

    return new Map(state.snapshot.nodes.map((node) => [node.id, node.label]));
  }, [state]);

  const searchMatches = useMemo(() => {
    if (state.status !== "snapshot" || !searchQuery) {
      return [];
    }

    const q = searchQuery.toLowerCase();
    return state.snapshot.nodes
      .map((node, index) => ({
        nodeId: node.id,
        index,
        score:
          (node.label.toLowerCase().includes(q) ? 2 : 0) +
          (KIND_LABELS[node.kind]?.toLowerCase().includes(q) ? 1 : 0),
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }, [searchQuery, state]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
  }, [state]);

  const flow = useMemo(() => {
    if (state.status !== "snapshot") {
      return EMPTY_FLOW;
    }

    return buildFlowModel(
      state.snapshot,
      selectedNodeId,
      orientation,
      searchMatches,
    );
  }, [selectedNodeId, state, orientation, searchMatches]);

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
      setSelectedNodeId(
        nextState.status === "snapshot"
          ? getPreferredNodeId(nextState.snapshot)
          : null,
      );
      setState(nextState);
    }

    window.addEventListener("message", onMessage);
    sendReady(vscode);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    vscode.setState({ view: state, orientation });
  }, [state, orientation]);

  useEffect(() => {
    if (state.status !== "snapshot" || !flowInstance || !selectedNodeId) {
      return;
    }

    const target = flow.nodes.find((node) => node.id === selectedNodeId);
    if (!target) {
      return;
    }

    flowInstance.setCenter(
      target.position.x + NODE_WIDTH / 2,
      target.position.y + NODE_HEIGHT / 2,
      {
        zoom: isNarrowLayout ? 0.9 : 1,
        duration: 220,
      },
    );
  }, [flow.nodes, flowInstance, isNarrowLayout, selectedNodeId, state.status]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((open) => {
          if (!open) {
            setSearchQuery("");
            setActiveMatchIndex(0);
          }
          return !open;
        });
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
        setActiveMatchIndex(0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0 || !flowInstance) return;
    const matchId = searchMatches[activeMatchIndex]?.nodeId;
    if (!matchId) return;
    const target = flow.nodes.find((n) => n.id === matchId);
    if (!target) return;
    flowInstance.setCenter(
      target.position.x + NODE_WIDTH / 2,
      target.position.y + NODE_HEIGHT / 2,
      {
        zoom: isNarrowLayout ? 0.9 : 1,
        duration: 220,
      },
    );
  }, [
    activeMatchIndex,
    flow.nodes,
    flowInstance,
    isNarrowLayout,
    searchMatches,
    searchOpen,
  ]);

  return (
    <div className={`script-flow-app script-flow-app--${state.status}`}>
      <header className="page-header">
        <div className="page-header__row">
          <div className="page-header__brand">
            <span className="page-header__prefix">/// </span>CORTEX SCRIPT FLOW
          </div>
          <div className="page-header__actions">
            {state.status === "snapshot" ? (
              <>
                <button
                  className="script-flow-button script-flow-button--icon"
                  onClick={() =>
                    setOrientation((o) => (o === "LR" ? "TB" : "LR"))
                  }
                  title={`Switch to ${orientation === "LR" ? "top-bottom" : "left-right"} layout`}
                  type="button"
                >
                  {orientation === "LR" ? "\u21C4" : "\u21C5"}
                </button>
                <button
                  className="script-flow-button script-flow-button--with-icon"
                  onClick={() => {
                    setSearchOpen(true);
                    setSearchQuery("");
                    setActiveMatchIndex(0);
                  }}
                  title="Search nodes (Ctrl+K)"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="script-flow-button__glyph"
                  >
                    {"\u2315"}
                  </span>
                  Search
                </button>
                <button
                  className="script-flow-button"
                  onClick={() =>
                    downloadFlowAsPng(state.snapshot.metadata.path)
                  }
                  type="button"
                >
                  PNG
                </button>
              </>
            ) : null}
            <button
              className="script-flow-button script-flow-button--with-icon"
              onClick={() => sendOpenGlossary(vscode)}
              title="Glossary: node and edge types used in the flow"
              type="button"
            >
              <span aria-hidden="true" className="script-flow-button__glyph">
                ?
              </span>
              Glossary
            </button>
            <button
              className="script-flow-button"
              onClick={() => sendRefresh(vscode)}
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main
        className={`script-flow-surface${isDrawerCollapsed ? " script-flow-surface--drawer-collapsed" : ""}`}
      >
        <section className="script-flow-panel">
          {state.status === "snapshot" ? (
            <>
              <div className="script-flow-stats">
                <span
                  className="script-flow-stats__file"
                  title={state.snapshot.metadata.path}
                >
                  {shortFilename(state.snapshot.metadata.path)}
                </span>
                <span className="script-flow-stats__chip">
                  {state.snapshot.metadata.language}
                </span>
                <span className="script-flow-stats__chip">
                  {state.snapshot.nodes.length} nodes
                </span>
                <span className="script-flow-stats__chip">
                  {state.snapshot.edges.length} edges
                </span>
              </div>
              <div className="script-flow-canvas">
                <ReactFlow
                  fitView
                  edges={flow.edges}
                  nodes={flow.nodes}
                  nodeTypes={nodeTypes}
                  nodesDraggable
                  onInit={setFlowInstance}
                  onNodeClick={(_, node) => {
                    setSelectedNodeId(node.id);
                    sendSelectNode(vscode, node.id);
                  }}
                  proOptions={{ hideAttribution: true }}
                >
                  <Controls />
                  <MiniMap
                    pannable
                    zoomable
                    nodeColor={(node) =>
                      colorForKind((node.data as FlowNodeData).kind)
                    }
                  />
                  <Background
                    color="rgba(148, 163, 184, 0.18)"
                    gap={18}
                    size={1}
                    variant={BackgroundVariant.Dots}
                  />
                </ReactFlow>
                {searchOpen ? (
                  <div className="script-flow-search">
                    <input
                      autoFocus
                      className="script-flow-search__input"
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setActiveMatchIndex(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (e.shiftKey) {
                            setActiveMatchIndex(
                              (i) =>
                                (i - 1 + searchMatches.length) %
                                searchMatches.length,
                            );
                          } else {
                            setActiveMatchIndex(
                              (i) => (i + 1) % searchMatches.length,
                            );
                          }
                          e.preventDefault();
                        }
                        if (e.key === "Escape") {
                          setSearchOpen(false);
                          setSearchQuery("");
                          setActiveMatchIndex(0);
                        }
                      }}
                      placeholder="Search nodes by name or kind..."
                      type="text"
                      value={searchQuery}
                    />
                    <span className="script-flow-search__count">
                      {searchQuery && searchMatches.length > 0
                        ? `${activeMatchIndex + 1}/${searchMatches.length}`
                        : searchQuery
                          ? "0/0"
                          : ""}
                    </span>
                    <button
                      className="script-flow-button"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        setActiveMatchIndex(0);
                      }}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {state.status === "empty" ? (
            <>
              <h3 className="script-flow-panel__title">
                Open a supported source file to render its flow.
              </h3>
              <p className="script-flow-panel__text">
                The panel parses in the extension host and renders the flow
                through React Flow.
              </p>
            </>
          ) : null}
          {state.status === "unsupported" ? (
            <>
              <h3 className="script-flow-panel__title">
                Script Flow does not support this source yet.
              </h3>
              <p className="script-flow-panel__text">
                {state.language
                  ? `The active source resolved to ${state.language}, but Script Flow currently analyzes TypeScript, Python, and SQL files only.`
                  : "Open a .ts, .tsx, .py, or .sql file to render its flow."}
              </p>
            </>
          ) : null}
          {state.status === "error" ? (
            <>
              <h3 className="script-flow-panel__title">
                The host failed to deliver a valid Script Flow snapshot.
              </h3>
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
            <div className="script-flow-state-card__label">
              {formatStatusLabel(state.status)}
            </div>
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
      description:
        "The host parsed the active file and streamed the resulting Script Flow snapshot into the panel.",
      snapshot: message.snapshot,
    } satisfies ScriptFlowViewState;
  }

  if (message.type === "scriptFlow:error") {
    return {
      status: "error",
      title: "Bridge delivery failed",
      description: message.error,
    } satisfies ScriptFlowViewState;
  }

  return {
    status: "unsupported",
    title: "Script Flow language not supported yet",
    description:
      "The bridge is active, but only the TypeScript, Python, and SQL analyzers are implemented right now.",
    ...(message.language ? { language: message.language } : {}),
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
    return (
      typeof candidate.title === "string" &&
      typeof candidate.description === "string"
    );
  }
  if (candidate.status === "unsupported") {
    return (
      typeof candidate.title === "string" &&
      typeof candidate.description === "string"
    );
  }
  if (candidate.status === "snapshot") {
    return (
      typeof candidate.title === "string" &&
      typeof candidate.description === "string" &&
      isScriptFlowSnapshot(candidate.snapshot)
    );
  }
  return false;
}

function getPreferredNodeId(snapshot: ScriptFlowSnapshot) {
  return snapshot.analysis.entryPoints[0] ?? snapshot.nodes[0]?.id ?? null;
}

function buildFlowModel(
  snapshot: ScriptFlowSnapshot,
  selectedNodeId: string | null,
  orientation: "LR" | "TB",
  searchMatches: Array<{ nodeId: string }>,
) {
  const searchHitIds = new Set(searchMatches.map((m) => m.nodeId));
  const nodes: Array<Node<FlowNodeData>> = snapshot.nodes.map((node) => ({
    id: node.id,
    type: "scriptFlow",
    selected: node.id === selectedNodeId,
    position: { x: 0, y: 0 },
    data: {
      kind: node.kind,
      kindLabel: KIND_LABELS[node.kind],
      label: node.label,
      ...(node.range ? { rangeLabel: formatRangeLabel(node) } : {}),
      ...(node.meta?.async === true ? { async: true } : {}),
      ...(typeof node.meta?.subKind === "string"
        ? { subKind: node.meta.subKind }
        : {}),
      ...(node.meta?.crossFile === true ? { crossFile: true } : {}),
      ...(typeof node.meta?.sourceFile === "string"
        ? { sourceFile: node.meta.sourceFile }
        : {}),
      searchHit: searchHitIds.has(node.id),
    },
  }));

  const edges: Edge[] = snapshot.edges.map((edge, index) => ({
    id: `${edge.kind}:${edge.from}:${edge.to}:${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: edge.label === "loop",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.label === "loop" ? "#a855f7" : "#526279",
    },
    style: {
      stroke: edge.label === "loop" ? "#a855f7" : "#526279",
      strokeWidth: 2.1,
    },
    ...(edge.label
      ? {
          labelStyle: {
            fill: "var(--vscode-editor-foreground)",
            fontSize: 11,
            fontWeight: 600,
          },
        }
      : {}),
  }));

  return computeLayout(nodes, edges, orientation);
}

function computeLayout(
  nodes: Array<Node<FlowNodeData>>,
  edges: Edge[],
  orientation: "LR" | "TB",
) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: orientation,
    nodesep: 36,
    ranksep: 72,
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
          y: position.y - NODE_HEIGHT / 2,
        },
      };
    }),
    edges,
  };
}

function shortFilename(p: string) {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

async function downloadFlowAsPng(sourcePath: string) {
  const viewport = document.querySelector(
    ".script-flow-canvas .react-flow__viewport",
  ) as HTMLElement | null;
  const container =
    (document.querySelector(
      ".script-flow-canvas .react-flow",
    ) as HTMLElement | null) ?? viewport;
  if (!container) return;

  const bg = getComputedStyle(document.body).backgroundColor || "#0c1724";
  try {
    const dataUrl = await toPng(container, {
      backgroundColor: bg,
      pixelRatio: 2,
      cacheBust: true,
    });
    const link = document.createElement("a");
    const base = shortFilename(sourcePath).replace(/\.[^.]+$/, "");
    link.download = `${base || "script-flow"}.png`;
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error("Script Flow PNG export failed", err);
  }
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
