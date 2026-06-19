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
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  isScriptFlowHostMessage,
  sendOpenGlossary,
  sendReady,
  sendRefresh,
  sendSelectNode,
  sendSelectScript,
  type ScriptFlowHostMessage,
} from "../../scriptFlow/bridge.js";
import {
  isScriptFlowSnapshot,
  SCRIPT_FLOW_NODE_KINDS,
  type ScriptFlowAutoObservation,
  type ScriptFlowNode,
  type ScriptFlowNodeKind,
  type ScriptFlowSnapshot,
} from "../../scriptFlow/types.js";
import { Button, Metric, Search, Toggle } from "../components/atoms";
import { Footer, Header, SecondBar } from "../components/molecules";
import { Module } from "../components/organisms";
import { AnalysisDrawer } from "./components/AnalysisDrawer";
import {
  FlowNode,
  KIND_LABELS,
  NODE_ACCENT_VAR,
  type FlowNodeData,
} from "./components/FlowNode";
import { GapNode, type GapNodeData } from "./components/GapNode";
import { vscode } from "./vscodeApi";
const nodeTypes = { scriptFlow: FlowNode, scriptFlowGap: GapNode } as NodeTypes;
// Real analysis nodes plus the phantom gap-notes that hang off flow-gaps.
type AnyFlowNode = Node<FlowNodeData> | Node<GapNodeData>;
const EMPTY_FLOW: { nodes: AnyFlowNode[]; edges: Edge[] } = {
  nodes: [],
  edges: [],
};
const NODE_WIDTH = 226;
const NODE_HEIGHT = 100;
const GAP_NODE_WIDTH = 208;
const GAP_NODE_HEIGHT = 56;
// Missing-gap notes use the cherry/watermelon warning tone.
const GAP_COLOR = "#ff3b6b";
const ACTIVE_FLOW_COLOR = "var(--accent-cyan)";
const EDGE_LABEL_COLOR = "var(--status-in-progress)";
const LOOP_FLOW_COLOR = "var(--cortex-node-loop)";
const INACTIVE_FLOW_COLOR = "#526279";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<
    AnyFlowNode,
    Edge
  > | null>(null);
  const [isNarrowLayout, setIsNarrowLayout] = useState(
    () => window.innerWidth < 800,
  );
  const [drawerMode, setDrawerMode] = useState<"messages" | "nodes" | null>(
    null,
  );
  const [showMiniMap, setShowMiniMap] = useState(true);

  const kindCounts = useMemo(() => {
    if (state.status !== "snapshot") {
      return [];
    }

    const counts = new Map<ScriptFlowNodeKind, number>();
    for (const node of state.snapshot.nodes) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return SCRIPT_FLOW_NODE_KINDS.filter((kind) => counts.has(kind)).map(
      (kind) => ({
        kind,
        label: KIND_LABELS[kind],
        count: counts.get(kind) ?? 0,
      }),
    );
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
    setSearchQuery("");
    setActiveMatchIndex(0);
  }, [state]);

  useEffect(() => {
    if (state.status !== "snapshot") {
      setDrawerMode(null);
    }
  }, [state.status]);

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
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (
        e.key === "Escape" &&
        document.activeElement === searchInputRef.current
      ) {
        setSearchQuery("");
        setActiveMatchIndex(0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!searchQuery || searchMatches.length === 0 || !flowInstance) return;
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
    searchQuery,
  ]);

  useEffect(() => {
    if (activeMatchIndex < searchMatches.length) {
      return;
    }
    setActiveMatchIndex(Math.max(0, searchMatches.length - 1));
  }, [activeMatchIndex, searchMatches.length]);

  const snapshot = state.status === "snapshot" ? state.snapshot : null;
  const messageCount = snapshot ? countNodeMessages(snapshot.nodes) : 0;

  const header = (
    <Header
      name="CORTEX SCRIPT FLOW"
      external={Boolean(snapshot)}
      route={snapshot ? shortFilename(snapshot.metadata.path) : undefined}
      actions={
        <>
          <Button
            intent="refresh"
            onClick={() => sendRefresh(vscode)}
            size="small"
          >
            Actualizar
          </Button>
          <Button
            intent="change"
            onClick={() => sendOpenGlossary(vscode)}
            size="small"
            title="Glossary: node and edge types used in the flow"
          >
            ?
          </Button>
        </>
      }
    />
  );

  const secondBar = snapshot ? (
    <SecondBar
      search={
        <Search
          className="script-flow-second-bar__search"
          inputRef={searchInputRef}
          onChange={(value) => {
            setSearchQuery(value);
            setActiveMatchIndex(0);
          }}
          placeholder="Buscar nodos por nombre o tipo"
          value={searchQuery}
        />
      }
      status={
        <div className="script-flow-second-bar__actions">
          <Button
            className={drawerMode === "messages" ? "is-active" : undefined}
            disabled={messageCount === 0}
            intent="change"
            onClick={() =>
              setDrawerMode((current) =>
                current === "messages" ? null : "messages",
              )
            }
            size="small"
            title={
              messageCount > 0
                ? "Lista de mensajes detectados"
                : "Sin mensajes detectados"
            }
          >
            Mensajes {messageCount > 0 ? messageCount : ""}
          </Button>
          <Button
            className={drawerMode === "nodes" ? "is-active" : undefined}
            intent="change"
            onClick={() =>
              setDrawerMode((current) => (current === "nodes" ? null : "nodes"))
            }
            size="small"
            title="Lista de nodos"
          >
            Nodos
          </Button>
        </div>
      }
    />
  ) : undefined;

  const footer = snapshot ? (
    <Footer
      left={
        <div className="sf-footer__left">
          <span
            className={`sf-lang sf-lang--${snapshot.metadata.language}`}
            title={snapshot.metadata.path}
          >
            {snapshot.metadata.language}
          </span>
          <Metric>{snapshot.nodes.length} nodes</Metric>
          {kindCounts.map(({ count, kind, label }) => (
            <Metric key={kind}>
              {count} {label}
            </Metric>
          ))}
          <Metric>{snapshot.edges.length} edges</Metric>
        </div>
      }
      right={
        <div className="sf-footer__right">
          <Button
            className={showMiniMap ? "is-active" : undefined}
            intent="change"
            onClick={() => setShowMiniMap((current) => !current)}
            size="small"
          >
            MiniMap
          </Button>
          <Toggle
            onChange={(value) => {
              if (value === "LR" || value === "TB") {
                setOrientation(value);
              }
            }}
            options={[
              { value: "LR", label: "⇄ LR", title: "Diseño horizontal" },
              { value: "TB", label: "⇅ TB", title: "Diseño vertical" },
            ]}
            value={orientation}
          />
          <Button
            intent="change"
            onClick={() => downloadFlowAsPng(snapshot.metadata.path)}
            size="small"
            title="Export PNG (2x)"
          >
            PNG
          </Button>
        </div>
      }
    />
  ) : undefined;

  const drawer = snapshot ? (
    <AnalysisDrawer
      activeNodeId={selectedNodeId}
      isOpen={drawerMode !== null}
      mode={drawerMode ?? "nodes"}
      nodes={snapshot.nodes}
      onClose={() => setDrawerMode(null)}
      onSelectNode={(nodeId) => {
        setSelectedNodeId(nodeId);
        sendSelectNode(vscode, nodeId);
        if (isNarrowLayout) {
          setDrawerMode(null);
        }
      }}
    />
  ) : undefined;

  return (
    <Module
      drawer={drawer}
      footer={footer}
      header={header}
      secondBar={secondBar}
    >
      <div
        className={`script-flow-surface${state.status !== "snapshot" ? " script-flow-surface--state" : ""}`}
      >
        {snapshot ? (
          <section className="script-flow-panel">
            <div className="script-flow-canvas">
              <ReactFlow
                fitView
                edges={flow.edges}
                nodes={flow.nodes}
                nodeTypes={nodeTypes}
                nodesDraggable
                onInit={setFlowInstance}
                onNodeClick={(_, node) => {
                  const nodeId = resolveSelectableNodeId(node);
                  if (!nodeId) {
                    return;
                  }
                  setSelectedNodeId(nodeId);
                  sendSelectNode(vscode, nodeId);
                }}
                proOptions={{ hideAttribution: true }}
              >
                <Controls />
                {showMiniMap ? (
                  <MiniMap
                    pannable
                    zoomable
                    nodeStrokeWidth={3}
                    nodeColor={(node) =>
                      colorForKind((node.data as FlowNodeData).kind)
                    }
                  />
                ) : null}
                <Background
                  color="rgba(148, 163, 184, 0.18)"
                  gap={18}
                  size={1}
                  variant={BackgroundVariant.Dots}
                />
              </ReactFlow>
            </div>
          </section>
        ) : (
          <section
            className={`script-flow-state-card script-flow-state-card--${state.status}`}
          >
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
            <Button intent="action" onClick={() => sendSelectScript(vscode)}>
              Seleccionar script…
            </Button>
          </section>
        )}
      </div>
    </Module>
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
    title: "Script Flow",
    description: "Seleccioná un script con alguna de estas extensiones:",
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
      return "Análisis de Script";
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

function countNodeMessages(nodes: ScriptFlowNode[]) {
  return nodes.reduce((count, node) => {
    const observations = Array.isArray(node.meta?.autoObservations)
      ? (node.meta.autoObservations as ScriptFlowAutoObservation[])
      : [];
    return count + observations.length;
  }, 0);
}

function resolveSelectableNodeId(node: AnyFlowNode) {
  if (node.type === "scriptFlow") {
    return node.id;
  }
  if (node.type === "scriptFlowGap" && node.id.startsWith("gap:")) {
    return node.id.slice("gap:".length);
  }
  return null;
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
    // Seed dimensions so the MiniMap can draw node rects: nodes are rebuilt
    // each render (no useNodesState/onNodesChange), so measured sizes never
    // persist back into this array. initialWidth/Height hint the store
    // without constraining the real (auto-measured) node DOM.
    initialWidth: NODE_WIDTH,
    initialHeight: NODE_HEIGHT,
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
      ...(Array.isArray(node.meta?.autoObservations)
        ? { autoObservations: node.meta.autoObservations }
        : {}),
      searchHit: searchHitIds.has(node.id),
    },
  }));

  const entryIds = new Set(
    snapshot.nodes
      .filter((node) => node.kind === "entry")
      .map((node) => node.id),
  );
  const selectedNode = selectedNodeId
    ? snapshot.nodes.find((node) => node.id === selectedNodeId)
    : undefined;
  // Only scope-highlight when a function (or the entry/main process) is selected:
  // those nodes own a body subgraph. Selecting a lone if/loop dims nothing.
  const scopeEdges =
    selectedNode &&
    (selectedNode.kind === "function" || selectedNode.kind === "entry")
      ? collectScopeEdges(snapshot, selectedNode.id)
      : null;

  const edges: Edge[] = snapshot.edges.map((edge, index) => {
    const isLoop = edge.label === "loop";
    const isEntry = entryIds.has(edge.from);
    const isHot = scopeEdges
      ? scopeEdges.has(`${edge.from}->${edge.to}`)
      : true;
    const isActiveEdge = isEntry || isHot;
    const color = isLoop
      ? LOOP_FLOW_COLOR
      : isActiveEdge
        ? ACTIVE_FLOW_COLOR
        : INACTIVE_FLOW_COLOR;
    return {
      id: `${edge.kind}:${edge.from}:${edge.to}:${index}`,
      source: edge.from,
      target: edge.to,
      label: edge.label,
      animated: isActiveEdge,
      className: [
        "script-flow-edge",
        isActiveEdge ? "script-flow-edge--active" : "",
        isLoop ? "script-flow-edge--loop" : "",
        isEntry ? "script-flow-edge--entry" : "",
      ]
        .filter(Boolean)
        .join(" "),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      style: {
        stroke: color,
        strokeWidth: isActiveEdge ? (isEntry ? 2.8 : 2.6) : 2.1,
        opacity: scopeEdges ? (isActiveEdge ? 1 : 0.18) : 1,
      },
      ...(edge.label
        ? {
            labelStyle: {
              fill: EDGE_LABEL_COLOR,
              fontSize: 11,
              fontWeight: 600,
              ...(scopeEdges && !isActiveEdge ? { opacity: 0.18 } : {}),
            },
            labelBgPadding: [0, 0],
            labelBgStyle: {
              fill: "transparent",
              fillOpacity: 0,
            },
          }
        : {}),
    };
  });

  // Materialize every flow-gap as a phantom note + a typed dashed arrow
  // pointing at the open path. Warnings stay full-opacity even while a function
  // scope dims the rest — an unclosed section should never fade into the back.
  const gapNodes: Array<Node<GapNodeData>> = [];
  for (const node of snapshot.nodes) {
    const gaps = Array.isArray(node.meta?.autoObservations)
      ? (node.meta.autoObservations as ScriptFlowAutoObservation[]).filter(
          (obs) => obs.kind === "flow-gap",
        )
      : [];
    if (gaps.length === 0) {
      continue;
    }

    const gapId = `gap:${node.id}`;
    const gapColor = colorForGaps(node.kind, gaps);
    gapNodes.push({
      id: gapId,
      type: "scriptFlowGap",
      selectable: false,
      draggable: false,
      position: { x: 0, y: 0 },
      initialWidth: GAP_NODE_WIDTH,
      initialHeight: GAP_NODE_HEIGHT,
      data: {
        accentColor: gapColor,
        message: gaps.map((gap) => describeGap(gap.message)).join(" · "),
      },
    });
    edges.push({
      id: `gap-edge:${node.id}`,
      source: node.id,
      target: gapId,
      selectable: false,
      animated: true,
      className: "script-flow-edge script-flow-edge--gap",
      markerEnd: { type: MarkerType.ArrowClosed, color: gapColor },
      style: {
        ...edgeAccentStyle(gapColor),
        stroke: gapColor,
        strokeWidth: 2.4,
        strokeDasharray: "5 4",
      },
    });
  }

  return computeLayout([...nodes, ...gapNodes], edges, orientation);
}

