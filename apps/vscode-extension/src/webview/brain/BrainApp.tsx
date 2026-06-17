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
  reconcileVisibleEdges,
  reconcileVisibleKinds,
} from "./state";
import type { PersistedBrainState } from "./state";
import type {
  BrainEdge,
  BrainHostMessage,
  BrainIssueKind,
  BrainNode,
  BrainSnapshot,
} from "../../brain/types";
import { Button, Metric, Node as AtomNode, Search } from "../components/atoms";
import {
  Footer,
  Header,
  DrawerShell,
  MultiSelect,
  Panel,
  SecondBar,
} from "../components/molecules";
import { Module } from "../components/organisms";

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
const GRAPH_KINDS = ["folder", "doc", "tag", "account", "external"] as const;
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

/**
 * standards/account son relaciones específicas del dominio jean d'arc
 * (contabilidad/normas). En carpetas genéricas no aplican. Variable opt-in:
 * ponela en true para sumarlas a la barra de relaciones y a los kinds.
 * (TODO: promover a setting `cortex.brainDomainRelations` cuando se requiera.)
 */
const SHOW_DOMAIN_RELATIONS = false;

/** Relaciones generales (siempre visibles). */
const RELATION_FILTERS = [
  "link",
  "upstream",
  "downstream",
  "references",
  "tag",
  "unresolved",
] as const;

/** Relaciones de dominio (solo si SHOW_DOMAIN_RELATIONS). */
const DOMAIN_FILTERS = ["standards", "account"] as const;
const VISIBLE_EDGE_FILTERS = SHOW_DOMAIN_RELATIONS
  ? EDGE_FILTERS
  : RELATION_FILTERS;

/** Kinds de nodo según el flag de dominio. */
const VISIBLE_KIND_FILTERS = SHOW_DOMAIN_RELATIONS
  ? GRAPH_KINDS
  : (["folder", "doc", "tag", "external"] as const);
const DEFAULT_VISIBLE_KINDS = ["folder", "doc"] as const;

const nodeTypes = { brain: BrainNodeComponent };
type EdgeFilter = (typeof EDGE_FILTERS)[number];
const REF_PRESET_EDGES: EdgeFilter[] = [
  "upstream",
  "downstream",
  "references",
  "tag",
  "unresolved",
];
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
function isEdgeFilter(value: string): value is EdgeFilter {
  return EDGE_FILTERS.includes(value as EdgeFilter);
}

