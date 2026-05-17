import { useEffect, useMemo, useRef, useState } from "react";

import { ActionPlanViewer } from "./components/ActionPlanViewer";
import { Drawer } from "./components/Drawer";
import { Graph } from "./components/Graph";
import { PlanBanner } from "./components/PlanBanner";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import type { ActionPlanRecord, FilterCatalog, GraphDirection, GraphSnapshot, PlanTaskSummary, SnapshotMessage, SnapshotNode, TaskFilter } from "./types";

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

export function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [plans, setPlans] = useState<ActionPlanRecord[]>([]);
  const [planTasks, setPlanTasks] = useState<Record<string, PlanTaskSummary[]>>({});
  const [orientation, setOrientation] = useState<GraphDirection>("LR");
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [selectedTaskCode, setSelectedTaskCode] = useState<string | undefined>();
  const [totalTaskCount, setTotalTaskCount] = useState(0);
  const [viewport, setViewport] = useState<{ zoom?: number; pan?: { x: number; y: number } }>({});
  const [filters, setFilters] = useState<TaskFilter>({});
  const [catalog, setCatalog] = useState<FilterCatalog>({
    projects: [],
    groups: [],
    tags: [],
    statuses: [],
    severities: []
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"inspector" | "filters">("inspector");
  const [viewerPlanCode, setViewerPlanCode] = useState<string | undefined>();
  const [centerTaskCode, setCenterTaskCode] = useState<string | undefined>();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [planFocusRequest, setPlanFocusRequest] = useState<{ code: string; nonce: number } | undefined>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastPlanTaskCodeRef = useRef<string | undefined>();

  const selectedNode = useMemo<SnapshotNode | undefined>(
    () => snapshot?.nodes.find((node) => node.code === selectedTaskCode || node.id === selectedTaskCode),
    [selectedTaskCode, snapshot?.nodes]
  );
  const selectedPlan = useMemo<ActionPlanRecord | undefined>(() => plans.find((plan) => plan.code === viewerPlanCode), [plans, viewerPlanCode]);

  useEffect(() => {
    function onMessage(event: MessageEvent<SnapshotMessage>) {
      if (event.data?.type !== "snapshot") {
        return;
      }

      setSnapshot(event.data.snapshot);
      setIsRefreshing(false);
      setPlans(event.data.plans);
      setPlanTasks(event.data.planTasks);
      setTotalTaskCount(event.data.totals.totalTaskCount);
      setOrientation(event.data.state.orientation);
      setShowMiniMap(event.data.state.showMiniMap);
      setSelectedTaskCode(event.data.state.selectedTaskCode);
      setViewport({
        zoom: event.data.state.zoom,
        pan: event.data.state.pan
      });
      setFilters(normalizeFilter(event.data.snapshot.filters));
      setCatalog(event.data.catalog);

      const currentTaskCode = event.data.snapshot.planContext?.currentTaskCode;
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

  function handleSelectTask(code: string) {
    setSelectedTaskCode(code);
    setCenterTaskCode(code);
    setDrawerOpen(true);
    setDrawerTab("inspector");
    vscode.postMessage({ type: "selectTask", code });
  }

  function handleOrientationChange(next: GraphDirection) {
    setOrientation(next);
    vscode.postMessage({ type: "orientationChanged", orientation: next });
  }

  function handleViewportChange(zoom: number, pan: { x: number; y: number }) {
    setViewport({ zoom, pan });
    vscode.postMessage({ type: "viewportChanged", zoom, pan });
  }

  function handleFilterChange(next: TaskFilter) {
    const normalized = normalizeFilter(next);
    setFilters(normalized);
    vscode.postMessage({ type: "updateFilter", filter: normalized });
  }

  function handleClearFilters() {
    setFilters({});
    setSelectedTaskCode(undefined);
    setCenterTaskCode(undefined);
    setPromptExpanded(false);
    vscode.postMessage({ type: "clearFilters" });
  }

  function handleSelectDependency(code: string) {
    setSelectedTaskCode(code);
    setCenterTaskCode(code);
    setDrawerOpen(true);
    setDrawerTab("inspector");
    vscode.postMessage({ type: "selectTask", code });
  }

  function handleOpenPromptPanel() {
    if (!selectedNode) {
      return;
    }

    setDrawerOpen(true);
    setDrawerTab("inspector");
    setPromptExpanded(true);
  }

  function handleEditSelectedTask() {
    if (!selectedNode) {
      return;
    }

    vscode.postMessage({ type: "editTask", code: selectedNode.code });
  }

  function handleFocusPlanTask(code: string) {
    setPlanFocusRequest({ code, nonce: Date.now() });
  }

  function handleOpenPlanViewer(code?: string) {
    const nextCode = code ?? snapshot?.planContext?.code ?? filters.planCode;
    if (!nextCode) {
      return;
    }
    setPromptExpanded(false);
    setDrawerOpen(false);
    setViewerPlanCode(nextCode);
  }

  function handleSelectPlanTask(code: string) {
    setViewerPlanCode(undefined);
    handleSelectTask(code);
  }

  function handleSelectPlan(code: string) {
    setFilters((current) => ({ ...current, planCode: code }));
    vscode.postMessage({ type: "selectPlan", code });
  }

  function handleClearPlan() {
    setFilters((current) => normalizeFilter(removeKey(current, "planCode")));
    vscode.postMessage({ type: "clearPlan" });
  }

  function handleToggleMiniMap() {
    setShowMiniMap((current) => {
      const next = !current;
      vscode.postMessage({ type: "miniMapToggled", showMiniMap: next });
      return next;
    });
  }

  function handleRefreshGraph() {
    setIsRefreshing(true);
    vscode.postMessage({ type: "refresh" });
  }

  return (
    <div className="app-shell">
      <Toolbar
        catalog={catalog}
        filters={filters}
        onClearPlan={handleClearPlan}
        onFilterChange={handleFilterChange}
        onSelectPlan={handleSelectPlan}
        onViewPlan={() => handleOpenPlanViewer()}
        planContext={snapshot?.planContext}
        plans={plans}
        searchInputRef={searchInputRef}
        selectedPlanCode={snapshot?.planContext?.code ?? filters.planCode}
        totalHours={snapshot?.stats.totalEstimatedDuration ?? 0}
      />
      {snapshot?.planContext ? (
        <PlanBanner
          isRefreshing={isRefreshing}
          onFocusTask={handleFocusPlanTask}
          onOpenPlan={() => handleOpenPlanViewer(snapshot.planContext?.code)}
          onRefresh={handleRefreshGraph}
          planContext={snapshot.planContext}
        />
      ) : null}
      <div className="app-graph">
        <Graph
          centerTaskCode={centerTaskCode}
          emptyMessage="No tasks match the current filters. Clear filters to show everything."
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
      </div>
      <StatusBar
        onOrientationChange={handleOrientationChange}
        onToggleMiniMap={handleToggleMiniMap}
        orientation={orientation}
        showMiniMap={showMiniMap}
        statusCounts={{
          BLOCKED: snapshot?.stats.blockedCount ?? 0,
          DONE: snapshot?.stats.doneCount ?? 0,
          FAILED: snapshot?.stats.failedCount ?? 0,
          IN_PROGRESS: snapshot?.stats.inProgressCount ?? 0,
          PENDING: snapshot?.stats.pendingCount ?? 0
        }}
        totalTaskCount={totalTaskCount}
        visibleTaskCount={snapshot?.stats.taskCount ?? 0}
        zoom={viewport.zoom ?? 1}
      />
      {viewerPlanCode && selectedPlan ? (
        <ActionPlanViewer
          onClose={() => setViewerPlanCode(undefined)}
          onSelectTask={handleSelectPlanTask}
          plan={selectedPlan}
          tasks={planTasks[viewerPlanCode] ?? []}
        />
      ) : null}
      <Drawer
        activeTab={drawerTab}
        filters={filters}
        isOpen={drawerOpen}
        onClearFilters={handleClearFilters}
        onClose={() => {
          setDrawerOpen(false);
          setPromptExpanded(false);
        }}
        onClosePromptPanel={() => setPromptExpanded(false)}
        onEditTask={handleEditSelectedTask}
        onOpenPromptPanel={handleOpenPromptPanel}
        onSelectDependency={handleSelectDependency}
        onTabChange={(tab) => {
          setPromptExpanded(false);
          setDrawerTab(tab);
        }}
        promptExpanded={promptExpanded}
        selectedNode={selectedNode}
      />
    </div>
  );
}

function normalizeFilter(filter: TaskFilter): TaskFilter {
  const next: TaskFilter = {};

  if (filter.project && filter.project.length > 0) {
    next.project = filter.project;
  }
  if (filter.group && filter.group.length > 0) {
    next.group = filter.group;
  }
  if (filter.tags && filter.tags.length > 0) {
    next.tags = filter.tags;
  }
  if (filter.status && filter.status.length > 0) {
    next.status = filter.status;
  }
  if (filter.severity && filter.severity.length > 0) {
    next.severity = filter.severity;
  }
  if (filter.search?.trim()) {
    next.search = filter.search.trim();
  }
  if (filter.planCode) {
    next.planCode = filter.planCode;
  }

  return next;
}

function removeKey<T extends object, K extends keyof T>(value: T, key: K): T {
  const clone = { ...value };
  delete clone[key];
  return clone;
}
