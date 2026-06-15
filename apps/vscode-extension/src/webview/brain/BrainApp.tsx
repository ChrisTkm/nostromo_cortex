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
  type NodeProps,
} from "@xyflow/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  isPersistedState,
  isSnapshot,
  reconcileHiddenNodeIds,
  reconcileSelectedNodeId,
} from "./state";
import type { PersistedBrainState } from "./state";
import type {
  BrainEdge,
  BrainHostMessage,
  BrainIssueKind,
  BrainNode,
  BrainSnapshot,
} from "../../brain/types";
import { PageHeader } from "../components/PageHeader";

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
  kind: BrainNode["kind"];
  label: string;
  subtitle?: string;
  badge?: string;
  layer?: string;
  count?: number;
  issue?: BrainIssueKind;
};

const vscode = window.acquireVsCodeApi();
const NODE_WIDTH = 236;
const NODE_HEIGHT = 92;
const GRAPH_KINDS = ["doc", "tag", "account", "external"] as const;
const EDGE_FILTERS = [
  "link",
  "upstream",
  "downstream",
  "references",
  "standards",
  "account",
  "tag",
  "unresolved",
] as const;
const nodeTypes = { brain: BrainNodeComponent };
type EdgeFilter = (typeof EDGE_FILTERS)[number];
type LayoutMode = "flow" | "orbit";
type RelatedLink = {
  node: BrainNode;
  direction: "from" | "to";
  relation: EdgeFilter;
};

const ISSUE_SEVERITY: Record<BrainIssueKind, number> = {
  truncated: 5,
  cycle: 4,
  "broken-ref": 3,
  "self-reference": 2,
  orphan: 1,
};
const ISSUE_LABEL: Record<BrainIssueKind, string> = {
  truncated: "Scan truncated",
  cycle: "Cycles",
  "broken-ref": "Broken references",
  "self-reference": "Self-references",
  orphan: "Orphans",
};
const ISSUE_ORDER: BrainIssueKind[] = [
  "truncated",
  "cycle",
  "broken-ref",
  "self-reference",
  "orphan",
];

