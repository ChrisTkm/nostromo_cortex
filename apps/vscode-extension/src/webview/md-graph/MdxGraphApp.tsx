import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { MdxGraphEdge, MdxGraphHostMessage, MdxGraphNode, MdxGraphSnapshot } from "../../mdGraph/types";

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
  badge?: string;
  layer?: string;
  count?: number;
  isOrphan?: boolean;
};

const vscode = window.acquireVsCodeApi();
const NODE_WIDTH = 236;
const NODE_HEIGHT = 92;
const GRAPH_KINDS = ["doc", "tag", "account", "external"] as const;
const EDGE_FILTERS = ["link", "upstream", "downstream", "references", "standards", "account", "tag", "unresolved"] as const;
const nodeTypes = { brain: BrainNode };
type EdgeFilter = (typeof EDGE_FILTERS)[number];

export function MdxGraphApp() {
  const [snapshot, setSnapshot] = useState<MdxGraphSnapshot | null>(() => {
    const state = vscode.getState();
    return isSnapshot(state) ? state : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibleKinds, setVisibleKinds] = useState<Array<MdxGraphNode["kind"]>>(["doc", "account"]);
  const [visibleEdges, setVisibleEdges] = useState<EdgeFilter[]>(["link", "upstream", "downstream", "references", "standards", "account"]);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<MdxGraphHostMessage>) {
      const message = event.data;
      if (message?.type === "mdxGraph:snapshot") {
        setSnapshot(message.snapshot);
        setError(null);
        setHiddenNodeIds((current) => {
          const knownIds = new Set(message.snapshot.nodes.map((node) => node.id));
          return current.filter((id) => knownIds.has(id));
        });
        setSelectedNodeId(getPrimaryDocId(message.snapshot));
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

  const flow = useMemo(
    () => (snapshot ? buildFlow(snapshot, deferredQuery, visibleKinds, visibleEdges, hiddenNodeIds, selectedNodeId) : { nodes: [], edges: [] }),
    [
    deferredQuery,
    hiddenNodeIds,
    snapshot,
    selectedNodeId,
    visibleEdges,
    visibleKinds
    ]
  );
  const selectedNode = snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedLinks = useMemo(
    () => (snapshot && selectedNode ? relatedNodes(snapshot, selectedNode.id, visibleEdges) : []),
    [selectedNode, snapshot, visibleEdges]
  );
  const nodesByKind = useMemo(() => (snapshot ? groupNodesByKind(snapshot.nodes) : new Map<MdxGraphNode["kind"], MdxGraphNode[]>()), [snapshot]);

  function showKind(kind: MdxGraphNode["kind"]) {
    setVisibleKinds((current) => (current.includes(kind) ? current : [...current, kind]));
    setHiddenNodeIds((current) => {
      const ids = new Set(nodesByKind.get(kind)?.map((node) => node.id) ?? []);
      return current.filter((id) => !ids.has(id));
    });
  }

  function hideKind(kind: MdxGraphNode["kind"]) {
    setVisibleKinds((current) => current.filter((item) => item !== kind));
  }

  function setNodeVisible(node: MdxGraphNode, isVisible: boolean) {
    if (isVisible) {
      setVisibleKinds((current) => (current.includes(node.kind) ? current : [...current, node.kind]));
      setHiddenNodeIds((current) => {
        const hidden = new Set(current);
        hidden.delete(node.id);
        if (!visibleKinds.includes(node.kind)) {
          for (const sibling of nodesByKind.get(node.kind) ?? []) {
            if (sibling.id !== node.id) {
              hidden.add(sibling.id);
            }
          }
        }
        return [...hidden];
      });
      return;
    }
    setHiddenNodeIds((current) => (current.includes(node.id) ? current : [...current, node.id]));
    if (selectedNodeId === node.id) {
      setSelectedNodeId(null);
    }
  }

  function setPreset(preset: "docs" | "refs" | "full") {
    setHiddenNodeIds([]);
    if (preset === "docs") {
      setVisibleKinds(["doc"]);
      setVisibleEdges(["link", "upstream", "downstream", "references", "standards"]);
      return;
    }
    if (preset === "refs") {
      setVisibleKinds(["doc", "account"]);
      setVisibleEdges(["upstream", "downstream", "references", "standards", "account"]);
      return;
    }
    setVisibleKinds(["doc", "tag", "account", "external"]);
    setVisibleEdges([...EDGE_FILTERS]);
  }

  function toggleEdgeFilter(edge: EdgeFilter) {
    setVisibleEdges((current) => (current.includes(edge) ? current.filter((item) => item !== edge) : [...current, edge]));
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
          <div className="md-graph-presets" aria-label="View presets">
            <button onClick={() => setPreset("docs")} type="button">
              Docs
            </button>
            <button onClick={() => setPreset("refs")} type="button">
              Refs
            </button>
            <button onClick={() => setPreset("full")} type="button">
              Full
            </button>
          </div>
          <div className="md-graph-edge-filters" aria-label="Relation filters">
            {EDGE_FILTERS.map((edge) => (
              <button className={visibleEdges.includes(edge) ? "is-active" : ""} key={edge} onClick={() => toggleEdgeFilter(edge)} type="button">
                {edge}
              </button>
            ))}
          </div>
          <div className="md-graph-kinds">
            {GRAPH_KINDS.map((kind) => (
              <KindFilter
                hiddenNodeIds={hiddenNodeIds}
                key={kind}
                kind={kind}
                nodes={nodesByKind.get(kind) ?? []}
                onHideKind={hideKind}
                onSetNodeVisible={setNodeVisible}
                onShowKind={showKind}
                visibleKinds={visibleKinds}
              />
            ))}
          </div>
          <div className="md-graph-stats">
            <span>{snapshot.stats.fileCount} files</span>
            <span>{snapshot.edges.length} edges</span>
            {snapshot.stats.orphanCount > 0 ? (
              <span className="md-graph-stats__warn">{snapshot.stats.orphanCount} orphans</span>
            ) : null}
            <span>{snapshot.stats.elapsedMs} ms</span>
          </div>
        </section>
      ) : null}

      <main className="md-graph-main">
        {snapshot ? (
          <>
            <section className="md-graph-canvas">
              <ReactFlow
                fitView
                fitViewOptions={{ maxZoom: 1.05, padding: 0.18 }}
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onNodeDoubleClick={(_, node) => vscode.postMessage({ type: "mdxGraph:openNode", nodeId: node.id })}
                proOptions={{ hideAttribution: true }}
              >
                <Controls />
                <MiniMap
                  className="md-graph-minimap"
                  pannable
                  zoomable
                  nodeColor={(node) => colorForKind((node.data as GraphNodeData).kind)}
                  maskColor="rgba(3, 7, 18, 0.68)"
                />
                <Background color="rgba(148, 163, 184, 0.12)" gap={22} size={1} variant={BackgroundVariant.Dots} />
              </ReactFlow>
            </section>
            <BrainInspector node={selectedNode} onSelectNode={setSelectedNodeId} related={selectedLinks} snapshot={snapshot} />
          </>
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

function KindFilter({
  hiddenNodeIds,
  kind,
  nodes,
  onHideKind,
  onSetNodeVisible,
  onShowKind,
  visibleKinds
}: {
  hiddenNodeIds: string[];
  kind: MdxGraphNode["kind"];
  nodes: MdxGraphNode[];
  onHideKind(kind: MdxGraphNode["kind"]): void;
  onSetNodeVisible(node: MdxGraphNode, isVisible: boolean): void;
  onShowKind(kind: MdxGraphNode["kind"]): void;
  visibleKinds: Array<MdxGraphNode["kind"]>;
}) {
  const hidden = new Set(hiddenNodeIds);
  const kindIsVisible = visibleKinds.includes(kind);
  const visibleCount = kindIsVisible ? nodes.filter((node) => !hidden.has(node.id)).length : 0;

  return (
    <details className={`md-graph-kind-filter${kindIsVisible ? " is-active" : ""}`}>
      <summary>
        <span className="md-graph-kind-filter__name">{kind}</span>
        <span className="md-graph-kind-filter__count">
          {visibleCount}/{nodes.length}
        </span>
      </summary>
      <div className="md-graph-kind-filter__panel">
        <div className="md-graph-kind-filter__actions">
          <button onClick={() => onShowKind(kind)} type="button">
            All
          </button>
          <button onClick={() => onHideKind(kind)} type="button">
            None
          </button>
        </div>
        <div className="md-graph-kind-filter__list">
          {nodes.length === 0 ? <p>No {kind} nodes.</p> : null}
          {nodes.map((node) => {
            const checked = kindIsVisible && !hidden.has(node.id);
            return (
              <label key={node.id}>
                <input checked={checked} onChange={(event) => onSetNodeVisible(node, event.target.checked)} type="checkbox" />
                <span>{node.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function BrainNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div
      className={`brain-node brain-node--${data.kind}${data.isOrphan ? " brain-node--orphan" : ""}${selected ? " brain-node--selected" : ""}`}
    >
      <Handle position={Position.Left} type="target" />
      <div className="brain-node__top">
        <span className="brain-node__kind">{data.badge ?? data.layer ?? data.kind}</span>
        {typeof data.count === "number" ? <span className="brain-node__count">{data.count}</span> : null}
      </div>
      <div className="brain-node__label">{data.label}</div>
      {data.subtitle ? <div className="brain-node__subtitle">{data.subtitle}</div> : null}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function BrainInspector({
  node,
  onSelectNode,
  related,
  snapshot
}: {
  node: MdxGraphNode | null;
  onSelectNode(nodeId: string): void;
  related: MdxGraphNode[];
  snapshot: MdxGraphSnapshot;
}) {
  if (!node) {
    const orphans = snapshot.nodes.filter((item) => item.kind === "doc" && item.isOrphan);
    return (
      <aside className="md-graph-inspector">
        <div className="md-graph-inspector__label">Overview</div>
        <h2>{snapshot.stats.fileCount} documents</h2>
        <p>{snapshot.stats.tagCount} tags, {snapshot.stats.accountCount} accounts, {snapshot.stats.unresolvedCount} unresolved references.</p>
        <section>
          <h3>Orphans ({orphans.length})</h3>
          {orphans.length === 0 ? (
            <p className="md-graph-muted">Every document hangs from the tree.</p>
          ) : (
            <div className="md-graph-related">
              {orphans.slice(0, 40).map((item) => (
                <button key={item.id} onClick={() => onSelectNode(item.id)} type="button">
                  <span>orphan</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>
    );
  }

  return (
    <aside className="md-graph-inspector">
      <div className="md-graph-inspector__label">{node.kind}</div>
      <h2>{node.label}</h2>
      {node.route ? <p className="md-graph-inspector__route">{node.route}</p> : null}
      {node.isOrphan ? (
        <p className="md-graph-inspector__warn">Orphan — no upstream/downstream in the tree.</p>
      ) : null}
      {node.description ? <p>{node.description}</p> : null}
      {node.domain || node.layer || node.docKind || node.badge ? (
        <dl className="md-graph-inspector__meta">
          {node.badge ? <><dt>Badge</dt><dd>{node.badge}</dd></> : null}
          {node.domain ? <><dt>Domain</dt><dd>{node.domain}</dd></> : null}
          {node.layer ? <><dt>Layer</dt><dd>{node.layer}</dd></> : null}
          {node.docKind ? <><dt>Kind</dt><dd>{node.docKind}</dd></> : null}
        </dl>
      ) : null}
      {node.tags?.length ? (
        <div className="md-graph-inspector__chips">
          {node.tags.slice(0, 12).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      {node.kind === "doc" ? (
        <button onClick={() => vscode.postMessage({ type: "mdxGraph:openNode", nodeId: node.id })} type="button">
          Open document
        </button>
      ) : null}
      <section>
        <h3>Connected</h3>
        {related.length === 0 ? <p className="md-graph-muted">No visible relations.</p> : null}
        <div className="md-graph-related">
          {related.slice(0, 16).map((item) => (
            <button key={item.id} onClick={() => onSelectNode(item.id)} type="button">
              <span>{item.kind}</span>
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function buildFlow(
  snapshot: MdxGraphSnapshot,
  query: string,
  visibleKinds: Array<MdxGraphNode["kind"]>,
  visibleEdges: EdgeFilter[],
  hiddenNodeIds: string[],
  selectedNodeId: string | null
) {
  const visible = new Set(visibleKinds);
  const visibleEdgeSet = new Set(visibleEdges);
  const hidden = new Set(hiddenNodeIds);
  const degree = buildDegreeMap(snapshot, visibleEdgeSet);
  const matchingNodeIds = new Set(
    snapshot.nodes
      .filter((node) => visible.has(node.kind))
      .filter((node) => !hidden.has(node.id))
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
      type: "brain",
      selected: node.id === selectedNodeId,
      position: { x: 0, y: 0 },
      data: {
        kind: node.kind,
        label: node.label,
        subtitle: node.kind === "doc" ? node.docKind ?? compactRoute(node.route) : node.kind,
        badge: node.badge,
        layer: node.layer,
        count: degree.get(node.id) ?? 0,
        isOrphan: node.isOrphan
      }
    }));

  const edges: Edge[] = snapshot.edges
    .filter((edge) => visibleEdgeSet.has(edgeFilterFor(edge)))
    .filter((edge) => matchingNodeIds.has(edge.from) && matchingNodeIds.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label && edge.label !== "link" ? edge.label : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, color: colorForEdge(edge) },
      style: {
        stroke: colorForEdge(edge),
        opacity: edge.kind === "unresolved" ? 0.45 : 0.72,
        strokeWidth:
          edge.label === "upstream" || edge.label === "downstream" || edge.label === "references" || edge.label === "standards"
            ? 2.4
            : edge.kind === "link"
              ? 2
              : 1.5,
        strokeDasharray: edge.kind === "unresolved" ? "5 5" : undefined
      }
    }));

  return computeLayout(nodes, edges);
}

function computeLayout(nodes: Array<Node<GraphNodeData>>, edges: Edge[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 44, ranksep: 110, marginx: 40, marginy: 40 });

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

function buildDegreeMap(snapshot: MdxGraphSnapshot, visibleEdges = new Set<EdgeFilter>(EDGE_FILTERS)) {
  const degree = new Map<string, number>();
  for (const edge of snapshot.edges) {
    if (!visibleEdges.has(edgeFilterFor(edge))) {
      continue;
    }
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return degree;
}

function groupNodesByKind(nodes: MdxGraphNode[]) {
  const grouped = new Map<MdxGraphNode["kind"], MdxGraphNode[]>();
  for (const kind of GRAPH_KINDS) {
    grouped.set(kind, []);
  }
  for (const node of nodes) {
    grouped.get(node.kind)?.push(node);
  }
  for (const [kind, items] of grouped) {
    grouped.set(
      kind,
      items.sort((left, right) => left.label.localeCompare(right.label))
    );
  }
  return grouped;
}

function relatedNodes(snapshot: MdxGraphSnapshot, nodeId: string, visibleEdges: EdgeFilter[]) {
  const visibleEdgeSet = new Set(visibleEdges);
  const ids = new Map<string, EdgeFilter>();
  for (const edge of snapshot.edges) {
    const filter = edgeFilterFor(edge);
    if (!visibleEdgeSet.has(filter)) {
      continue;
    }
    if (edge.from === nodeId) {
      ids.set(edge.to, filter);
    }
    if (edge.to === nodeId) {
      ids.set(edge.from, filter);
    }
  }
  return snapshot.nodes
    .filter((node) => ids.has(node.id))
    .sort((left, right) => (ids.get(left.id) ?? "").localeCompare(ids.get(right.id) ?? "") || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
}

function getPrimaryDocId(snapshot: MdxGraphSnapshot) {
  const degree = buildDegreeMap(snapshot);
  return [...snapshot.nodes]
    .filter((node) => node.kind === "doc")
    .sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0))[0]?.id ?? null;
}

function compactRoute(route?: string) {
  if (!route) {
    return undefined;
  }
  const parts = route.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return route;
  }
  return `/${parts.slice(-2).join("/")}`;
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

function edgeFilterFor(edge: MdxGraphEdge): EdgeFilter {
  if (edge.kind === "tag" || edge.kind === "account" || edge.kind === "unresolved") {
    return edge.kind;
  }
  if (edge.label === "upstream" || edge.label === "downstream" || edge.label === "references" || edge.label === "standards") {
    return edge.label;
  }
  return "link";
}

function colorForEdge(edge: MdxGraphEdge) {
  switch (edgeFilterFor(edge)) {
    case "upstream":
      return "#60a5fa";
    case "downstream":
      return "#a78bfa";
    case "references":
      return "#2dd4bf";
    case "standards":
      return "#f43f5e";
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
