import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

type SnapshotNode = {
  id: string;
  code: string;
  project?: string;
  label: string;
  detail: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "FAILED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  agent: string;
  lane?: string;
  durationEstimate?: number;
  orderHint?: number;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
  dependsOn: string[];
  ready: boolean | number;
  blockedByCount: number;
  downstreamCount: number;
  tags: string[];
  tooltip: string;
};

type Snapshot = {
  nodes: SnapshotNode[];
  edges: Array<{ id: string; source: string; target: string }>;
  stats: {
    taskCount: number;
    edgeCount: number;
    readyCount: number;
    blockedCount: number;
    cycleCount: number;
    doneCount: number;
    inProgressCount: number;
    pendingCount: number;
    failedCount: number;
    totalEstimatedDuration: number;
    readyEstimatedDuration: number;
  };
};

type WebviewState = {
  orientation: "LR" | "TB";
  selectedTaskCode?: string;
  zoom?: number;
  pan?: { x: number; y: number };
  sidebarCollapsed?: boolean;
};

type ConnectionInfo = {
  mongoUrl: string;
  mongoDbName: string;
  mongoTasksCollection: string;
};

type FilterInfo = {
  selectedProjects: string[];
  selectedGroups: string[];
  selectedTags: string[];
  searchQuery?: string;
};

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
const graphElement = must("graph");
const tooltipElement = must("tooltip");
const statsElement = must("stats");
const selectedCodeElement = must("selected-code");
const selectedProjectElement = must("selected-project");
const selectedAgentElement = must("selected-agent");
const selectedStatusElement = must("selected-status");
const selectedSeverityElement = must("selected-severity");
const summaryTitleElement = must("summary-title");
const summaryElement = must("summary");
const dependenciesElement = must("dependencies");
const successorsElement = must("successors");
const metadataElement = must("metadata");
const metricReadyElement = must("metric-ready");
const metricDurationElement = must("metric-duration");
const metricBlockedElement = must("metric-blocked");
const metricDownstreamElement = must("metric-downstream");
const metaProjectElement = must("meta-project");
const metaLaneElement = must("meta-lane");
const metaSourceElement = must("meta-source");
const metaCollectionElement = must("meta-collection");
const metaCreatedElement = must("meta-created");
const metaUpdatedElement = must("meta-updated");
const kpiTotalElement = must("kpi-total");
const kpiReadyElement = must("kpi-ready");
const kpiBlockedElement = must("kpi-blocked");
const kpiDoneElement = must("kpi-done");
const kpiDurationElement = must("kpi-duration");
const kpiReadyDurationElement = must("kpi-ready-duration");
const countDoneElement = must("count-done");
const countProgressElement = must("count-progress");
const countPendingElement = must("count-pending");
const countBlockedElement = must("count-blocked");
const countFailedElement = must("count-failed");
const filterProjectsElement = must("filter-projects");
const filterGroupsElement = must("filter-groups");
const filterTagsElement = must("filter-tags");
const connectionDbElement = must("connection-db");
const refreshButton = must("refresh") as HTMLButtonElement;
const fitButton = must("fit") as HTMLButtonElement;
const clearSelectionButton = must("clear-selection") as HTMLButtonElement;
const editTaskButton = must("edit-task") as HTMLButtonElement;
const toggleSidebarButton = must("toggle-sidebar") as HTMLButtonElement;
const orientationSelect = must("orientation") as HTMLSelectElement;
let pulseOn = false;
let pulseTimer: number | undefined;