function setEquals<T>(left: Set<T>, right: Set<T>) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

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
  const [visibleKinds, setVisibleKinds] = useState<Array<BrainNode["kind"]>>(
    persisted?.visibleKinds && persisted.snapshot
      ? reconcileVisibleKinds(
          persisted.visibleKinds,
          persisted.snapshot,
          DEFAULT_VISIBLE_KINDS,
        )
      : [...DEFAULT_VISIBLE_KINDS],
  );
  const [visibleEdges, setVisibleEdges] = useState<EdgeFilter[]>(
    persisted?.visibleEdges
      ? reconcileVisibleEdges(persisted.visibleEdges.filter(isEdgeFilter), [
          ...VISIBLE_EDGE_FILTERS,
        ])
      : [],
  );
  const [showMiniMap, setShowMiniMap] = useState(
    persisted?.showMiniMap ?? true,
  );
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
        setVisibleKinds((current) =>
          reconcileVisibleKinds(
            current,
            message.snapshot,
            DEFAULT_VISIBLE_KINDS,
          ),
        );
        setVisibleEdges((current) =>
          reconcileVisibleEdges(current, [...VISIBLE_EDGE_FILTERS]),
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
      visibleKinds,
      visibleEdges,
      showMiniMap,
    } satisfies PersistedBrainState);
  }, [
    hiddenNodeIds,
    selectedNodeId,
    showMiniMap,
    snapshot,
    visibleEdges,
    visibleKinds,
  ]);

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
          )
        : { nodes: [], edges: [] },
    [
      deferredQuery,
      hiddenNodeIds,
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

  const activePreset = useMemo(() => {
    const kindSet = new Set(visibleKinds);
    const edgeSet = new Set(visibleEdges);
    if (kindSet.size === 1 && kindSet.has("doc") && edgeSet.size === 0)
      return "docs";
    if (
      kindSet.size === 1 &&
      kindSet.has("folder") &&
      edgeSet.has("upstream") &&
      edgeSet.has("downstream")
    )
      return "folder";
    if (
      setEquals(kindSet, new Set(VISIBLE_KIND_FILTERS)) &&
      setEquals(edgeSet, new Set(REF_PRESET_EDGES))
    )
      return "refs";
    if (
      setEquals(kindSet, new Set(VISIBLE_KIND_FILTERS)) &&
      setEquals(edgeSet, new Set(VISIBLE_EDGE_FILTERS))
    )
      return "full";
    return null;
  }, [visibleEdges, visibleKinds]);

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

  function setPreset(preset: "docs" | "folder" | "refs" | "full") {
    if (preset === activePreset) {
      // Toggle off → restaura vista default (ambos kinds, sin flechas)
      setVisibleKinds([...DEFAULT_VISIBLE_KINDS]);
      setVisibleEdges([]);
      setHiddenNodeIds([]);
      return;
    }
    setHiddenNodeIds([]);
    if (preset === "docs") {
      setVisibleKinds(["doc"]);
      setVisibleEdges([]);
      return;
    }
    if (preset === "folder") {
      setVisibleKinds(["folder"]);
      setVisibleEdges(["upstream", "downstream"]);
      return;
    }
    if (preset === "refs") {
      setVisibleKinds([...VISIBLE_KIND_FILTERS]);
      setVisibleEdges([...REF_PRESET_EDGES]);
      return;
    }
    setVisibleKinds([...VISIBLE_KIND_FILTERS]);
    setVisibleEdges([...VISIBLE_EDGE_FILTERS]);
  }

  function toggleEdgeFilter(edge: EdgeFilter) {
    setVisibleEdges((current) =>
      current.includes(edge)
        ? current.filter((item) => item !== edge)
        : [...current, edge],
    );
  }

  const header = (
    <Header
      name="CORTEX BRAIN"
      external={Boolean(snapshot)}
      route={snapshot?.rootPath}
      actions={
        <>
          <Button
            intent="new"
            onClick={() => vscode.postMessage({ type: "brain:pickFolder" })}
            size="small"
          >
            Carpeta
          </Button>
          <Button
            intent="refresh"
            onClick={() => vscode.postMessage({ type: "brain:refresh" })}
            size="small"
          >
            Refresh
          </Button>
          <Button
            intent="change"
            onClick={() => vscode.postMessage({ type: "brain:openGlossary" })}
            size="small"
            title="Glosario: tipos de nodo y flecha"
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
          className="brain-search"
          onChange={setQuery}
          placeholder="Filtrar docs, tags, accounts..."
          value={query}
        />
      }
      filters={
        <div className="brain-filters">
          {/* Columna 1 — Vista: combos rápidos */}
          <div className="brain-group brain-filters__vista" aria-label="Vista">
            <span className="brain-group__label">Vista</span>
            <Button
              className={activePreset === "docs" ? "is-active" : undefined}
              intent="change"
              onClick={() => setPreset("docs")}
              size="small"
            >
              Docs
            </Button>
            <Button
              className={activePreset === "folder" ? "is-active" : undefined}
              intent="change"
              onClick={() => setPreset("folder")}
              size="small"
            >
              Folder
            </Button>
            <Button
              className={activePreset === "refs" ? "is-active" : undefined}
              intent="change"
              onClick={() => setPreset("refs")}
              size="small"
            >
              Refs
            </Button>
            <Button
              className={activePreset === "full" ? "is-active" : undefined}
              intent="change"
              onClick={() => setPreset("full")}
              size="small"
            >
              Full
            </Button>
          </div>

          {/* Columna 2, fila 1 — Nodos: qué kinds se muestran */}
          <div className="brain-group brain-filters__nodos" aria-label="Nodos">
            <span className="brain-group__label">Nodos</span>
            {VISIBLE_KIND_FILTERS.map((kind) => {
              const kindNodes = nodesByKind.get(kind) ?? [];
              const hidden = new Set(hiddenNodeIds);
              const kindVisible = visibleKinds.includes(kind);
              const selected = kindVisible
                ? kindNodes.filter((n) => !hidden.has(n.id)).map((n) => n.id)
                : [];
              return (
                <MultiSelect
                  key={kind}
                  label={kind}
                  onAll={() => showKind(kind)}
                  onNone={() => hideKind(kind)}
                  onToggle={(id) => {
                    const node = kindNodes.find((n) => n.id === id);
                    if (node) setNodeVisible(node, !selected.includes(id));
                  }}
                  options={kindNodes.map((n) => ({
                    value: n.id,
                    label: n.label,
                  }))}
                  selected={selected}
                />
              );
            })}
          </div>

          {/* Columna 2, fila 2 — Flechas: relaciones entre nodos */}
          <div
            className="brain-group brain-filters__flechas"
            aria-label="Flechas"
          >
            <span className="brain-group__label">Flechas</span>
            {RELATION_FILTERS.map((edge) => (
              <Button
                className={
                  visibleEdges.includes(edge) ? "is-active" : undefined
                }
                intent="change"
                key={edge}
                onClick={() => toggleEdgeFilter(edge)}
                size="small"
              >
                {edge}
              </Button>
            ))}
            {SHOW_DOMAIN_RELATIONS
              ? DOMAIN_FILTERS.map((edge) => (
                  <Button
                    className={
                      visibleEdges.includes(edge) ? "is-active" : undefined
                    }
                    intent="change"
                    key={edge}
                    onClick={() => toggleEdgeFilter(edge)}
                    size="small"
                  >
                    {edge}
                  </Button>
                ))
              : null}
          </div>
        </div>
      }
    />
  ) : undefined;

  const footer = snapshot ? (
    <Footer
      left={
        <div className="brain-stats">
          <Metric>{snapshot.stats.fileCount} files</Metric>
          <Metric>{snapshot.edges.length} edges</Metric>
          {snapshot.issues.some((issue) => issue.kind === "truncated") ? (
            <Metric title="Scan reached cortex.brainMaxFiles. Some .md/.mdx files were not analyzed.">
              Scan truncado ({snapshot.stats.fileCount}/+)
            </Metric>
          ) : null}
          {snapshot.issues.length > 0 ? (
            <Metric>{snapshot.issues.length} issues</Metric>
          ) : null}
          <Metric>{snapshot.stats.elapsedMs} ms</Metric>
        </div>
      }
      right={
        <Button
          className={showMiniMap ? "is-active" : undefined}
          intent="change"
          onClick={() => setShowMiniMap((current) => !current)}
          size="small"
        >
          MiniMap
        </Button>
      }
    />
  ) : undefined;

  const drawer = snapshot ? (
    <BrainInspector
      isOpen={Boolean(selectedNode)}
      node={selectedNode}
      onClose={() => setSelectedNodeId(null)}
      onSelectNode={setSelectedNodeId}
      related={selectedLinks}
      snapshot={snapshot}
    />
  ) : undefined;

  return (
    <Module
      drawer={drawer}
      footer={footer}
      header={header}
      secondBar={secondBar}
    >
      <Panel className="brain-main" variant="canvas">
        {snapshot && flow.nodes.length > 0 ? (
          <section className="graph-shell brain-canvas">
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
            >
              <Controls />
              {showMiniMap ? (
                <MiniMap
                  pannable
                  zoomable
                  nodeStrokeWidth={3}
                  nodeColor={(node) =>
                    colorForKind((node.data as GraphNodeData).kind)
                  }
                />
              ) : null}
              <Background
                color="rgba(148, 163, 184, 0.12)"
                gap={22}
                size={1}
                variant={BackgroundVariant.Dots}
              />
            </ReactFlow>
          </section>
        ) : snapshot ? (
          <section className="brain-empty">
            <h2>Sin nodos visibles</h2>
            <p>
              {snapshot.stats.fileCount === 0
                ? "La carpeta seleccionada no contiene archivos .md o .mdx para analizar."
                : "No hay nodos que coincidan con los filtros actuales."}
            </p>
            <Button intent="change" onClick={() => setPreset("docs")}>
              Restablecer vista
            </Button>
          </section>
        ) : (
          <section className="brain-empty">
            <h2>
              {error
                ? "No se pudo escanear la carpeta"
                : "Sin carpeta seleccionada"}
            </h2>
            <p>
              {error ??
                "Elegí una carpeta de documentación local y Cortex escaneará enlaces .md/.mdx, tags, cuentas y rutas."}
            </p>
            <Button
              intent="action"
              onClick={() => vscode.postMessage({ type: "brain:pickFolder" })}
            >
              Elegir carpeta
            </Button>
          </section>
        )}
      </Panel>
    </Module>
  );
}

