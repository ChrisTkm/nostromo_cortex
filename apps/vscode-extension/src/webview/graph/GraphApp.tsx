import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Graph } from "../components/molecules/graph/Graph";
import { GraphToolbar } from "./GraphToolbar";
import { Button, Status, type StatusTone } from "../components/atoms";
import {
  DrawerShell,
  Footer,
  Header,
  Panel,
  SecondBar,
  StatusBar,
} from "../components/molecules";
import { Module } from "../components/organisms";
import type {
  ActionPlanRecord,
  ConnectionSettings,
  CriticalPathResult,
  FilterCatalog,
  GraphDirection,
  GraphSnapshot,
  PlanTaskSummary,
  SnapshotMessage,
  SnapshotNode,
  TaskFilter,
} from "../types";
import { toPng, toSvg } from "html-to-image";

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

async function exportGraph(
  format: "png" | "svg",
  planCodeForName: string | undefined,
) {
  const element = document.querySelector<HTMLElement>(
    ".graph-canvas .react-flow",
  );
  if (!element) return;
  const backgroundColor =
    window.getComputedStyle(element).backgroundColor || "#0d1117";
  const dataUrl =
    format === "png"
      ? await toPng(element, {
          backgroundColor,
          pixelRatio: 2,
          cacheBust: true,
        })
      : await toSvg(element, { backgroundColor, cacheBust: true });
  const planSlug = (planCodeForName ?? "all").toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `cortex-graph-${planSlug}-${stamp}.${format}`;
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export function GraphApp() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [plans, setPlans] = useState<ActionPlanRecord[]>([]);
  const [planTasks, setPlanTasks] = useState<Record<string, PlanTaskSummary[]>>(
    {},
  );
  const [orientation, setOrientation] = useState<GraphDirection>("LR");
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [groupByLane, setGroupByLane] = useState(false);
  const [selectedTaskCode, setSelectedTaskCode] = useState<
    string | undefined
  >();
  const [totalTaskCount, setTotalTaskCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionSettings | null>(null);
  const [viewport, setViewport] = useState<{
    zoom?: number;
    pan?: { x: number; y: number };
  }>({});
  const [filters, setFilters] = useState<TaskFilter>({});
  const [catalog, setCatalog] = useState<FilterCatalog>({
    projects: [],
    groups: [],
    tags: [],
    statuses: [],
    severities: [],
  });
  const [criticalPath, setCriticalPath] = useState<
    CriticalPathResult | undefined
  >();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewerPlanCode, setViewerPlanCode] = useState<string | undefined>();
  const [centerTaskCode, setCenterTaskCode] = useState<string | undefined>();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [planFocusRequest, setPlanFocusRequest] = useState<
    { code: string; nonce: number } | undefined
  >();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [agentIconBase, setAgentIconBase] = useState<string | undefined>(
    undefined,
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastPlanTaskCodeRef = useRef<string | undefined>(undefined);
  const viewportPostRef = useRef<number | undefined>(undefined);

  const selectedNode = useMemo<SnapshotNode | undefined>(
    () =>
      snapshot?.nodes.find(
        (n) => n.code === selectedTaskCode || n.id === selectedTaskCode,
      ),
    [selectedTaskCode, snapshot?.nodes],
  );
  const selectedPlan = useMemo<ActionPlanRecord | undefined>(
    () => plans.find((p) => p.code === viewerPlanCode),
    [plans, viewerPlanCode],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent<SnapshotMessage>) {
      if (event.data?.type !== "snapshot") return;
      const msg = event.data;
      setSnapshot(msg.snapshot);
      setIsRefreshing(false);
      setPlans(msg.plans);
      setPlanTasks(msg.planTasks);
      setTotalTaskCount(msg.totals.totalTaskCount);
      setConnection(msg.connection);
      setOrientation(msg.state.orientation);
      setShowMiniMap(msg.state.showMiniMap);
      setGroupByLane(msg.state.groupByLane ?? false);
      setSelectedTaskCode(msg.state.selectedTaskCode);
      setViewport({ zoom: msg.state.zoom, pan: msg.state.pan });
      setFilters(normalizeFilter(msg.snapshot.filters));
      setCatalog(msg.catalog);
      setCriticalPath(msg.criticalPath);
      setAgentIconBase(msg.agentIconBase);
      const currentTaskCode = msg.snapshot.planContext?.currentTaskCode;
      if (currentTaskCode && currentTaskCode !== lastPlanTaskCodeRef.current) {
        setPlanFocusRequest({ code: currentTaskCode, nonce: Date.now() });
      }
      lastPlanTaskCodeRef.current = currentTaskCode;
    }
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (promptExpanded) {
          setPromptExpanded(false);
          return;
        }
        if (viewerPlanCode) {
          setViewerPlanCode(undefined);
          return;
        }
        setDrawerOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [promptExpanded, viewerPlanCode]);

  useEffect(
    () => () => {
      if (viewportPostRef.current !== undefined)
        window.clearTimeout(viewportPostRef.current);
    },
    [],
  );

  const handleSelectTask = useCallback((code: string) => {
    setSelectedTaskCode(code);
    setCenterTaskCode(code);
    setDrawerOpen(true);
    vscode.postMessage({ type: "selectTask", code });
  }, []);

  const handleViewportChange = useCallback(
    (zoom: number, pan: { x: number; y: number }) => {
      setViewport({ zoom, pan });
      if (viewportPostRef.current !== undefined)
        window.clearTimeout(viewportPostRef.current);
      viewportPostRef.current = window.setTimeout(() => {
        vscode.postMessage({ type: "viewportChanged", zoom, pan });
        viewportPostRef.current = undefined;
      }, 200);
    },
    [],
  );

  const handleFilterChange = useCallback((next: TaskFilter) => {
    const normalized = normalizeFilter(next);
    setFilters(normalized);
    vscode.postMessage({ type: "updateFilter", filter: normalized });
  }, []);

  const handleOpenPlanViewer = useCallback(
    (code?: string) => {
      const nextCode = code ?? snapshot?.planContext?.code ?? filters.planCode;
      if (!nextCode) return;
      setPromptExpanded(false);
      setDrawerOpen(false);
      setViewerPlanCode(nextCode);
    },
    [snapshot?.planContext?.code, filters.planCode],
  );

  const handleSelectPlan = useCallback((code: string) => {
    setFilters((cur) => ({ ...cur, planCode: code }));
    vscode.postMessage({ type: "selectPlan", code });
  }, []);

  const handleClearPlan = useCallback(() => {
    setFilters((cur) => normalizeFilter(removeKey(cur, "planCode")));
    vscode.postMessage({ type: "clearPlan" });
  }, []);

  const handleToggleMiniMap = useCallback(() => {
    setShowMiniMap((cur) => {
      const next = !cur;
      vscode.postMessage({ type: "miniMapToggled", showMiniMap: next });
      return next;
    });
  }, []);

  const handleToggleLanes = useCallback(() => {
    setGroupByLane((cur) => {
      const next = !cur;
      vscode.postMessage({ type: "toggleGroupByLane", groupByLane: next });
      return next;
    });
  }, []);

  const orphanCount = snapshot?.warnings?.orphans.length ?? 0;
  const showOnboarding = Boolean(snapshot && totalTaskCount === 0);

  const header = (
    <Header
      name="CORTEX GRAPH"
      actions={
        <>
          <Button
            intent="new"
            onClick={() => vscode.postMessage({ type: "newTask" })}
            size="small"
          >
            Crear tarea
          </Button>
          <Button
            disabled={isRefreshing}
            intent="refresh"
            onClick={() => {
              setIsRefreshing(true);
              vscode.postMessage({ type: "refresh" });
            }}
            size="small"
          >
            Actualizar
          </Button>
        </>
      }
    />
  );

  const secondBar = (
    <SecondBar
      filters={
        <GraphToolbar
          catalog={catalog}
          filters={filters}
          onClearPlan={handleClearPlan}
          onFilterChange={handleFilterChange}
          onSelectPlan={handleSelectPlan}
          onViewPlan={() => handleOpenPlanViewer()}
          plans={plans}
          searchInputRef={searchInputRef}
          selectedPlanCode={snapshot?.planContext?.code ?? filters.planCode}
        />
      }
    />
  );
  const statusBar = (
    <>
      {snapshot?.planContext ? (
        <StatusBar
          chip={
            snapshot.planContext.currentTaskCode ? (
              <button
                className="molecule-status-bar__chip"
                onClick={(event) => {
                  event.stopPropagation();
                  const code = snapshot.planContext?.currentTaskCode;
                  if (!code) return;
                  setPlanFocusRequest({
                    code,
                    nonce: Date.now(),
                  });
                }}
                type="button"
              >
                Current task: {snapshot.planContext.currentTaskCode}
              </button>
            ) : null
          }
          code={snapshot.planContext.code}
          eyebrow="Active plan"
          onClick={() => handleOpenPlanViewer(snapshot.planContext?.code)}
          progress={snapshot.planContext.progress}
          title={snapshot.planContext.title}
        />
      ) : null}
      {orphanCount > 0 ? (
        <Button
          className="graph-warning-banner"
          intent="change"
          onClick={() => vscode.postMessage({ type: "showOrphanWarnings" })}
          size="small"
        >
          {orphanCount} dependencias huerfanas detectadas
        </Button>
      ) : null}
    </>
  );

  const statusCounts = {
    BLOCKED: snapshot?.stats.blockedCount ?? 0,
    DONE: snapshot?.stats.doneCount ?? 0,
    FAILED: snapshot?.stats.failedCount ?? 0,
    IN_PROGRESS: snapshot?.stats.inProgressCount ?? 0,
    PENDING: snapshot?.stats.pendingCount ?? 0,
  };
  const criticalSeverityNodes =
    snapshot?.nodes.filter((node) => node.severity === "CRITICAL") ?? [];
  const activePlanCode = snapshot?.planContext?.code ?? filters.planCode;
  const activePlanTasks = activePlanCode ? (planTasks[activePlanCode] ?? []) : [];
  const footerDoneCount = activePlanCode
    ? activePlanTasks.filter((task) => task.status === "DONE").length
    : statusCounts.DONE;
  const footerTotalCount = activePlanCode ? activePlanTasks.length : totalTaskCount;

  const footer = (
    <Footer
      left={
          <div className="molecule-footer__summary">
            {footerDoneCount}/{footerTotalCount} done
          </div>
      }
      center={
        <>
          {criticalSeverityNodes.length > 0 ? (
            <Status
              title={`Critical severity: ${criticalSeverityNodes.map((node) => node.code).join(" -> ")}`}
              tone="blocked"
            >
              Critical {criticalSeverityNodes.length}
            </Status>
          ) : null}

          <Status title="Pending" tone="pending">
            {statusCounts.PENDING}
          </Status>
          <Status title="In progress" tone="in-progress">
            {statusCounts.IN_PROGRESS}
          </Status>
          <Status title="Blocked" tone="blocked">
            {statusCounts.BLOCKED}
          </Status>
          <Status title="Done" tone="done">
            {statusCounts.DONE}
          </Status>
          <Status title="Failed" tone="failed">
            {statusCounts.FAILED}
          </Status>
        </>
      }
      right={
        <>
          <Button intent="change" onClick={() => void exportGraph("png", snapshot?.planContext?.code ?? filters.planCode)} size="small">
            PNG
          </Button>
          <Button intent="change" onClick={() => void exportGraph("svg", snapshot?.planContext?.code ?? filters.planCode)} size="small">
            SVG
          </Button>
          <Button intent="change" onClick={() => {
            const next = orientation === "LR" ? "TB" : "LR";
            setOrientation(next);
            vscode.postMessage({ type: "orientationChanged", orientation: next });
          }} size="small">
            {orientation}
          </Button>
          <Button className={showMiniMap ? "is-active" : undefined} intent="change" onClick={handleToggleMiniMap} size="small">
            MiniMap
          </Button>
          <Button className={groupByLane ? "is-active" : undefined} intent="change" onClick={handleToggleLanes} size="small">
            Lanes
          </Button>
        </>
      }
    />
  );

  const showInspectorHeader = Boolean(selectedNode) && !promptExpanded;
  const isPlanDrawerOpen = Boolean(viewerPlanCode && selectedPlan);
  const drawer = (
    <DrawerShell
      actions={
        isPlanDrawerOpen ? undefined : (
          <Button
            disabled={!selectedNode}
            intent="change"
            onClick={() =>
              selectedNode &&
              vscode.postMessage({
                type: "editTask",
                code: selectedNode.code,
              })
            }
            size="small"
          >
            Editar
          </Button>
        )
      }
      header={
        isPlanDrawerOpen && selectedPlan ? (
          <>
            <div className="drawer-header__code">{selectedPlan.code}</div>
            <h2 className="drawer-header__title">{selectedPlan.title}</h2>
          </>
        ) : showInspectorHeader && selectedNode ? (
          <>
            <div className="drawer-header__code">{selectedNode.code}</div>
            <h2 className="drawer-header__title">{selectedNode.label}</h2>
            <div className="drawer-header__status">
              <Status tone={statusTone(selectedNode.status)}>
                {selectedNode.status}
              </Status>
              <span className="drawer-badge">{selectedNode.severity}</span>
              {selectedNode.lane ? (
                <span className="drawer-badge">{selectedNode.lane}</span>
              ) : null}
              {typeof selectedNode.durationEstimate === "number" ? (
                <span className="drawer-badge">
                  {formatHours(selectedNode.durationEstimate)}
                </span>
              ) : null}
            </div>
          </>
        ) : undefined
      }
      isExpanded={promptExpanded}
      isOpen={isPlanDrawerOpen || drawerOpen}
      onClose={() => {
        setViewerPlanCode(undefined);
        setDrawerOpen(false);
        setPromptExpanded(false);
      }}
    >
      {isPlanDrawerOpen && selectedPlan && viewerPlanCode ? (
        <div className="drawer-panel">
          {selectedPlan.product || selectedPlan.release || selectedPlan.author || selectedPlan.assignedAgent ? (
            <div className="drawer-section">
              <div className="drawer-section__subtitle">
                {[selectedPlan.product, selectedPlan.release].filter(Boolean).join(" / ")}
                {selectedPlan.author || selectedPlan.assignedAgent ? (
                  <>
                    {" · "}
                    {[selectedPlan.author, selectedPlan.assignedAgent].filter(Boolean).join(" / ")}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {selectedPlan.tags?.length ? (
            <section className="drawer-section">
              <div className="drawer-list drawer-list--row">
                {selectedPlan.tags.map((tag) => (
                  <span className="drawer-badge drawer-badge--tag" key={tag}>{tag}</span>
                ))}
              </div>
            </section>
          ) : null}
          <section className="drawer-section">
            <div className="drawer-section__label">Progreso</div>
            <div className="drawer-section__text">
              {planTasks[viewerPlanCode]?.filter((t) => t.status === "DONE").length ?? 0}
              {" / "}
              {planTasks[viewerPlanCode]?.length ?? 0} tareas completadas
            </div>
          </section>
          {selectedPlan.description ? (
            <section className="drawer-section">
              <div className="drawer-section__label">Descripción</div>
              <div className="drawer-section__text">{selectedPlan.description}</div>
            </section>
          ) : null}
          {selectedPlan.goal ? (
            <section className="drawer-section">
              <div className="drawer-section__label">Goal</div>
              <div className="drawer-section__text">{selectedPlan.goal}</div>
            </section>
          ) : null}
          {selectedPlan.context ? (
            <section className="drawer-section">
              <div className="drawer-section__label">Contexto</div>
              <div className="drawer-section__text">{selectedPlan.context}</div>
            </section>
          ) : null}
          <section className="drawer-section">
            <div className="drawer-section__label">Tareas</div>
            <div className="drawer-list">
              {planTasks[viewerPlanCode]?.length ? (
                planTasks[viewerPlanCode].map((task) => (
                  <button
                    className="drawer-link"
                    key={task.code}
                    onClick={() => {
                      setViewerPlanCode(undefined);
                      handleSelectTask(task.code);
                    }}
                    type="button"
                  >
                    <span className="drawer-header__code">{task.code}</span>
                    <span>{task.label}</span>
                  </button>
                ))
              ) : (
                <div className="drawer-empty">Sin tareas.</div>
              )}
            </div>
          </section>
        </div>
      ) : promptExpanded && selectedNode ? (
        <GraphPromptPanel
          node={selectedNode}
          onClose={() => setPromptExpanded(false)}
        />
      ) : selectedNode ? (
        <GraphInspector
          node={selectedNode}
          onOpenPromptPanel={() => {
            setDrawerOpen(true);
            setPromptExpanded(true);
          }}
          onSelectDependency={(code) => {
            setSelectedTaskCode(code);
            setCenterTaskCode(code);
            setDrawerOpen(true);
            vscode.postMessage({ type: "selectTask", code });
          }}
        />
      ) : (
        <div className="drawer-empty">
          Selecciona una tarea para inspeccionarla.
        </div>
      )}
    </DrawerShell>
  );

  return (
    <Module
      banner={statusBar}
      drawer={drawer}
      footer={footer}
      header={header}
      secondBar={secondBar}
    >
      <Panel className="graph-canvas" variant="canvas">
        {showOnboarding ? (
          <section className="onboarding-state" aria-label="Configuración de Cortex">
            <div className="onboarding-state__eyebrow">Configuración</div>
            <h1 className="onboarding-state__title">
              {connection?.mongoDbName
                ? "Base de datos vacía"
                : "Conecta tu base de datos"}
            </h1>
            <p className="onboarding-state__text">
              {connection?.mongoDbName
                ? `La base de datos "${connection.mongoDbName}" está vacía. Crea tu primera tarea para empezar.`
                : "Selecciona o crea una base de datos Mongo para usar Cortex."}
            </p>
            <div className="onboarding-state__actions">
              <Button
                intent="new"
                onClick={() => vscode.postMessage({ type: "newTask" })}
              >
                Crear tarea
              </Button>
              <Button
                intent="action"
                onClick={() =>
                  vscode.postMessage({ type: "bootstrapDatabase" })
                }
              >
                Create sample database
              </Button>
              <Button
                intent="change"
                onClick={() => vscode.postMessage({ type: "selectDatabase" })}
              >
                Seleccionar base de datos
              </Button>
              <Button
                intent="refresh"
                onClick={() => {
                  setIsRefreshing(true);
                  vscode.postMessage({ type: "refresh" });
                }}
              >
                Actualizar
              </Button>
            </div>
            <p className="onboarding-state__hint">
              Conexión: {connection?.mongoUrl ?? "mongodb://127.0.0.1:27017"}
            </p>
          </section>
        ) : (
          <Graph
            agentIconBase={agentIconBase}
            centerTaskCode={centerTaskCode}
            criticalPath={criticalPath}
            emptyMessage="No tasks match the current filters. Clear filters to show everything."
            groupByLane={groupByLane}
            onSelectTask={handleSelectTask}
            onViewportChange={handleViewportChange}
            orientation={orientation}
            pan={viewport.pan}
            planFocusRequest={planFocusRequest}
            selectedTaskCode={selectedTaskCode}
            showMiniMap={showMiniMap}
            snapshot={snapshot}
            zoom={viewport.zoom}
          />
        )}
      </Panel>
    </Module>
  );
}

function normalizeFilter(filter: TaskFilter): TaskFilter {
  const next: TaskFilter = {};
  if (filter.project?.length) next.project = filter.project;
  if (filter.group?.length) next.group = filter.group;
  if (filter.tags?.length) next.tags = filter.tags;
  if (filter.status?.length) next.status = filter.status;
  if (filter.severity?.length) next.severity = filter.severity;
  if (filter.search?.trim()) next.search = filter.search.trim();
  if (filter.planCode) next.planCode = filter.planCode;
  return next;
}

function removeKey<T extends object, K extends keyof T>(value: T, key: K): T {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

// Graph node inspector — body of the shared DrawerShell (kept in-file, like
// LedgerApp's RunDetailDrawer and BrainApp's BrainInspector).
function GraphInspector(props: {
  node: SnapshotNode;
  onOpenPromptPanel(): void;
  onSelectDependency(code: string): void;
}) {
  const { node } = props;
  const promptPreview = useMemo(
    () => node.prompt?.split("\n").slice(0, 10).join("\n"),
    [node.prompt],
  );

  return (
    <div className="drawer-panel">
      <section className="drawer-section drawer-section--spacious">
        <div className="drawer-section__label">Detalle</div>
        <div className="drawer-section__text">
          {node.detail || "Sin detalle."}
        </div>
      </section>
      <section className="drawer-section drawer-section--spacious">
        <div className="drawer-section__label">Dependencias</div>
        <div className="drawer-list">
          {node.dependsOn.length > 0 ? (
            node.dependsOn.map((code) => (
              <button
                className="drawer-link"
                key={code}
                onClick={() => props.onSelectDependency(code)}
                type="button"
              >
                {code}
              </button>
            ))
          ) : (
            <span className="drawer-empty">Sin dependencias</span>
          )}
        </div>
        <div className="drawer-inline-stat">
          <span className="drawer-inline-stat__label">Descendientes</span>
          <span className="drawer-inline-stat__value">
            {node.downstreamCount}
          </span>
        </div>
      </section>
      <section className="drawer-section drawer-section--spacious">
        <div className="drawer-section__label">Cronología</div>
        <section className="drawer-grid">
          <div className="drawer-card">
            <div className="drawer-section__label">Creada</div>
            <div className="drawer-section__text">
              {formatDate(node.createdAt)}
            </div>
          </div>
          <div className="drawer-card">
            <div className="drawer-section__label">Actualizada</div>
            <div className="drawer-section__text">
              {formatDate(node.updatedAt)}
            </div>
          </div>
        </section>
      </section>
      <section className="drawer-section drawer-section--spacious">
        <div className="drawer-section__label">Etiquetas</div>
        <div className="drawer-list">
          {node.tags.length > 0 ? (
            node.tags.map((tag) => (
              <span className="drawer-badge" key={tag}>
                {tag}
              </span>
            ))
          ) : (
            <span className="drawer-empty">Sin etiquetas</span>
          )}
        </div>
      </section>
      {node.prompt ? (
        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__header">
            <div className="drawer-section__label">Vista previa del prompt</div>
            <button
              className="drawer-link"
              onClick={props.onOpenPromptPanel}
              type="button"
            >
              Ver completo
            </button>
          </div>
          <pre className="drawer-prompt">{promptPreview}</pre>
        </section>
      ) : null}
    </div>
  );
}

type PromptTab = "prompt" | "acceptance" | "out_of_scope";

const PROMPT_TAB_LABELS: Record<PromptTab, string> = {
  prompt: "Prompt",
  acceptance: "Acceptance",
  out_of_scope: "Out of Scope",
};

// Full prompt view inside the inspector drawer (expanded state).
function GraphPromptPanel(props: { node: SnapshotNode; onClose(): void }) {
  const [activeTab, setActiveTab] = useState<PromptTab>("prompt");
  const [copiedTab, setCopiedTab] = useState<PromptTab | null>(null);

  const tabContent = useMemo<Record<PromptTab, string>>(
    () => ({
      prompt: props.node.prompt ?? "",
      acceptance: props.node.acceptance ?? "",
      out_of_scope: props.node.outOfScope ?? "",
    }),
    [props.node.acceptance, props.node.outOfScope, props.node.prompt],
  );

  useEffect(() => {
    setActiveTab("prompt");
    setCopiedTab(null);
  }, [props.node.code]);

  useEffect(() => {
    if (!copiedTab) return;
    const handle = window.setTimeout(() => setCopiedTab(null), 1000);
    return () => window.clearTimeout(handle);
  }, [copiedTab]);

  async function handleCopy(tab: PromptTab) {
    await navigator.clipboard.writeText(tabContent[tab]);
    setCopiedTab(tab);
  }

  return (
    <section className="prompt-panel" id="prompt-panel">
      <div className="prompt-panel__header">
        <div>
          <div className="drawer-panel__code">{props.node.code}</div>
          <h2 className="drawer-panel__title">Prompt panel</h2>
        </div>
        <div className="prompt-panel__actions">
          <Button intent="change" onClick={props.onClose} size="small">
            Close
          </Button>
        </div>
      </div>

      <div
        className="prompt-panel__tabs"
        role="tablist"
        aria-label="Prompt sections"
      >
        {(Object.keys(PROMPT_TAB_LABELS) as PromptTab[]).map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={`prompt-panel__tab${activeTab === tab ? " prompt-panel__tab--active" : ""}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            type="button"
          >
            {PROMPT_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="prompt-panel__toolbar">
        <div className="drawer-section__label">
          {PROMPT_TAB_LABELS[activeTab]}
        </div>
        <Button
          intent="change"
          onClick={() => void handleCopy(activeTab)}
          size="small"
        >
          {copiedTab === activeTab ? "Copied!" : "Copy"}
        </Button>
      </div>

      <pre className="prompt-panel__content">
        {tabContent[activeTab] ||
          `No ${PROMPT_TAB_LABELS[activeTab].toLowerCase()} provided.`}
      </pre>
    </section>
  );
}

function statusTone(status: string): StatusTone {
  switch (status) {
    case "IN_PROGRESS":
      return "in-progress";
    case "BLOCKED":
      return "blocked";
    case "DONE":
      return "done";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`;
}