export function BrainApp() {
  const persisted = useMemo<PersistedBrainState | null>(() => {
    const state = vscode.getState();
    if (isPersistedState(state)) return state;
    if (isSnapshot(state)) return { snapshot: state };
    return null;
  }, []);

  const [snapshot, setSnapshot] = useState<BrainSnapshot | null>(
    persisted?.snapshot ?? null,
  );
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>(
    persisted?.hiddenNodeIds && persisted.snapshot
      ? reconcileHiddenNodeIds(persisted.hiddenNodeIds, persisted.snapshot)
      : [],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    persisted?.selectedNodeId != null && persisted.snapshot
      ? reconcileSelectedNodeId(persisted.selectedNodeId, persisted.snapshot)
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibleKinds, setVisibleKinds] = useState<Array<BrainNode["kind"]>>([
    "doc",
  ]);
  const [visibleEdges, setVisibleEdges] = useState<EdgeFilter[]>([]);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("flow");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<BrainHostMessage>) {
      const message = event.data;
      if (message?.type === "brain:snapshot") {
        setSnapshot(message.snapshot);
        setError(null);
        setHiddenNodeIds((current) =>
          reconcileHiddenNodeIds(current, message.snapshot),
        );
        setSelectedNodeId((current) =>
          reconcileSelectedNodeId(current, message.snapshot),
        );
        return;
      }
      if (message?.type === "brain:error") {
        setError(message.error);
      }
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    vscode.setState({
      snapshot,
      hiddenNodeIds,
      selectedNodeId,
    } satisfies PersistedBrainState);
  }, [snapshot, hiddenNodeIds, selectedNodeId]);

  const flow = useMemo(
    () =>
      snapshot
        ? buildFlow(
            snapshot,
            deferredQuery,
            visibleKinds,
            visibleEdges,
            hiddenNodeIds,
            selectedNodeId,
            layoutMode,
          )
        : { nodes: [], edges: [] },
    [
      deferredQuery,
      hiddenNodeIds,
      layoutMode,
      snapshot,
      selectedNodeId,
      visibleEdges,
      visibleKinds,
    ],
  );
  const selectedNode =
    snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedLinks = useMemo(
    () =>
      snapshot && selectedNode
        ? relatedLinks(snapshot, selectedNode.id, visibleEdges)
        : [],
    [selectedNode, snapshot, visibleEdges],
  );
  const nodesByKind = useMemo(
    () =>
      snapshot
        ? groupNodesByKind(snapshot.nodes)
        : new Map<BrainNode["kind"], BrainNode[]>(),
    [snapshot],
  );

  function showKind(kind: BrainNode["kind"]) {
    setVisibleKinds((current) =>
      current.includes(kind) ? current : [...current, kind],
    );
    setHiddenNodeIds((current) => {
      const ids = new Set(nodesByKind.get(kind)?.map((node) => node.id) ?? []);
      return current.filter((id) => !ids.has(id));
    });
  }

  function hideKind(kind: BrainNode["kind"]) {
    setVisibleKinds((current) => current.filter((item) => item !== kind));
  }

  function setNodeVisible(node: BrainNode, isVisible: boolean) {
    if (isVisible) {
      setVisibleKinds((current) =>
        current.includes(node.kind) ? current : [...current, node.kind],
      );
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
    setHiddenNodeIds((current) =>
      current.includes(node.id) ? current : [...current, node.id],
    );
    if (selectedNodeId === node.id) {
      setSelectedNodeId(null);
    }
  }

  function setPreset(preset: "docs" | "refs" | "full") {
    setHiddenNodeIds([]);
    if (preset === "docs") {
      setLayoutMode("flow");
      setVisibleKinds(["doc"]);
      setVisibleEdges([]);
      return;
    }
    if (preset === "refs") {
      setLayoutMode("orbit");
      setVisibleKinds(["doc", "tag", "account", "external"]);
      setVisibleEdges([
        "upstream",
        "downstream",
        "references",
        "standards",
        "account",
        "tag",
        "unresolved",
      ]);
      return;
    }
    setLayoutMode("flow");
    setVisibleKinds(["doc", "tag", "account", "external"]);
    setVisibleEdges([...EDGE_FILTERS]);
  }

  function toggleEdgeFilter(edge: EdgeFilter) {
    setVisibleEdges((current) =>
      current.includes(edge)
        ? current.filter((item) => item !== edge)
        : [...current, edge],
    );
  }

  return (
    <div className="brain-app">
      <PageHeader
        title="CORTEX BRAIN"
        subtitle={
          snapshot
            ? snapshot.rootPath
            : "Choose a folder with .md or .mdx files."
        }
        actions={
          <>
            <button
              onClick={() => vscode.postMessage({ type: "brain:pickFolder" })}
              type="button"
            >
              Folder
            </button>
            <button
              onClick={() => vscode.postMessage({ type: "brain:refresh" })}
              type="button"
            >
              Refresh
            </button>
          </>
        }
      />

      {snapshot ? (
        <section className="brain-toolbar">
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter docs, tags, accounts..."
            type="search"
            value={query}
          />
          <div className="brain-presets" aria-label="View presets">
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
          <div className="brain-layout-toggle" aria-label="Layout mode">
            <button
              className={layoutMode === "flow" ? "is-active" : ""}
              onClick={() => setLayoutMode("flow")}
              type="button"
            >
              Flow
            </button>
            <button
              className={layoutMode === "orbit" ? "is-active" : ""}
              onClick={() => setLayoutMode("orbit")}
              type="button"
            >
              Orbit
            </button>
          </div>
          <div className="brain-edge-filters" aria-label="Relation filters">
            {EDGE_FILTERS.map((edge) => (
              <button
                className={visibleEdges.includes(edge) ? "is-active" : ""}
                key={edge}
                onClick={() => toggleEdgeFilter(edge)}
                type="button"
              >
                {edge}
              </button>
            ))}
          </div>
          <div className="brain-kinds">
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
          <div className="brain-stats">
            <span>{snapshot.stats.fileCount} files</span>
            <span>{snapshot.edges.length} edges</span>
            {snapshot.issues.some((issue) => issue.kind === "truncated") ? (
              <span
                className="brain-stats__truncated"
                title="Scan reached cortex.brainMaxFiles. Some .md/.mdx files were not analyzed."
              >
                Scan truncated ({snapshot.stats.fileCount}/+)
              </span>
            ) : null}
            {snapshot.issues.length > 0 ? (
              <span className="brain-stats__warn">
                {snapshot.issues.length} issues
              </span>
            ) : null}
            <span>{snapshot.stats.elapsedMs} ms</span>
          </div>
        </section>
      ) : null}

      <main className="brain-main">
        {snapshot ? (
          <>
            <section className="brain-canvas">
              <ReactFlow
                fitView
                fitViewOptions={{ maxZoom: 1.05, padding: 0.18 }}
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onNodeDoubleClick={(_, node) =>
                  vscode.postMessage({
                    type: "brain:openNode",
                    nodeId: node.id,
                  })
                }
                proOptions={{ hideAttribution: true }}
              >
                <Controls />
                <MiniMap
                  pannable
                  zoomable
                  nodeStrokeWidth={3}
                  nodeColor={(node) =>
                    colorForKind((node.data as GraphNodeData).kind)
                  }
                />
                <Background
                  color="rgba(148, 163, 184, 0.12)"
                  gap={22}
                  size={1}
                  variant={BackgroundVariant.Dots}
                />
              </ReactFlow>
            </section>
            <BrainInspector
              node={selectedNode}
              onSelectNode={setSelectedNodeId}
              related={selectedLinks}
              snapshot={snapshot}
            />
          </>
        ) : (
          <section className="brain-empty">
            <h2>{error ? "Could not scan folder" : "No folder selected"}</h2>
            <p>
              {error ??
                "Pick any local documentation folder and Cortex will scan .md/.mdx links, tags, accounts, and routes."}
            </p>
            <button
              onClick={() => vscode.postMessage({ type: "brain:pickFolder" })}
              type="button"
            >
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
  visibleKinds,
}: {
  hiddenNodeIds: string[];
  kind: BrainNode["kind"];
  nodes: BrainNode[];
  onHideKind(kind: BrainNode["kind"]): void;
  onSetNodeVisible(node: BrainNode, isVisible: boolean): void;
  onShowKind(kind: BrainNode["kind"]): void;
  visibleKinds: Array<BrainNode["kind"]>;
}) {
  const hidden = new Set(hiddenNodeIds);
  const kindIsVisible = visibleKinds.includes(kind);
  const visibleCount = kindIsVisible
    ? nodes.filter((node) => !hidden.has(node.id)).length
    : 0;

  return (
    <details
      className={`brain-kind-filter${kindIsVisible ? " is-active" : ""}`}
    >
      <summary>
        <span className="brain-kind-filter__name">{kind}</span>
        <span className="brain-kind-filter__count">
          {visibleCount}/{nodes.length}
        </span>
      </summary>
      <div className="brain-kind-filter__panel">
        <div className="brain-kind-filter__actions">
          <button onClick={() => onShowKind(kind)} type="button">
            All
          </button>
          <button onClick={() => onHideKind(kind)} type="button">
            None
          </button>
        </div>
        <div className="brain-kind-filter__list">
          {nodes.length === 0 ? <p>No {kind} nodes.</p> : null}
          {nodes.map((node) => {
            const checked = kindIsVisible && !hidden.has(node.id);
            return (
              <label key={node.id}>
                <input
                  checked={checked}
                  onChange={(event) =>
                    onSetNodeVisible(node, event.target.checked)
                  }
                  type="checkbox"
                />
                <span>{node.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function BrainNodeComponent({
  data,
  selected,
}: NodeProps<Node<GraphNodeData>>) {
  return (
    <div
      className={`brain-node brain-node--${data.kind}${data.issue ? ` brain-node--${data.issue}` : ""}${selected ? " brain-node--selected" : ""}`}
    >
      <Handle position={Position.Left} type="target" />
      <div className="brain-node__top">
        <span className="brain-node__kind">
          {data.badge ?? data.layer ?? data.kind}
        </span>
        {typeof data.count === "number" ? (
          <span className="brain-node__count">{data.count}</span>
        ) : null}
      </div>
      <div className="brain-node__label">{data.label}</div>
      {data.subtitle ? (
        <div className="brain-node__subtitle">{data.subtitle}</div>
      ) : null}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function BrainInspector({
  node,
  onSelectNode,
  related,
  snapshot,
}: {
  node: BrainNode | null;
  onSelectNode(nodeId: string): void;
  related: RelatedLink[];
  snapshot: BrainSnapshot;
}) {
  if (!node) {
    const labelOf = (id: string) =>
      snapshot.nodes.find((item) => item.id === id)?.label ?? id;
    return (
      <aside className="brain-inspector">
        <div className="brain-inspector__label">Overview</div>
        <h2>{snapshot.stats.fileCount} documents</h2>
        <p>
          {snapshot.stats.tagCount} tags, {snapshot.stats.accountCount}{" "}
          accounts, {snapshot.stats.unresolvedCount} unresolved references.
        </p>
        <section>
          <h3>Issues ({snapshot.issues.length})</h3>
          {snapshot.issues.length === 0 ? (
            <p className="brain-muted">
              No issues — the related tree is healthy.
            </p>
          ) : null}
          {ISSUE_ORDER.map((kind) => {
            const items = snapshot.issues.filter(
              (issue) => issue.kind === kind,
            );
            if (items.length === 0) {
              return null;
            }
            return (
              <div className="brain-issue-group" key={kind}>
                <p className="brain-issue-group__title">
                  {ISSUE_LABEL[kind]} ({items.length})
                </p>
                <div className="brain-related">
                  {items.slice(0, 30).map((issue, index) => {
                    const isWorkspace = issue.nodeId === "__workspace__";
                    if (isWorkspace) {
                      return (
                        <span
                          key={`${issue.nodeId}-${index}`}
                          className="brain-inspector__issue-workspace"
                        >
                          {issue.detail ?? "Workspace"}
                        </span>
                      );
                    }
                    return (
                      <button
                        key={`${issue.nodeId}-${index}`}
                        onClick={() => onSelectNode(issue.nodeId)}
                        type="button"
                      >
                        <span>{kind}</span>
                        {labelOf(issue.nodeId)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      </aside>
    );
  }

  const nodeIssues = snapshot.issues.filter(
    (issue) => issue.nodeId === node.id,
  );

  return (
    <aside className="brain-inspector">
      <div className="brain-inspector__label">{node.kind}</div>
      <h2>{node.label}</h2>
      {node.route ? (
        <p className="brain-inspector__route">{node.route}</p>
      ) : null}
      {nodeIssues.length > 0 ? (
        <p className="brain-inspector__warn">
          {nodeIssues.map((issue) => ISSUE_LABEL[issue.kind]).join(" · ")}
        </p>
      ) : null}
      {node.description ? <p>{node.description}</p> : null}
      {node.domain || node.layer || node.docKind || node.badge ? (
        <dl className="brain-inspector__meta">
          {node.badge ? (
            <>
              <dt>Badge</dt>
              <dd>{node.badge}</dd>
            </>
          ) : null}
          {node.domain ? (
            <>
              <dt>Domain</dt>
              <dd>{node.domain}</dd>
            </>
          ) : null}
          {node.layer ? (
            <>
              <dt>Layer</dt>
              <dd>{node.layer}</dd>
            </>
          ) : null}
          {node.docKind ? (
            <>
              <dt>Kind</dt>
              <dd>{node.docKind}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {node.tags?.length ? (
        <div className="brain-inspector__chips">
          {node.tags.slice(0, 12).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      {node.kind === "doc" ? (
        <button
          onClick={() =>
            vscode.postMessage({ type: "brain:openNode", nodeId: node.id })
          }
          type="button"
        >
          Open document
        </button>
      ) : null}
      <section>
        <h3>Connected</h3>
        {related.length === 0 ? (
          <p className="brain-muted">No visible relations.</p>
        ) : null}
        <div className="brain-related">
          {related.slice(0, 24).map((item) => (
            <button
              className={`brain-related__item brain-related__item--${item.relation}`}
              key={`${item.direction}:${item.relation}:${item.node.id}`}
              onClick={() => onSelectNode(item.node.id)}
              type="button"
            >
              <span>
                {item.direction === "from" ? "from this doc" : "to this doc"} ·{" "}
                {item.relation}
              </span>
              {item.node.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function buildFlow(
  snapshot: BrainSnapshot,
  query: string,
  visibleKinds: Array<BrainNode["kind"]>,
  visibleEdges: EdgeFilter[],
  hiddenNodeIds: string[],
  selectedNodeId: string | null,
  layoutMode: LayoutMode,
) {
  const visible = new Set(visibleKinds);
  const visibleEdgeSet = new Set(visibleEdges);
  const hidden = new Set(hiddenNodeIds);
  const degree = buildDegreeMap(snapshot, visibleEdgeSet);
  const issueByNode = new Map<string, BrainIssueKind>();
  for (const issue of snapshot.issues) {
    const current = issueByNode.get(issue.nodeId);
    if (!current || ISSUE_SEVERITY[issue.kind] > ISSUE_SEVERITY[current]) {
      issueByNode.set(issue.nodeId, issue.kind);
    }
  }
  const matchingNodeIds = new Set(
    snapshot.nodes
      .filter((node) => visible.has(node.kind))
      .filter((node) => !hidden.has(node.id))
      .filter((node) => {
        if (!query) {
          return true;
        }
        return `${node.label} ${node.route ?? ""} ${node.description ?? ""} ${(node.tags ?? []).join(" ")}`
          .toLowerCase()
          .includes(query);
      })
      .map((node) => node.id),
  );
  const orbitNodeIds =
    layoutMode === "orbit" && selectedNodeId
      ? focusedNeighborhood(
          snapshot,
          selectedNodeId,
          matchingNodeIds,
          visibleEdgeSet,
        )
      : null;
  const flowNodeIds = orbitNodeIds ?? matchingNodeIds;

  const nodes: Array<Node<GraphNodeData>> = snapshot.nodes
    .filter((node) => flowNodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      type: "brain",
      selected: node.id === selectedNodeId,
      position: { x: 0, y: 0 },
      // Seed dimensions so the MiniMap can draw node rects (nodes are rebuilt
      // each render without useNodesState, so measured sizes never persist).
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      data: {
        kind: node.kind,
        label: node.label,
        subtitle:
          node.kind === "doc"
            ? (node.docKind ?? compactRoute(node.route))
            : node.kind,
        badge: node.badge,
        layer: node.layer,
        count: degree.get(node.id) ?? 0,
        issue: issueByNode.get(node.id),
      },
    }));

  const edges: Edge[] = snapshot.edges
    .filter((edge) => visibleEdgeSet.has(edgeFilterFor(edge)))
    .filter((edge) => flowNodeIds.has(edge.from) && flowNodeIds.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label && edge.label !== "link" ? edge.label : undefined,
      animated: edge.label === "references",
      type: layoutMode === "orbit" ? "bezier" : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, color: colorForEdge(edge) },
      style: {
        stroke: colorForEdge(edge),
        opacity:
          edge.kind === "unresolved"
            ? 0.45
            : edge.label === "references"
              ? 0.92
              : 0.72,
        strokeWidth:
          edge.label === "upstream" ||
          edge.label === "downstream" ||
          edge.label === "references" ||
          edge.label === "standards"
            ? 2.4
            : edge.kind === "link"
              ? 2
              : 1.5,
        strokeDasharray: edge.kind === "unresolved" ? "5 5" : undefined,
      },
    }));

  if (
    layoutMode === "orbit" &&
    selectedNodeId &&
    nodes.some((node) => node.id === selectedNodeId)
  ) {
    return computeOrbitLayout(nodes, edges, selectedNodeId);
  }

  return computeLayout(nodes, edges);
}

function computeLayout(nodes: Array<Node<GraphNodeData>>, edges: Edge[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 44,
    ranksep: 110,
    marginx: 40,
    marginy: 40,
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
        data: {
          ...node.data,
          label: node.data.label,
          subtitle: node.data.subtitle,
        },
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - NODE_HEIGHT / 2,
        },
      };
    }),
    edges,
  };
}

function computeOrbitLayout(
  nodes: Array<Node<GraphNodeData>>,
  edges: Edge[],
  selectedNodeId: string,
) {
  const selected = nodes.find((node) => node.id === selectedNodeId);
  if (!selected) {
    return computeLayout(nodes, edges);
  }

  const groups = new Map<EdgeFilter, Array<Node<GraphNodeData>>>();
  for (const edge of edges) {
    if (edge.source !== selectedNodeId && edge.target !== selectedNodeId) {
      continue;
    }
    const neighborId =
      edge.source === selectedNodeId ? edge.target : edge.source;
    const neighbor = nodes.find((node) => node.id === neighborId);
    if (!neighbor) {
      continue;
    }
    const relation = edgeFilterForId(edge.id);
    const bucket = groups.get(relation) ?? [];
    if (!bucket.some((item) => item.id === neighbor.id)) {
      bucket.push(neighbor);
    }
    groups.set(relation, bucket);
  }

  const positioned = new Map<string, { x: number; y: number }>();
  positioned.set(selectedNodeId, { x: 0, y: 0 });
  const slots: Array<{
    relation: EdgeFilter;
    start: number;
    end: number;
    radius: number;
  }> = [
    { relation: "upstream", start: 150, end: 210, radius: 360 },
    { relation: "downstream", start: -30, end: 30, radius: 360 },
    { relation: "references", start: 45, end: 135, radius: 330 },
    { relation: "standards", start: 225, end: 315, radius: 330 },
    { relation: "account", start: 315, end: 405, radius: 420 },
    { relation: "tag", start: 250, end: 290, radius: 470 },
    { relation: "link", start: 110, end: 250, radius: 500 },
    { relation: "unresolved", start: 20, end: 80, radius: 500 },
  ];

  for (const slot of slots) {
    const items = groups.get(slot.relation) ?? [];
    items.forEach((node, index) => {
      if (positioned.has(node.id)) {
        return;
      }
      const spread = slot.end - slot.start;
      const angle =
        items.length === 1
          ? (slot.start + slot.end) / 2
          : slot.start + (spread * index) / Math.max(items.length - 1, 1);
      const radians = (angle * Math.PI) / 180;
      const radius = slot.radius + Math.floor(index / 8) * 120;
      positioned.set(node.id, {
        x: Math.cos(radians) * radius,
        y: Math.sin(radians) * radius,
      });
    });
  }

  let fallbackIndex = 0;
  return {
    nodes: nodes.map((node) => {
      const position = positioned.get(node.id) ?? {
        x: Math.cos(fallbackIndex) * 560,
        y: Math.sin(fallbackIndex++) * 560,
      };
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

function focusedNeighborhood(
  snapshot: BrainSnapshot,
  selectedNodeId: string,
  matchingNodeIds: ReadonlySet<string>,
  visibleEdges: ReadonlySet<EdgeFilter>,
) {
  const ids = new Set<string>();
  if (matchingNodeIds.has(selectedNodeId)) {
    ids.add(selectedNodeId);
  }
  for (const edge of snapshot.edges) {
    if (!visibleEdges.has(edgeFilterFor(edge))) {
      continue;
    }
    if (edge.from === selectedNodeId && matchingNodeIds.has(edge.to)) {
      ids.add(selectedNodeId);
      ids.add(edge.to);
    }
    if (edge.to === selectedNodeId && matchingNodeIds.has(edge.from)) {
      ids.add(selectedNodeId);
      ids.add(edge.from);
    }
  }
  return ids.size > 0 ? ids : matchingNodeIds;
}

function buildDegreeMap(
  snapshot: BrainSnapshot,
  visibleEdges = new Set<EdgeFilter>(EDGE_FILTERS),
) {
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

function groupNodesByKind(nodes: BrainNode[]) {
  const grouped = new Map<BrainNode["kind"], BrainNode[]>();
  for (const kind of GRAPH_KINDS) {
    grouped.set(kind, []);
  }
  for (const node of nodes) {
    grouped.get(node.kind)?.push(node);
  }
  for (const [kind, items] of grouped) {
    grouped.set(
      kind,
      items.sort((left, right) => left.label.localeCompare(right.label)),
    );
  }
  return grouped;
}

function relatedLinks(
  snapshot: BrainSnapshot,
  nodeId: string,
  visibleEdges: EdgeFilter[],
): RelatedLink[] {
  const visibleEdgeSet = new Set(visibleEdges);
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const links: RelatedLink[] = [];
  const seen = new Set<string>();
  for (const edge of snapshot.edges) {
    const filter = edgeFilterFor(edge);
    if (!visibleEdgeSet.has(filter)) {
      continue;
    }
    if (edge.from === nodeId) {
      const node = nodesById.get(edge.to);
      const key = `from:${filter}:${edge.to}`;
      if (node && !seen.has(key)) {
        links.push({ node, direction: "from", relation: filter });
        seen.add(key);
      }
    }
    if (edge.to === nodeId) {
      const node = nodesById.get(edge.from);
      const key = `to:${filter}:${edge.from}`;
      if (node && !seen.has(key)) {
        links.push({ node, direction: "to", relation: filter });
        seen.add(key);
      }
    }
  }
  return links.sort(
    (left, right) =>
      left.relation.localeCompare(right.relation) ||
      left.direction.localeCompare(right.direction) ||
      left.node.kind.localeCompare(right.node.kind) ||
      left.node.label.localeCompare(right.node.label),
  );
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

function colorForKind(kind: BrainNode["kind"]) {
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

function edgeFilterFor(edge: BrainEdge): EdgeFilter {
  if (
    edge.kind === "tag" ||
    edge.kind === "account" ||
    edge.kind === "unresolved"
  ) {
    return edge.kind;
  }
  if (
    edge.label === "upstream" ||
    edge.label === "downstream" ||
    edge.label === "references" ||
    edge.label === "standards"
  ) {
    return edge.label;
  }
  return "link";
}

function edgeFilterForId(edgeId: string): EdgeFilter {
  const [, label] = edgeId.split(":");
  if (
    label === "upstream" ||
    label === "downstream" ||
    label === "references" ||
    label === "standards"
  ) {
    return label;
  }
  if (edgeId.startsWith("tag:")) {
    return "tag";
  }
  if (edgeId.startsWith("account:")) {
    return "account";
  }
  if (edgeId.startsWith("unresolved:")) {
    return "unresolved";
  }
  return "link";
}

function colorForEdge(edge: BrainEdge) {
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