const cy = cytoscape({
  container: graphElement,
  wheelSensitivity: 0.45,
  minZoom: 0.2,
  maxZoom: 2.8,
  style: [
    {
      selector: "node",
      style: {
        label: "data(displayLabel)",
        "text-wrap": "wrap",
        "text-max-width": 170,
        width: 208,
        height: 118,
        padding: 12,
        shape: "round-rectangle",
        "background-color": "rgba(15, 23, 42, 0.04)",
        color: "#f8fbff",
        "font-size": 13.2,
        "font-weight": 700,
        "line-height": 1.2,
        "font-family": "\"JetBrains Mono\", monospace",
        "text-valign": "center",
        "text-halign": "center",
        "border-width": 1.5,
        "border-color": "#a5b4fc",
        "overlay-opacity": 0,
        "shadow-blur": 16,
        "shadow-color": "rgba(4, 8, 16, 0.18)",
        "shadow-offset-y": 6
      }
    },
    { selector: "node[status = 'DONE']", style: { "border-color": "#64f1c2" } },
    { selector: "node[status = 'IN_PROGRESS']", style: { "border-color": "#818cf8" } },
    { selector: "node[status = 'PENDING']", style: { "border-color": "#a5b4fc" } },
    { selector: "node[status = 'BLOCKED']", style: { "border-color": "#cbd5e1" } },
    { selector: "node[status = 'FAILED']", style: { "border-color": "#9ca3af" } },
    {
      selector: "node.progress-node",
      style: {
        "border-width": 1.5,
        "shadow-blur": 18,
        "shadow-color": "rgba(129, 140, 248, 0.16)"
      }
    },
    {
      selector: "node.progress-node.pulse",
      style: {
        "border-color": "#6366f1",
        "shadow-color": "rgba(99, 102, 241, 0.34)"
      }
    },
    {
      selector: "edge",
      style: {
        width: 2.4,
        opacity: 0.8,
        "line-color": "#526279",
        "target-arrow-color": "#526279",
        "target-arrow-shape": "triangle",
        "curve-style": "taxi",
        "taxi-direction": "horizontal",
        "taxi-turn": 26,
        "source-endpoint": "outside-to-node",
        "target-endpoint": "outside-to-node"
      }
    },
    {
      selector: "edge[targetReady = 1]",
      style: {
        "line-color": "#64f1c2",
        "target-arrow-color": "#64f1c2",
        width: 2.8
      }
    },
    {
      selector: "edge.attention-edge",
      style: {
        width: 3,
        "line-style": "dashed",
        "line-dash-pattern": [10, 7],
        "line-color": "#818cf8",
        "target-arrow-color": "#818cf8"
      }
    },
    {
      selector: "edge.attention-edge.pulse",
      style: {
        "line-color": "#6366f1",
        "target-arrow-color": "#6366f1"
      }
    },
    { selector: ".dimmed", style: { opacity: 0.16 } },
    {
      selector: ".highlight",
      style: {
        opacity: 1,
        "line-color": "#7aa2ff",
        "target-arrow-color": "#7aa2ff",
        "shadow-blur": 34,
        "shadow-color": "rgba(122, 162, 255, 0.34)"
      }
    },
    {
      selector: ".selected-node",
      style: {
        "border-width": 2.4,
        "shadow-blur": 28,
        "shadow-color": "rgba(103, 232, 249, 0.32)"
      }
    }
  ]
});

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

function formatHours(value?: number) {
  return typeof value === "number" ? `${value}h` : "—";
}

function formatShortDate(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}

function truncate(text: string, max = 34) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function labelFor(node: SnapshotNode) {
  const statusLine = `${humanizeStatus(node.status)} • ${node.severity}`;
  const footer = [node.project ?? node.lane ?? "sin grupo", node.agent, typeof node.durationEstimate === "number" ? `${node.durationEstimate}h` : "—"].join(" • ");
  return `${node.code}\n${truncate(node.label, 36)}\n${statusLine}\n${truncate(footer, 38)}`;
}

function humanizeStatus(status: SnapshotNode["status"]) {
  switch (status) {
    case "IN_PROGRESS":
      return "IN PROGRESS";
    default:
      return status;
  }
}

function badge(text: string, className = "") {
  return `<span class="badge ${className}"><code>${text}</code></span>`;
}

function renderList(element: HTMLElement, values: string[]) {
  element.innerHTML = values.length > 0 ? values.map((value) => badge(value)).join("") : `<span class="empty">—</span>`;
}

