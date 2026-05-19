import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { MdxGraphHostMessage, MdxGraphNode, MdxGraphSnapshot } from "../../mdGraph/types";

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: unknown): void;
      setState(state: unknown): void;
      getState(): unknown;
    };
  }
}

type GraphNodeData = {
  kind: MdxGraphNode["kind"];
  label: string;
  subtitle?: string;
};

const vscode = window.acquireVsCodeApi();
const NODE_WIDTH = 220;
const NODE_HEIGHT = 82;

export function MdxGraphApp() {
  const [snapshot, setSnapshot] = useState<MdxGraphSnapshot | null>(() => {
    const state = vscode.getState();
    return isSnapshot(state) ? state : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibleKinds, setVisibleKinds] = useState<Array<MdxGraphNode["kind"]>>(["doc", "tag", "account", "external"]);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<MdxGraphHostMessage>) {
      const message = event.data;
      if (message?.type === "mdxGraph:snapshot") {
        setSnapshot(message.snapshot);
        setError(null);
        vscode.setState(message.snapshot);
        return;
      }
      if (message?.type === "mdxGraph:error") {
        setError(message.error);
      }
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const flow = useMemo(() => (snapshot ? buildFlow(snapshot, deferredQuery, visibleKinds) : { nodes: [], edges: [] }), [
    deferredQuery,
    snapshot,
    visibleKinds
  ]);

  function toggleKind(kind: MdxGraphNode["kind"]) {
    setVisibleKinds((current) => (current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]));
  }

  return (
    <div className="md-graph-app">
      <header className="md-graph-header">
        <div>
          <h1>Cortex Brain</h1>
          <p>{snapshot ? snapshot.rootPath : "Choose a folder with .md or .mdx files."}</p>
        </div>
        <div className="md-graph-actions">
          <button onClick={() => vscode.postMessage({ type: "mdxGraph:pickFolder" })} type="button">
            Folder
          </button>
          <button onClick={() => vscode.postMessage({ type: "mdxGraph:refresh" })} type="button">
            Refresh
          </button>
        </div>
      </header>

      {snapshot ? (
        <section className="md-graph-toolbar">
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Filter docs, tags, accounts..." type="search" value={query} />
          <div className="md-graph-kinds">
            {(["doc", "tag", "account", "external"] as const).map((kind) => (
              <button className={visibleKinds.includes(kind) ? "is-active" : ""} key={kind} onClick={() => toggleKind(kind)} type="button">
                {kind}
              </button>
            ))}
          </div>
          <div className="md-graph-stats">
            <span>{snapshot.stats.fileCount} files</span>
            <span>{snapshot.edges.length} edges</span>
            <span>{snapshot.stats.elapsedMs} ms</span>
          </div>
        </section>
      ) : null}

      <main className="md-graph-main">
        {snapshot ? (
          <ReactFlow
            fitView
            nodes={flow.nodes}
            edges={flow.edges}
            onNodeDoubleClick={(_, node) => vscode.postMessage({ type: "mdxGraph:openNode", nodeId: node.id })}
            proOptions={{ hideAttribution: true }}
          >
            <Controls />
            <MiniMap pannable zoomable nodeColor={(node) => colorForKind((node.data as GraphNodeData).kind)} />
            <Background color="rgba(148, 163, 184, 0.2)" gap={18} size={1} variant={BackgroundVariant.Dots} />
          </ReactFlow>
        ) : (
          <section className="md-graph-empty">
            <h2>{error ? "Could not scan folder" : "No folder selected"}</h2>
            <p>{error ?? "Pick any local documentation folder and Cortex will scan .md/.mdx links, tags, accounts, and routes."}</p>
            <button onClick={() => vscode.postMessage({ type: "mdxGraph:pickFolder" })} type="button">
              Choose Folder
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function buildFlow(snapshot: MdxGraphSnapshot, query: string, visibleKinds: Array<MdxGraphNode["kind"]>) {
  const visible = new Set(visibleKinds);
  const matchingNodeIds = new Set(
    snapshot.nodes
      .filter((node) => visible.has(node.kind))
      .filter((node) => {
        if (!query) {
          return true;
        }
        return `${node.label} ${node.route ?? ""} ${node.description ?? ""} ${(node.tags ?? []).join(" ")}`.toLowerCase().includes(query);
      })
      .map((node) => node.id)
  );

  const nodes: Array<Node<GraphNodeData>> = snapshot.nodes
    .filter((node) => matchingNodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      position: { x: 0, y: 0 },
      data: {
        kind: node.kind,
        label: node.label,
        subtitle: node.kind === "doc" ? node.route : node.kind
      },
      style: {
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        border: `1px solid ${colorForKind(node.kind)}`,
        borderRadius: 8,
        background: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
        padding: 10,
        fontSize: 12
      }
    }));

  const edges: Edge[] = snapshot.edges
    .filter((edge) => matchingNodeIds.has(edge.from) && matchingNodeIds.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.kind === "unresolved" ? "missing" : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, color: colorForEdge(edge.kind) },
      style: {
        stroke: colorForEdge(edge.kind),
        strokeWidth: edge.kind === "link" ? 2 : 1.4,
        strokeDasharray: edge.kind === "unresolved" ? "5 5" : undefined
      }
    }));

  return computeLayout(nodes, edges);
}

function computeLayout(nodes: Array<Node<GraphNodeData>>, edges: Edge[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 80 });

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
        data: {
          ...node.data,
          label: node.data.label,
          subtitle: node.data.subtitle
        },
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - NODE_HEIGHT / 2
        }
      };
    }),
    edges
  };
}

function colorForKind(kind: MdxGraphNode["kind"]) {
  switch (kind) {
    case "doc":
      return "#38bdf8";
    case "tag":
      return "#22c55e";
    case "account":
      return "#f59e0b";
    case "external":
      return "#94a3b8";
  }
}

function colorForEdge(kind: string) {
  switch (kind) {
    case "tag":
      return "#22c55e";
    case "account":
      return "#f59e0b";
    case "unresolved":
      return "#ef4444";
    default:
      return "#64748b";
  }
}

function isSnapshot(value: unknown): value is MdxGraphSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MdxGraphSnapshot>;
  return typeof candidate.rootPath === "string" && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}