function edgeAccentStyle(color: string) {
  return { "--script-flow-edge-color": color } as CSSProperties;
}

function colorForGaps(
  kind: ScriptFlowNodeKind,
  gaps: ScriptFlowAutoObservation[],
) {
  return gaps.some((gap) => isClassicMissingPathMessage(gap.message))
    ? GAP_COLOR
    : NODE_ACCENT_VAR[kind];
}

function isClassicMissingPathMessage(message: string) {
  return /no explicit return|no explicit else|no default path|unreachable|catch block is empty/i.test(
    message,
  );
}

// Turns the analyzer's English gap message into a short, descriptive Spanish
// note for the phantom gap-node. Falls back to the raw message for any new gap.
function describeGap(message: string): string {
  if (/no explicit return/i.test(message)) {
    return "Falta return explícito — la función no cierra su flujo";
  }
  if (/no explicit else/i.test(message)) {
    return "Falta rama else — la decisión no cubre el caso contrario";
  }
  if (/no default path/i.test(message)) {
    return "Switch sin default — falta el caso por defecto";
  }
  if (/unreachable/i.test(message)) {
    return "Código inalcanzable tras un flujo terminal";
  }
  if (/catch block is empty/i.test(message)) {
    return "Catch vacío — el error se traga sin manejarlo";
  }
  return message;
}