function updateStats(snapshot: Snapshot) {
  statsElement.textContent = `${snapshot.stats.taskCount} tasks • ${snapshot.stats.edgeCount} edges • ${snapshot.stats.cycleCount} cycles`;
  kpiTotalElement.textContent = String(snapshot.stats.taskCount);
  kpiReadyElement.textContent = String(snapshot.stats.readyCount);
  kpiBlockedElement.textContent = String(snapshot.stats.blockedCount);
  kpiDoneElement.textContent = String(snapshot.stats.doneCount);
  kpiDurationElement.textContent = `${snapshot.stats.totalEstimatedDuration}h`;
  kpiReadyDurationElement.textContent = `${snapshot.stats.readyEstimatedDuration}h`;
  countDoneElement.textContent = String(snapshot.stats.doneCount);
  countProgressElement.textContent = String(snapshot.stats.inProgressCount);
  countPendingElement.textContent = String(snapshot.stats.pendingCount);
  countBlockedElement.textContent = String(snapshot.stats.blockedCount);
  countFailedElement.textContent = String(snapshot.stats.failedCount);
}

function updateFilterBadges(filters: FilterInfo) {
  filterProjectsElement.textContent = `Project · ${filters.selectedProjects.length > 0 ? filters.selectedProjects.join(", ") : "all"}`;
  filterGroupsElement.textContent = `Group · ${filters.selectedGroups.length > 0 ? filters.selectedGroups.join(", ") : "all"}`;
  const tagsLabel = filters.selectedTags.length > 0 ? filters.selectedTags.join(", ") : "all";
  filterTagsElement.textContent = filters.searchQuery ? `Tags · ${tagsLabel} · ${filters.searchQuery}` : `Tags · ${tagsLabel}`;
}

function updateConnectionInfo(connection: ConnectionInfo) {
  const shortenedUrl = connection.mongoUrl.replace(/^mongodb:\/\//, "");
  connectionDbElement.textContent = `${shortenedUrl}/${connection.mongoDbName}.${connection.mongoTasksCollection}`;
  metaCollectionElement.textContent = `${connection.mongoDbName}.${connection.mongoTasksCollection}`;
}

function setSidebarCollapsed(collapsed: boolean) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  toggleSidebarButton.textContent = collapsed ? "Show details" : "Hide details";
  const previousState = (vscode.getState() as WebviewState | undefined) ?? { orientation: "LR" as const };
  vscode.setState({
    ...previousState,
    sidebarCollapsed: collapsed
  });
}

function applyChipTone(element: HTMLElement, type: "status" | "severity", value?: string) {
  element.className = "badge";
  if (!value) {
    return;
  }

  if (type === "status") {
    const normalized =
      value === "DONE"
        ? "status-chip-done"
        : value === "IN_PROGRESS"
          ? "status-chip-progress"
          : value === "BLOCKED"
            ? "status-chip-blocked"
            : value === "FAILED"
              ? "status-chip-failed"
              : "status-chip-pending";
    element.classList.add(normalized);
    return;
  }

  const severityClass = `severity-${value.toLowerCase()}`;
  element.classList.add(severityClass);
}

function resetSelection() {
  cy.elements().removeClass("dimmed highlight selected-node");
  selectedCodeElement.textContent = "No task selected";
  selectedProjectElement.textContent = "No project";
  selectedAgentElement.textContent = "No agent";
  selectedStatusElement.textContent = "No status";
  selectedSeverityElement.textContent = "No severity";
  applyChipTone(selectedStatusElement, "status");
  applyChipTone(selectedSeverityElement, "severity");
  summaryTitleElement.textContent = "Select a task";
  summaryElement.textContent = "Pick a node from the graph or task navigator to inspect the task and edit it if needed.";
  metricReadyElement.textContent = "—";
  metricDurationElement.textContent = "—";
  metricBlockedElement.textContent = "—";
  metricDownstreamElement.textContent = "—";
  metaProjectElement.textContent = "—";
  metaLaneElement.textContent = "—";
  metaSourceElement.textContent = "—";
  metaCreatedElement.textContent = "—";
  metaUpdatedElement.textContent = "—";
  renderList(dependenciesElement, []);
  renderList(successorsElement, []);
  renderList(metadataElement, []);
  editTaskButton.disabled = true;
  vscode.setState({
    ...(vscode.getState() as object),
    selectedTaskCode: undefined
  });
}