function BrainNodeComponent({
  data,
  selected,
}: NodeProps<Node<GraphNodeData>>) {
  return (
    <AtomNode
      accent={colorForKind(data.kind)}
      className={`brain-atom-node${data.issue ? ` brain-atom-node--${data.issue}` : ""}`}
      code={
        <span className="brain-node__kind">
          {data.badge ?? data.layer ?? data.kind}
        </span>
      }
      corner={
        data.issue ? (
          <span className={`brain-node__issue-dot brain-node__issue-dot--${data.issue}`} />
        ) : undefined
      }
      headerRight={
        typeof data.count === "number" ? (
          <span className="brain-node__count">{data.count}</span>
        ) : undefined
      }
      label={data.label}
      selected={selected}
      subtitle={data.subtitle}
    >
      <Handle position={Position.Left} type="target" />
      <Handle position={Position.Right} type="source" />
    </AtomNode>
  );
}

function BrainInspector({
  isOpen,
  node,
  onClose,
  onSelectNode,
  related,
  snapshot,
}: {
  isOpen: boolean;
  node: BrainNode | null;
  onClose(): void;
  onSelectNode(nodeId: string): void;
  related: RelatedLink[];
  snapshot: BrainSnapshot;
}) {
  if (!node) {
    return (
      <DrawerShell className="brain-drawer" isOpen={isOpen} onClose={onClose}>
        <div className="drawer-empty">
          Selecciona un nodo para inspeccionarlo.
        </div>
      </DrawerShell>
    );
  }

  const nodeIssues = snapshot.issues.filter(
    (issue) => issue.nodeId === node.id,
  );
  const typeLabel = labelForNodeKind(node);
  const metadata = [
    { label: "Tipo", value: typeLabel },
    { label: "ID", value: node.id },
    { label: "Título", value: node.title },
    { label: "Ruta", value: node.route },
    { label: "Archivo", value: node.path },
    { label: "Dominio", value: node.domain },
    { label: "Layer", value: node.layer },
    { label: "Kind", value: node.docKind },
    { label: "Badge", value: node.badge },
  ].filter((item) => item.value);
  const header = (
    <>
      <div className="drawer-header__code">{typeLabel}</div>
      <h2 className="drawer-header__title">{node.label}</h2>
      <div className="drawer-header__status">
        {node.badge ? <span className="drawer-badge">{node.badge}</span> : null}
        {node.layer ? <span className="drawer-badge">{node.layer}</span> : null}
        {node.docKind ? (
          <span className="drawer-badge">{node.docKind}</span>
        ) : null}
        {nodeIssues.map((issue) => (
          <span className="drawer-badge" key={issue.kind}>
            {ISSUE_LABEL[issue.kind]}
          </span>
        ))}
      </div>
    </>
  );

  const actions = (
    <>
      <Button className="is-active" intent="change" size="small">
        Inspector
      </Button>
      {node.kind === "doc" ? (
        <Button
          intent="change"
          onClick={() =>
            vscode.postMessage({ type: "brain:openNode", nodeId: node.id })
          }
          size="small"
        >
          Abrir
        </Button>
      ) : null}
    </>
  );

  return (
    <DrawerShell
      actions={actions}
      className="brain-drawer"
      header={header}
      isOpen={isOpen}
      onClose={onClose}
    >
      <div className="drawer-panel brain-drawer__body">
        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__label">Resumen</div>
          <div className="drawer-section__text">
            {summaryForNode(node)}
          </div>
        </section>
        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__label">Metadatos</div>
          <dl className="brain-inspector__meta">
            {metadata.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className={item.label === "Archivo" || item.label === "Ruta" ? "brain-inspector__route" : undefined}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        {node.description ? (
          <section className="drawer-section drawer-section--spacious">
            <div className="drawer-section__label">Descripción</div>
            <div className="drawer-section__text">{node.description}</div>
          </section>
        ) : null}
        {node.tags?.length ? (
          <section className="drawer-section drawer-section--spacious">
            <div className="drawer-section__label">Tags</div>
            <div className="drawer-list">
              {node.tags.slice(0, 12).map((tag) => (
                <span className="drawer-badge" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </section>
        ) : null}
        <div className="drawer-divider" />
        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__label">Conectados</div>
          {related.length === 0 ? (
            <p className="drawer-empty">No hay relaciones visibles.</p>
          ) : null}
          <div className="brain-related">
            {related.slice(0, 24).map((item) => (
              <Button
                className={`brain-related__item brain-related__item--${item.relation}`}
                intent="change"
                key={`${item.direction}:${item.relation}:${item.node.id}`}
                onClick={() => onSelectNode(item.node.id)}
                size="small"
              >
                <span>
                  {item.direction === "from" ? "from this doc" : "to this doc"}{" "}
                  · {item.relation}
                </span>
                {item.node.label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </DrawerShell>
  );
}

function labelForNodeKind(node: BrainNode) {
  if (node.kind === "folder") {
    return node.path ? "Folder" : "Folder sintético";
  }
  if (node.kind === "doc") {
    return "Documento";
  }
  if (node.kind === "tag") {
    return "Tag";
  }
  if (node.kind === "account") {
    return "Account";
  }
  return "External";
}

function summaryForNode(node: BrainNode) {
  if (node.description) {
    return node.description;
  }
  if (node.kind === "folder") {
    return node.path
      ? "Carpeta representada por su index.md/index.mdx."
      : "Carpeta sintética creada desde la estructura de directorios porque no existe index.md/index.mdx.";
  }
  if (node.kind === "doc") {
    return "Documento Markdown detectado por Brain.";
  }
  if (node.kind === "tag") {
    return "Etiqueta extraída del frontmatter de los documentos.";
  }
  if (node.kind === "account") {
    return "Cuenta detectada desde los metadatos o el contenido configurado.";
  }
  return "Referencia externa o no resuelta detectada en los documentos.";
}

function buildFlow(
  snapshot: BrainSnapshot,
  query: string,
  visibleKinds: Array<BrainNode["kind"]>,
  visibleEdges: EdgeFilter[],
  hiddenNodeIds: string[],
  selectedNodeId: string | null,
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
  const flowNodeIds = matchingNodeIds;

  const nodes: Array<Node<GraphNodeData>> = snapshot.nodes
    .filter((node) => flowNodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      type: "brain",
      selected: node.id === selectedNodeId,
      position: { x: 0, y: 0 },
      // Explicit dims so the MiniMap can draw node rects without depending on
      // measurement (nodes are rebuilt each render without useNodesState, so
      // measured sizes never persist). Brain nodes are fixed at NODE_WIDTH x
      // NODE_HEIGHT in CSS, so this never clips them.
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
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

  return computeLayout(nodes, edges);
}

function computeLayout(nodes: Array<Node<GraphNodeData>>, edges: Edge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const queue = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort(compareFlowNodes);
  const levelById = new Map<string, number>();

  for (const node of queue) {
    levelById.set(node.id, 0);
  }

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      break;
    }
    const sourceLevel = levelById.get(node.id) ?? 0;
    for (const targetId of outgoing.get(node.id) ?? []) {
      levelById.set(targetId, Math.max(levelById.get(targetId) ?? 0, sourceLevel + 1));
      const nextIncoming = (incoming.get(targetId) ?? 0) - 1;
      incoming.set(targetId, nextIncoming);
      if (nextIncoming === 0) {
        const target = byId.get(targetId);
        if (target) {
          queue.push(target);
          queue.sort(compareFlowNodes);
        }
      }
    }
  }

  for (const node of nodes) {
    if (!levelById.has(node.id)) {
      levelById.set(node.id, 0);
    }
  }

  const groups = new Map<number, Array<Node<GraphNodeData>>>();
  for (const node of nodes) {
    const level = levelById.get(node.id) ?? 0;
    const group = groups.get(level) ?? [];
    group.push(node);
    groups.set(level, group);
  }
  for (const group of groups.values()) {
    group.sort(compareFlowNodes);
  }

  return {
    nodes: nodes.map((node) => {
      const level = levelById.get(node.id) ?? 0;
      const group = groups.get(level) ?? [];
      const row = Math.max(group.findIndex((item) => item.id === node.id), 0);
      return {
        ...node,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          ...node.data,
          label: node.data.label,
          subtitle: node.data.subtitle,
        },
        position: {
          x: 42 + level * (NODE_WIDTH + 140),
          y: 42 + row * (NODE_HEIGHT + 34),
        },
      };
    }),
    edges,
  };
}

function compareFlowNodes(
  left: Node<GraphNodeData>,
  right: Node<GraphNodeData>,
) {
  return left.data.label.localeCompare(right.data.label) || left.id.localeCompare(right.id);
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
    case "folder":
      return "#a78bfa";
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