// Edges that belong to the selected function/entry body: walk forward over flow
// edges from the selected node, stopping at any other function/entry node so the
// scope never bleeds into the sibling chained at the top level (analyze()).
function collectScopeEdges(
  snapshot: ScriptFlowSnapshot,
  selectedId: string,
): Set<string> {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ScriptFlowSnapshot["edges"]>();
  for (const edge of snapshot.edges) {
    const list = outgoing.get(edge.from);
    if (list) {
      list.push(edge);
    } else {
      outgoing.set(edge.from, [edge]);
    }
  }

  const boundary = new Set<ScriptFlowNodeKind>(["function", "entry"]);
  const inScope = new Set<string>([selectedId]);
  const queue: string[] = [selectedId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const edge of outgoing.get(current) ?? []) {
      const target = byId.get(edge.to);
      if (target && boundary.has(target.kind)) {
        continue;
      }
      if (!inScope.has(edge.to)) {
        inScope.add(edge.to);
        queue.push(edge.to);
      }
    }
  }

  return new Set(
    snapshot.edges
      .filter((edge) => inScope.has(edge.from) && inScope.has(edge.to))
      .map((edge) => `${edge.from}->${edge.to}`),
  );
}

function computeLayout(
  nodes: AnyFlowNode[],
  edges: Edge[],
  orientation: "LR" | "TB",
) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: orientation,
    nodesep: 36,
    ranksep: 72,
  });

  const dimsFor = (node: AnyFlowNode) =>
    node.type === "scriptFlowGap"
      ? { width: GAP_NODE_WIDTH, height: GAP_NODE_HEIGHT }
      : { width: NODE_WIDTH, height: NODE_HEIGHT };

  for (const node of nodes) {
    graph.setNode(node.id, dimsFor(node));
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id);
      const { width, height } = dimsFor(node);
      return {
        ...node,
        position: {
          x: position.x - width / 2,
          y: position.y - height / 2,
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