function applyLayout(rankDir: "LR" | "TB") {
  orientationSelect.value = rankDir;
  cy.layout({
    name: "dagre",
    rankDir,
    nodeSep: rankDir === "LR" ? 46 : 54,
    rankSep: rankDir === "LR" ? 96 : 112,
    edgeSep: 14,
    animate: false
  }).run();
}

function fitGraph() {
  cy.fit(undefined, 36);
}

function syncPulseElements() {
  cy.elements(".attention-edge, .progress-node").removeClass("pulse");
  if (pulseOn) {
    cy.elements(".attention-edge, .progress-node").addClass("pulse");
  }
}

function restartPulseLoop() {
  if (pulseTimer) {
    window.clearInterval(pulseTimer);
  }
  pulseTimer = window.setInterval(() => {
    pulseOn = !pulseOn;
    syncPulseElements();
  }, 700);
}

function render(snapshot: Snapshot, state: WebviewState, connection: ConnectionInfo, filters: FilterInfo) {
  const persistedState = vscode.getState() as WebviewState | undefined;
  const byCode = new Map(snapshot.nodes.map((node) => [node.code, node]));
  const readyTargets = new Set(snapshot.nodes.filter((node) => Boolean(node.ready)).map((node) => node.code));
  const attentionEdges = new Set(
    snapshot.edges
      .filter((edge) => {
        const source = byCode.get(edge.source);
        const target = byCode.get(edge.target);
        return source?.status === "DONE" && (target?.status === "PENDING" || target?.status === "IN_PROGRESS");
      })
      .map((edge) => edge.id)
  );
  const progressNodes = new Set(snapshot.nodes.filter((node) => node.status === "IN_PROGRESS").map((node) => node.code));

  cy.elements().remove();
  cy.add([
    ...snapshot.nodes.map((node) => ({
      data: {
        ...node,
        displayLabel: labelFor(node),
        ready: node.ready ? 1 : 0
      },
      classes: progressNodes.has(node.code) ? "progress-node" : ""
    })),
    ...snapshot.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        targetReady: readyTargets.has(edge.target) ? 1 : 0
      },
      classes: attentionEdges.has(edge.id) ? "attention-edge" : ""
    }))
  ]);

  updateConnectionInfo(connection);
  updateFilterBadges(filters);
  setSidebarCollapsed(Boolean(state.sidebarCollapsed ?? persistedState?.sidebarCollapsed));
  applyLayout(state.orientation);
  updateStats(snapshot);
  pulseOn = true;
  syncPulseElements();
  restartPulseLoop();

  if (typeof state.zoom === "number") {
    cy.zoom(state.zoom);
  } else {
    fitGraph();
  }

  if (state.pan) {
    cy.pan(state.pan);
  }

  if (state.selectedTaskCode) {
    const node = cy.getElementById(state.selectedTaskCode);
    if (node.nonempty()) {
      selectNode(node);
      return;
    }
  }

  resetSelection();
}

