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
  type ScriptFlowRuntimeLiveState,
  type ScriptFlowHostMessage,
} from "../../scriptFlow/bridge.js";
import type {
  ScriptFlowRuntimeNodeAggregate,
  ScriptFlowRuntimeReplayEvent,
  ScriptFlowRuntimeRunAggregate,
  ScriptFlowTraceParseResult,
} from "../../scriptFlow/runtimeTraceParser.js";
import {
  isScriptFlowSnapshot,
  SCRIPT_FLOW_NODE_KINDS,
  type ScriptFlowAutoObservation,
  type ScriptFlowAutoObservationSeverity,
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
  type FlowNodeRuntimeData,
} from "./components/FlowNode";
import { GapNode, type GapNodeData } from "./components/GapNode";
import { getScriptFlowFixHint } from "./messageHints";
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

type MessageSummary = Record<
  ScriptFlowAutoObservationSeverity | "flow-gap",
  number
> & {
  total: number;
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
      runtimeOverlay?: ScriptFlowTraceParseResult;
      runtimeLive?: ScriptFlowRuntimeLiveState;
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
  const [problemOnly, setProblemOnly] = useState(() => {
    const persisted = vscode.getState();
    return (
      Boolean(persisted) &&
      typeof persisted === "object" &&
      "problemOnly" in persisted &&
      (persisted as { problemOnly?: unknown }).problemOnly === true
    );
  });
  const [selectedRuntimeRunId, setSelectedRuntimeRunId] = useState<
    string | undefined
  >(() =>
    state.status === "snapshot" ? state.runtimeOverlay?.selectedRunId : undefined,
  );
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);

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
      .filter((node) => !problemOnly || hasNodeMessages(node))
      .map((node, index) => ({
        nodeId: node.id,
        index,
        score:
          (node.label.toLowerCase().includes(q) ? 2 : 0) +
          (KIND_LABELS[node.kind]?.toLowerCase().includes(q) ? 1 : 0),
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }, [problemOnly, searchQuery, state]);

  useEffect(() => {
    setSearchQuery("");
    setActiveMatchIndex(0);
  }, [state]);

  useEffect(() => {
    if (state.status !== "snapshot") {
      setDrawerMode(null);
    }
  }, [state.status]);

  const runtimeOverlay =
    state.status === "snapshot" ? state.runtimeOverlay : undefined;
  const runtimeLive = state.status === "snapshot" ? state.runtimeLive : undefined;
  const runtimeRuns = runtimeOverlay?.runs ?? [];
  const runtimeRun =
    selectedRuntimeRunId && runtimeOverlay?.runsById[selectedRuntimeRunId]
      ? runtimeOverlay.runsById[selectedRuntimeRunId]
      : runtimeOverlay?.selectedRun;
  const replayEvents = runtimeRun?.events ?? [];
  const replayEvent = replayEvents[replayIndex];

  const flow = useMemo(() => {
    if (state.status !== "snapshot") {
      return EMPTY_FLOW;
    }

    return buildFlowModel(
      state.snapshot,
      runtimeRun,
      replayEvent,
      selectedNodeId,
      orientation,
      searchMatches,
      problemOnly,
    );
  }, [
    selectedNodeId,
    state,
    runtimeRun,
    replayEvent,
    orientation,
    searchMatches,
    problemOnly,
  ]);

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
    vscode.setState({ view: state, orientation, problemOnly });
  }, [state, orientation, problemOnly]);

  useEffect(() => {
    if (state.status !== "snapshot" || !problemOnly || !selectedNodeId) {
      return;
    }
    const selectedNode = state.snapshot.nodes.find(
      (node) => node.id === selectedNodeId,
    );
    if (!selectedNode || hasNodeMessages(selectedNode)) {
      return;
    }
    setSelectedNodeId(
      state.snapshot.nodes.find((node) => hasNodeMessages(node))?.id ?? null,
    );
  }, [problemOnly, selectedNodeId, state]);

  useEffect(() => {
    if (state.status !== "snapshot") {
      setSelectedRuntimeRunId(undefined);
      setReplayIndex(0);
      setIsReplayPlaying(false);
      return;
    }

    const overlay = state.runtimeOverlay;
    const preferredRunId =
      overlay?.selectedRunId ?? overlay?.latestRunId ?? overlay?.runs[0]?.runId;
    setSelectedRuntimeRunId((current) =>
      current && overlay?.runsById[current] ? current : preferredRunId,
    );
    setReplayIndex(0);
    setIsReplayPlaying(false);
  }, [state]);

  useEffect(() => {
    if (replayIndex < replayEvents.length) {
      return;
    }
    setReplayIndex(Math.max(0, replayEvents.length - 1));
  }, [replayEvents.length, replayIndex]);

  useEffect(() => {
    if (!isReplayPlaying || replayEvents.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      setReplayIndex((current) => {
        if (current >= replayEvents.length - 1) {
          setIsReplayPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 700);

    return () => window.clearInterval(interval);
  }, [isReplayPlaying, replayEvents.length, runtimeRun?.runId]);

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

  const selectActiveSearchMatch = () => {
    if (!searchQuery || searchMatches.length === 0) {
      return;
    }
    const matchId = searchMatches[activeMatchIndex]?.nodeId;
    if (!matchId) {
      return;
    }
    setSelectedNodeId(matchId);
    sendSelectNode(vscode, matchId);
  };

  const snapshot = state.status === "snapshot" ? state.snapshot : null;
  const messageSummary = snapshot
    ? summarizeNodeMessages(snapshot.nodes)
    : createEmptyMessageSummary();
  const messageCount = messageSummary.total;

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
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            selectActiveSearchMatch();
          }}
          placeholder="Buscar nodos por nombre o tipo"
          value={searchQuery}
        />
      }
      status={
        <div className="script-flow-second-bar__actions">
          {runtimeLive ? <RuntimeLiveStatus state={runtimeLive} /> : null}
          {runtimeRun ? (
            <RuntimeRunControls
              currentEvent={replayEvent}
              isPlaying={isReplayPlaying}
              onPlayToggle={() =>
                setIsReplayPlaying((current) =>
                  replayEvents.length > 0 ? !current : false,
                )
              }
              onReset={() => {
                setReplayIndex(0);
                setIsReplayPlaying(false);
              }}
              onRunChange={(runId) => {
                setSelectedRuntimeRunId(runId);
                setReplayIndex(0);
                setIsReplayPlaying(false);
              }}
              onScrub={(index) => {
                setReplayIndex(index);
                setIsReplayPlaying(false);
              }}
              replayIndex={replayIndex}
              runs={runtimeRuns}
              selectedRun={runtimeRun}
              totalEvents={replayEvents.length}
            />
          ) : null}
          {runtimeRun ? <RuntimeSummary run={runtimeRun} /> : null}
          <MessageSummaryPills summary={messageSummary} />
          <Button
            className={problemOnly ? "is-active" : undefined}
            disabled={messageCount === 0}
            intent="change"
            onClick={() => setProblemOnly((current) => !current)}
            size="small"
            title={
              messageCount > 0
                ? "Mostrar solo nodos con mensajes"
                : "Sin mensajes para filtrar"
            }
          >
            Solo problemas
          </Button>
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
          {runtimeRun ? (
            <Metric>runtime {runtimeRun.nodeCount} nodes</Metric>
          ) : null}
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
          <Button
            disabled={messageCount === 0}
            intent="change"
            onClick={() => downloadMarkdownReport(snapshot)}
            size="small"
            title={
              messageCount > 0
                ? "Exportar reporte Markdown"
                : "Sin mensajes para exportar"
            }
          >
            Markdown
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
                {runtimeRun ? (
                  <RuntimeLegend
                    runId={runtimeRun.runId}
                    warnings={runtimeOverlay?.warnings.length ?? 0}
                  />
                ) : null}
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
      ...(message.runtimeOverlay
        ? { runtimeOverlay: message.runtimeOverlay }
        : {}),
      ...(message.runtimeLive ? { runtimeLive: message.runtimeLive } : {}),
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

function MessageSummaryPills(props: { summary: MessageSummary }) {
  const { summary } = props;
  return (
    <div className="sf-message-summary" aria-label="Resumen de mensajes">
      <span className="sf-message-summary__pill sf-message-summary__pill--error">
        Errores {summary.error}
      </span>
      <span className="sf-message-summary__pill sf-message-summary__pill--warning">
        Warnings {summary.warning}
      </span>
      <span className="sf-message-summary__pill sf-message-summary__pill--info">
        Info {summary.info}
      </span>
      <span className="sf-message-summary__pill sf-message-summary__pill--gap">
        Gaps {summary["flow-gap"]}
      </span>
    </div>
  );
}

function RuntimeLiveStatus(props: { state: ScriptFlowRuntimeLiveState }) {
  const { state } = props;
  return (
    <div
      className={`sf-runtime-live sf-runtime-live--${state.status}`}
      title={[
        state.message,
        state.tracePath ? `Trace: ${state.tracePath}` : undefined,
        `Throttle: ${state.throttleMs}ms`,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <span className="sf-runtime-live__dot" />
      <span className="sf-runtime-live__label">Live</span>
      <span className="sf-runtime-live__status">
        {formatLiveStatus(state.status)}
      </span>
      {state.updatedAt ? (
        <span className="sf-runtime-live__time">
          {formatDateTime(state.updatedAt)}
        </span>
      ) : null}
    </div>
  );
}

function RuntimeSummary(props: {
  run: NonNullable<ScriptFlowTraceParseResult["selectedRun"]>;
}) {
  const { run } = props;
  const activeCount = run.activeSpans.length;
  const errorCount = Object.values(run.nodes).reduce(
    (count, node) => count + node.errorCount,
    0,
  );
  return (
    <div className="sf-runtime-summary" title={`Runtime evidence: ${run.runId}`}>
      <span className="sf-runtime-summary__label">Runtime</span>
      {run.status ? (
        <span className={`sf-runtime-summary__pill sf-runtime-summary__pill--${run.status}`}>
          {run.status}
        </span>
      ) : null}
      <span className="sf-runtime-summary__pill">{run.nodeCount} nodes</span>
      {activeCount > 0 ? (
        <span className="sf-runtime-summary__pill sf-runtime-summary__pill--active">
          active {activeCount}
        </span>
      ) : null}
      {errorCount > 0 ? (
        <span className="sf-runtime-summary__pill sf-runtime-summary__pill--error">
          errors {errorCount}
        </span>
      ) : null}
    </div>
  );
}

function RuntimeRunControls(props: {
  runs: ScriptFlowRuntimeRunAggregate[];
  selectedRun: ScriptFlowRuntimeRunAggregate;
  replayIndex: number;
  totalEvents: number;
  currentEvent?: ScriptFlowRuntimeReplayEvent;
  isPlaying: boolean;
  onRunChange: (runId: string) => void;
  onPlayToggle: () => void;
  onReset: () => void;
  onScrub: (index: number) => void;
}) {
  const {
    currentEvent,
    isPlaying,
    onPlayToggle,
    onReset,
    onRunChange,
    onScrub,
    replayIndex,
    runs,
    selectedRun,
    totalEvents,
  } = props;
  const canReplay = totalEvents > 0;
  return (
    <div className="sf-runtime-controls" title={selectedRun.runId}>
      <label className="sf-runtime-controls__selector">
        <span>Run</span>
        <select
          className="sf-runtime-select"
          onChange={(event) => onRunChange(event.currentTarget.value)}
          value={selectedRun.runId}
        >
          {runs.map((run) => (
            <option key={run.runId} value={run.runId}>
              {formatRunOption(run)}
            </option>
          ))}
        </select>
      </label>
      <span className="sf-runtime-controls__meta">
        {selectedRun.status ?? "running"}
      </span>
      <span className="sf-runtime-controls__meta">
        {formatMs(selectedRun.durationMs ?? 0)}
      </span>
      <span className="sf-runtime-controls__meta">
        {selectedRun.machineIds[0] ?? "machine ?"}
      </span>
      <span className="sf-runtime-controls__meta">
        {formatDateTime(selectedRun.startedAt)}
      </span>
      <div className="sf-runtime-replay">
        <Button
          disabled={!canReplay}
          intent="change"
          onClick={onPlayToggle}
          size="small"
          title={canReplay ? "Play/pause runtime replay" : "Sin eventos para replay"}
        >
          {isPlaying ? "Pause" : "Play"}
        </Button>
        <Button
          disabled={!canReplay}
          intent="change"
          onClick={onReset}
          size="small"
          title="Volver al inicio del replay"
        >
          Reset
        </Button>
        <input
          aria-label="Runtime replay scrubber"
          className="sf-runtime-scrub"
          disabled={!canReplay}
          max={Math.max(0, totalEvents - 1)}
          min={0}
          onChange={(event) => onScrub(Number(event.currentTarget.value))}
          type="range"
          value={Math.min(replayIndex, Math.max(0, totalEvents - 1))}
        />
        <span className="sf-runtime-replay__count">
          {canReplay ? `${replayIndex + 1}/${totalEvents}` : "0/0"}
        </span>
        {currentEvent ? (
          <span
            className={`sf-runtime-replay__event sf-runtime-replay__event--${currentEvent.event}`}
          >
            {formatReplayEvent(currentEvent)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatLiveStatus(status: ScriptFlowRuntimeLiveState["status"]) {
  switch (status) {
    case "disabled":
      return "off";
    case "missing":
      return "waiting";
    case "watching":
      return "watching";
    case "updated":
      return "updated";
    case "error":
      return "error";
  }
}

function createEmptyMessageSummary(): MessageSummary {
  return {
    total: 0,
    error: 0,
    warning: 0,
    info: 0,
    "flow-gap": 0,
  };
}

function summarizeNodeMessages(nodes: ScriptFlowNode[]) {
  return nodes.reduce<MessageSummary>((summary, node) => {
    for (const observation of readNodeObservations(node)) {
      summary.total += 1;
      summary[observation.severity] += 1;
      if (observation.kind === "flow-gap") {
        summary["flow-gap"] += 1;
      }
    }
    return summary;
  }, createEmptyMessageSummary());
}

function readNodeObservations(node: ScriptFlowNode) {
  return Array.isArray(node.meta?.autoObservations)
    ? (node.meta.autoObservations as ScriptFlowAutoObservation[])
    : [];
}

function hasNodeMessages(node: ScriptFlowNode) {
  return readNodeObservations(node).length > 0;
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
  runtimeRun: ScriptFlowRuntimeRunAggregate | undefined,
  replayEvent: ScriptFlowRuntimeReplayEvent | undefined,
  selectedNodeId: string | null,
  orientation: "LR" | "TB",
  searchMatches: Array<{ nodeId: string }>,
  problemOnly: boolean,
) {
  const runtimeNodes = runtimeRun?.nodes ?? {};
  const sourceNodes = problemOnly
    ? snapshot.nodes.filter((node) => hasNodeMessages(node))
    : snapshot.nodes;
  const visibleNodeIds = new Set(sourceNodes.map((node) => node.id));
  const searchHitIds = new Set(searchMatches.map((m) => m.nodeId));
  const nodes: Array<Node<FlowNodeData>> = sourceNodes.map((node) => {
    const runtimeNode = runtimeNodes[node.id];
    const nodeReplay =
      replayEvent?.nodeId === node.id
        ? {
            label: replayLabel(replayEvent),
            error: replayEvent.event === "span_error",
          }
        : undefined;
    return {
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
        ...(runtimeNode || nodeReplay
          ? { runtime: toFlowNodeRuntime(runtimeNode, nodeReplay) }
          : {}),
        ...(nodeReplay ? { replay: nodeReplay } : {}),
        searchHit: searchHitIds.has(node.id),
      },
    };
  });

  const entryIds = new Set(
    sourceNodes
      .filter((node) => node.kind === "entry")
      .map((node) => node.id),
  );
  const selectedNode = selectedNodeId
    ? sourceNodes.find((node) => node.id === selectedNodeId)
    : undefined;
  // Only scope-highlight when a function (or the entry/main process) is selected:
  // those nodes own a body subgraph. Selecting a lone if/loop dims nothing.
  const scopeEdges =
    selectedNode &&
    (selectedNode.kind === "function" || selectedNode.kind === "entry")
      ? collectScopeEdges(snapshot, selectedNode.id)
      : null;

  const visibleEdges = snapshot.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  );
  const edges: Edge[] = visibleEdges.map((edge, index) => {
    const isLoop = edge.label === "loop";
    const isEntry = entryIds.has(edge.from);
    const runtimeEdge = pickRuntimeEdge(runtimeNodes[edge.from], runtimeNodes[edge.to]);
    const replayEdgeLevel =
      replayEvent && (edge.from === replayEvent.nodeId || edge.to === replayEvent.nodeId)
        ? replayEvent.event === "span_error"
          ? "error"
          : "medium"
        : undefined;
    const isHot = scopeEdges
      ? scopeEdges.has(`${edge.from}->${edge.to}`)
      : true;
    const isActiveEdge = isEntry || isHot;
    const color = replayEdgeLevel
      ? runtimeColor(replayEdgeLevel)
      : runtimeEdge
      ? runtimeColor(runtimeEdge.level)
      : isLoop
      ? LOOP_FLOW_COLOR
      : isActiveEdge
        ? ACTIVE_FLOW_COLOR
        : INACTIVE_FLOW_COLOR;
    return {
      id: `${edge.kind}:${edge.from}:${edge.to}:${index}`,
      source: edge.from,
      target: edge.to,
      label: edge.label,
      animated: isActiveEdge || Boolean(replayEdgeLevel),
      className: [
        "script-flow-edge",
        isActiveEdge ? "script-flow-edge--active" : "",
        isLoop ? "script-flow-edge--loop" : "",
        isEntry ? "script-flow-edge--entry" : "",
        runtimeEdge || replayEdgeLevel ? "script-flow-edge--runtime" : "",
        replayEdgeLevel ? "script-flow-edge--replay" : "",
        replayEdgeLevel
          ? `script-flow-edge--runtime-${replayEdgeLevel}`
          : runtimeEdge
            ? `script-flow-edge--runtime-${runtimeEdge.level}`
            : "",
      ]
        .filter(Boolean)
        .join(" "),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      style: {
        stroke: color,
        strokeWidth: replayEdgeLevel
          ? 3.3
          : runtimeEdge
            ? 3
            : isActiveEdge
              ? isEntry
                ? 2.8
                : 2.6
              : 2.1,
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
  for (const node of sourceNodes) {
    const gaps = readNodeObservations(node).filter(
      (obs) => obs.kind === "flow-gap",
    );
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

function toFlowNodeRuntime(
  node: ScriptFlowRuntimeNodeAggregate | undefined,
  replay?: { error: boolean },
): FlowNodeRuntimeData {
  const active = Boolean(replay) || Boolean(node?.activeSpans.length);
  const calls = node ? Math.max(node.count, node.externalCalls.count) : 0;
  const avgMs = node ? Math.max(node.avgMs, node.externalCalls.avgMs) : 0;
  const maxMs = node
    ? Math.max(node.maxMs, node.externalCalls.maxMs, node.loop.maxMs)
    : 0;
  const errors = (node?.errorCount ?? 0) + (replay?.error && !node?.errorCount ? 1 : 0);
  const iterations = node?.loop.iterations ?? 0;
  return {
    active,
    calls,
    avgMs,
    maxMs,
    errors,
    iterations,
    level: replay?.error
      ? "error"
      : classifyRuntimeLevel({ active, avgMs, maxMs, errors, iterations }),
  };
}

function pickRuntimeEdge(
  from: ScriptFlowRuntimeNodeAggregate | undefined,
  to: ScriptFlowRuntimeNodeAggregate | undefined,
) {
  const source = from?.eventCount ? from : to?.eventCount ? to : undefined;
  return source ? toFlowNodeRuntime(source) : undefined;
}

function classifyRuntimeLevel(input: {
  active: boolean;
  avgMs: number;
  maxMs: number;
  errors: number;
  iterations: number;
}): FlowNodeRuntimeData["level"] {
  if (input.errors > 0) {
    return "error";
  }
  if (input.maxMs >= 1000 || input.avgMs >= 500 || input.iterations >= 100000) {
    return "high";
  }
  if (input.maxMs >= 250 || input.avgMs >= 100 || input.iterations >= 1000) {
    return "medium";
  }
  return input.active ? "medium" : "low";
}

function runtimeColor(level: FlowNodeRuntimeData["level"]) {
  switch (level) {
    case "error":
      return "var(--status-failed)";
    case "high":
      return "var(--cortex-level-warn)";
    case "medium":
      return "var(--status-in-progress)";
    case "low":
      return "var(--accent-cyan)";
  }
}

function RuntimeLegend(props: { runId: string; warnings: number }) {
  return (
    <div className="sf-runtime-legend">
      <span className="sf-runtime-legend__eyebrow">Runtime evidence</span>
      <span>Run {shortRunId(props.runId)}</span>
      <span className="sf-runtime-legend__dot sf-runtime-legend__dot--low" />
      <span>low</span>
      <span className="sf-runtime-legend__dot sf-runtime-legend__dot--medium" />
      <span>medium</span>
      <span className="sf-runtime-legend__dot sf-runtime-legend__dot--high" />
      <span>hot/error</span>
      {props.warnings > 0 ? <span>warnings {props.warnings}</span> : null}
    </div>
  );
}

function shortRunId(runId: string) {
  return runId.length > 10 ? `${runId.slice(0, 10)}…` : runId;
}

function formatRunOption(run: ScriptFlowRuntimeRunAggregate) {
  const status = run.status ?? "running";
  const started = formatDateTime(run.startedAt);
  return `${shortRunId(run.runId)} · ${status} · ${started}`;
}

function formatReplayEvent(event: ScriptFlowRuntimeReplayEvent) {
  if (event.event === "span_error") {
    return `error ${shortRunId(event.nodeId)}`;
  }
  if (event.event === "span_end") {
    return `end ${shortRunId(event.nodeId)}`;
  }
  return `start ${shortRunId(event.nodeId)}`;
}

function replayLabel(event: ScriptFlowRuntimeReplayEvent) {
  if (event.event === "span_error") {
    return "replay error";
  }
  if (event.event === "span_end") {
    return "replay end";
  }
  return "replay active";
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return "start ?";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0ms";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
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

function downloadMarkdownReport(snapshot: ScriptFlowSnapshot) {
  const markdown = buildMarkdownReport(snapshot);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const base = shortFilename(snapshot.metadata.path).replace(/\.[^.]+$/, "");
  link.download = `${base || "script-flow"}-report.md`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function buildMarkdownReport(snapshot: ScriptFlowSnapshot) {
  const summary = summarizeNodeMessages(snapshot.nodes);
  const lines = [
    "# Script Flow report",
    "",
    `- File: \`${escapeMarkdownInline(snapshot.metadata.path)}\``,
    `- Language: \`${snapshot.metadata.language}\``,
    `- Parsed at: \`${snapshot.metadata.parsedAt}\``,
    `- Nodes: ${snapshot.nodes.length}`,
    `- Edges: ${snapshot.edges.length}`,
    `- Messages: ${summary.total}`,
    "",
    "## Summary",
    "",
    "| Type | Count |",
    "| --- | ---: |",
    `| Errors | ${summary.error} |`,
    `| Warnings | ${summary.warning} |`,
    `| Info | ${summary.info} |`,
    `| Flow gaps | ${summary["flow-gap"]} |`,
    "",
    "## Messages",
    "",
  ];

  const messageItems = snapshot.nodes.flatMap((node) =>
    readNodeObservations(node).map((observation) => ({ node, observation })),
  );

  if (messageItems.length === 0) {
    lines.push("No messages detected.", "");
    return `${lines.join("\n")}\n`;
  }

  messageItems.forEach(({ node, observation }, index) => {
    const hint = getScriptFlowFixHint(observation);
    lines.push(
      `### ${index + 1}. ${observation.severity.toUpperCase()} · ${messageKindLabel(observation.kind)}`,
      "",
      `- Message: ${escapeMarkdownText(observation.message)}`,
      `- Node: \`${escapeMarkdownInline(node.label)}\` (${KIND_LABELS[node.kind]})`,
    );
    if (typeof observation.line === "number") {
      lines.push(`- Line: ${observation.line}`);
    }
    if (observation.source) {
      lines.push(`- Source: \`${escapeMarkdownInline(observation.source)}\``);
    }
    if (node.range) {
      lines.push(`- Range: ${formatRangeLabel(node)}`);
    }
    lines.push(`- Hint: ${escapeMarkdownText(hint)}`, "");
  });

  return `${lines.join("\n")}\n`;
}

function messageKindLabel(kind: ScriptFlowAutoObservation["kind"]) {
  switch (kind) {
    case "flow-gap":
      return "Flow gap";
    case "diagnostic":
      return "Diagnostic";
    case "inline":
      return "Inline note";
  }
}

function escapeMarkdownInline(value: string) {
  return value.replace(/`/g, "\\`");
}

function escapeMarkdownText(value: string) {
  return value.replace(/\r?\n/g, " ").trim();
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