function selectNode(node: cytoscape.NodeSingular) {
  cy.elements().addClass("dimmed").removeClass("highlight selected-node");
  node.removeClass("dimmed").addClass("highlight selected-node");
  const incoming = node.incomers("node,edge");
  const outgoing = node.outgoers("node,edge");
  incoming.removeClass("dimmed").addClass("highlight");
  outgoing.removeClass("dimmed").addClass("highlight");

  const data = node.data() as SnapshotNode;
  selectedCodeElement.textContent = data.code;
  selectedProjectElement.textContent = data.project ? `Project · ${data.project}` : `Group · ${data.lane ?? "—"}`;
  selectedAgentElement.textContent = `Agent · ${data.agent}`;
  selectedStatusElement.textContent = `Status · ${humanizeStatus(data.status)}`;
  selectedSeverityElement.textContent = `Severity · ${data.severity}`;
  applyChipTone(selectedStatusElement, "status", data.status);
  applyChipTone(selectedSeverityElement, "severity", data.severity);
  summaryTitleElement.textContent = data.label;
  summaryElement.innerHTML = `<div class="summary-text">${data.detail || "No detail provided."}</div>`;
  metricReadyElement.textContent = data.ready ? "Yes" : "No";
  metricDurationElement.textContent = formatHours(data.durationEstimate);
  metricBlockedElement.textContent = String(data.blockedByCount);
  metricDownstreamElement.textContent = String(data.downstreamCount);
  metaProjectElement.textContent = data.project ?? "—";
  metaLaneElement.textContent = data.lane ?? "—";
  metaSourceElement.textContent = data.sourceRef ?? "—";
  metaCreatedElement.textContent = formatShortDate(data.createdAt);
  metaUpdatedElement.textContent = formatShortDate(data.updatedAt);
  renderList(dependenciesElement, data.dependsOn);
  renderList(
    successorsElement,
    node
      .outgoers("node")
      .map((item) => String(item.data("code")))
  );
  renderList(metadataElement, data.tags);
  editTaskButton.disabled = false;

  vscode.setState({
    ...(vscode.getState() as object),
    selectedTaskCode: data.code
  });
  vscode.postMessage({
    type: "selectionChanged",
    selectedTaskCode: data.code
  });
}

cy.on("tap", "node", (event) => {
  selectNode(event.target);
});

cy.on("tap", (event) => {
  if (event.target === cy) {
    resetSelection();
  }
});

cy.on("mouseover", "node", (event) => {
  const node = event.target.data() as SnapshotNode;
  tooltipElement.innerHTML = `<strong>${node.code}</strong><br/>${truncate(node.label, 58)}<br/><span style="opacity:.75">${node.project ?? node.lane ?? "sin grupo"} • ${node.agent} • ${formatHours(node.durationEstimate)} • ${humanizeStatus(node.status)} • ${node.severity}</span>`;
  tooltipElement.style.display = "block";
  tooltipElement.style.left = `${event.renderedPosition.x + 12}px`;
  tooltipElement.style.top = `${event.renderedPosition.y + 12}px`;
});

cy.on("mouseout", "node", () => {
  tooltipElement.style.display = "none";
});

cy.on("zoom pan", () => {
  vscode.postMessage({
    type: "viewportChanged",
    zoom: cy.zoom(),
    pan: cy.pan()
  });
});

refreshButton.addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

fitButton.addEventListener("click", () => {
  fitGraph();
});

clearSelectionButton.addEventListener("click", () => {
  resetSelection();
});

editTaskButton.addEventListener("click", () => {
  const state = vscode.getState() as WebviewState | undefined;
  if (!state?.selectedTaskCode) {
    return;
  }
  vscode.postMessage({ type: "editTask", code: state.selectedTaskCode });
});

toggleSidebarButton.addEventListener("click", () => {
  setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
});

orientationSelect.addEventListener("change", () => {
  applyLayout(orientationSelect.value as "LR" | "TB");
  fitGraph();
  vscode.postMessage({
    type: "orientationChanged",
    orientation: orientationSelect.value
  });
});

window.addEventListener("message", (event) => {
  const message = event.data as {
    type: string;
    snapshot: Snapshot;
    state: WebviewState;
    connection: ConnectionInfo;
    filters: FilterInfo;
  };
  if (message.type === "snapshot") {
    render(message.snapshot, message.state, message.connection, message.filters);
  }
});

resetSelection();
setSidebarCollapsed(Boolean((vscode.getState() as WebviewState | undefined)?.sidebarCollapsed));
vscode.postMessage({ type: "ready" });
