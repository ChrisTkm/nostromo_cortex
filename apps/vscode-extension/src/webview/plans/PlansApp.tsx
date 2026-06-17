import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AiAgentAvatar,
  Button,
  FilterSelect,
  Metric,
  ProgressiveBar,
  Status,
  type CatalogAgent,
  type StatusTone,
} from "../components/atoms";
import {
  DataTable,
  DrawerShell,
  Footer,
  Header,
  SecondBar,
  type DataTableColumn,
} from "../components/molecules";
import { Module } from "../components/organisms";
import { PlanWizard } from "./PlanWizard";

type PlanRecord = {
  id?: string;
  code: string;
  title: string;
  description: string;
  goal: string;
  context: string;
  status: string;
  project?: string;
  product?: string;
  release?: string;
  tags: string[];
  progress: {
    total: number;
    pending: number;
    in_progress: number;
    blocked: number;
    done: number;
    failed: number;
  };
  author?: string;
  assignedAgent?: string;
  updatedAt: string;
};

type PlanAgent = {
  slug: string;
  displayName: string;
  iconPath?: string | null;
};

type PlansHostMessage =
  | {
      type: "plans:snapshot";
      plans: PlanRecord[];
      agents: PlanAgent[];
      catalogAgents?: CatalogAgent[];
    }
  | { type: "plans:created"; plan: PlanRecord; taskCount: number }
  | { type: "plans:error"; message: string };

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

const STATUS_LABEL: Record<string, string> = {
  PLANNING: "Planning",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

const STATUS_TONE: Record<string, StatusTone> = {
  PLANNING: "pending",
  IN_PROGRESS: "in-progress",
  DONE: "done",
  COMPLETED: "done",
  PAUSED: "blocked",
  ARCHIVED: "pending",
};

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function agentLabel(plan: PlanRecord, agentMap: Map<string, PlanAgent>): string {
  if (!plan.assignedAgent) return "";
  return agentMap.get(plan.assignedAgent)?.displayName ?? plan.assignedAgent;
}

function projectLabel(plan: PlanRecord): string {
  if (plan.product && plan.release) return `${plan.product}/${plan.release}`;
  return plan.project ?? plan.product ?? plan.release ?? "";
}

export function PlansApp() {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [agents, setAgents] = useState<PlanAgent[]>([]);
  const [catalogAgents, setCatalogAgents] = useState<CatalogAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [releaseFilter, setReleaseFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [drawerPlanCode, setDrawerPlanCode] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent<PlansHostMessage>) {
      const msg = event.data;
      if (msg?.type === "plans:snapshot") {
        setPlans(msg.plans);
        setAgents(msg.agents);
        setCatalogAgents(msg.catalogAgents ?? []);
        setLoading(false);
        setError(null);
      } else if (msg?.type === "plans:created") {
        setWizardOpen(false);
      } else if (msg?.type === "plans:error") {
        setError(msg.message);
        setLoading(false);
      }
    }
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const authorOptions = useMemo(() => {
    const authors = new Set<string>();
    for (const p of plans) {
      if (p.author) authors.add(p.author);
    }
    return Array.from(authors).sort();
  }, [plans]);

  const productOptions = useMemo(
    () => uniqueSorted(plans.map((p) => p.product)),
    [plans],
  );

  const releaseOptions = useMemo(
    () => uniqueSorted(plans.map((p) => p.release)),
    [plans],
  );

  const projectOptions = useMemo(
    () => uniqueSorted(plans.map((p) => p.project ?? projectLabel(p))),
    [plans],
  );

  const filteredPlans = useMemo(() => {
    let result = plans;
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (productFilter !== "all") {
      result = result.filter((p) => p.product === productFilter);
    }
    if (releaseFilter !== "all") {
      result = result.filter((p) => p.release === releaseFilter);
    }
    if (projectFilter !== "all") {
      result = result.filter((p) => (p.project ?? projectLabel(p)) === projectFilter);
    }
    if (authorFilter !== "all") {
      result = result.filter((p) => p.author === authorFilter);
    }
    return result;
  }, [plans, statusFilter, productFilter, releaseFilter, projectFilter, authorFilter]);

  const agentMap = useMemo(() => {
    const m = new Map<string, PlanAgent>();
    for (const a of agents) m.set(a.slug, a);
    return m;
  }, [agents]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    vscode.postMessage({ type: "plans:refresh" });
  }, []);

  const handleRowClick = useCallback((code: string) => {
    setDrawerPlanCode(code);
  }, []);

  const handleOpenEditor = useCallback((code: string) => {
    vscode.postMessage({ type: "plans:open", code });
  }, []);

  const handleViewGraph = useCallback((code: string) => {
    vscode.postMessage({ type: "plans:viewGraph", code });
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerPlanCode(null);
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.code === drawerPlanCode) ?? null,
    [plans, drawerPlanCode],
  );

  const handleCreate = useCallback(
    (
      plan: {
        code: string;
        title: string;
        description: string;
        goal: string;
        project: string;
        product: string;
        release: string;
        author: string;
        assignedAgent: string;
        tags: string[];
      },
      tasks: Array<{
        code: string;
        short_task: string;
        lane: string;
        severity: string;
        duration_estimate: number;
        agent: string;
      }>,
    ) => {
      vscode.postMessage({ type: "plans:create", plan, tasks });
    },
    [],
  );

  const columns = useMemo<DataTableColumn<PlanRecord>[]>(
    () => [
      {
        key: "code",
        label: "Código",
        width: 120,
        sortable: true,
        sortValue: (p) => p.code.toLowerCase(),
        render: (p) => <code className="plan-code">{p.code}</code>,
      },
      {
        key: "title",
        label: "Título",
        width: 260,
        sortable: true,
        sortValue: (p) => p.title.toLowerCase(),
        render: (p) => p.title,
      },
      {
        key: "product",
        label: "Producto",
        width: 120,
        sortable: true,
        sortValue: (p) => (p.product ?? "").toLowerCase(),
        render: (p) => p.product ?? <span className="dim">&mdash;</span>,
      },
      {
        key: "release",
        label: "Release",
        width: 120,
        sortable: true,
        sortValue: (p) => (p.release ?? "").toLowerCase(),
        render: (p) => p.release ?? <span className="dim">&mdash;</span>,
      },
      {
        key: "project",
        label: "Proyecto",
        width: 170,
        sortable: true,
        sortValue: (p) => projectLabel(p).toLowerCase(),
        render: (p) => projectLabel(p) || <span className="dim">&mdash;</span>,
      },
      {
        key: "status",
        label: "Estado",
        width: 120,
        sortable: true,
        sortValue: (p) => (STATUS_LABEL[p.status] ?? p.status).toLowerCase(),
        render: (p) => (
          <Status tone={STATUS_TONE[p.status] ?? "pending"}>
            {STATUS_LABEL[p.status] ?? p.status}
          </Status>
        ),
      },
      {
        key: "progress",
        label: "Progreso",
        width: 150,
        sortable: true,
        sortValue: (p) =>
          p.progress.total > 0
            ? p.progress.done * 10000 + p.progress.total
            : 0,
        render: (p) => {
          const isComplete =
            p.progress.total > 0 &&
            (p.status === "DONE" || p.progress.done >= p.progress.total);
          const progressValue = isComplete
            ? p.progress.total
            : p.progress.done;

          return (
            <span
              className={[
                "plan-progress",
                isComplete ? "plan-progress--complete" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="plan-progress__text">
                {p.progress.done}/{p.progress.total}
              </span>
              <ProgressiveBar
                max={p.progress.total}
                tone={isComplete ? "done" : (STATUS_TONE[p.status] ?? "done")}
                value={progressValue}
                variant="compact"
              />
            </span>
          );
        },
      },
      {
        key: "author",
        label: "Autor",
        width: 110,
        sortable: true,
        sortValue: (p) => (p.author ?? "").toLowerCase(),
        render: (p) => p.author ?? <span className="dim">&mdash;</span>,
      },
      {
        key: "agent",
        label: "Agente",
        width: 170,
        sortable: true,
        sortValue: (p) => agentLabel(p, agentMap).toLowerCase(),
        render: (p) => {
          const agent = p.assignedAgent
            ? agentMap.get(p.assignedAgent)
            : undefined;
          if (agent) {
            return (
              <span className="agent-cell">
                <AiAgentAvatar
                  displayName={agent.displayName}
                  iconPath={agent.iconPath}
                  slug={agent.slug}
                  size={18}
                />
                <span>{agent.displayName}</span>
              </span>
            );
          }
          if (p.assignedAgent) {
            return (
              <span className="agent-cell">
                <AiAgentAvatar
                  displayName={p.assignedAgent}
                  slug={p.assignedAgent}
                  size={18}
                />
                <span>{p.assignedAgent}</span>
              </span>
            );
          }
          return <span className="dim">&mdash;</span>;
        },
      },
      {
        key: "updatedAt",
        label: "Actualizado",
        width: 130,
        sortable: true,
        sortValue: (p) => new Date(p.updatedAt).getTime(),
        render: (p) => isoToLocal(p.updatedAt),
      },
      {
        key: "actions",
        label: "Acciones",
        width: 96,
        render: (p) => (
          <span className="plan-actions">
            <Button
              className="atom-button--icon"
              disabled={p.status !== "DONE"}
              intent="change"
              onClick={(e) => {
                e.stopPropagation();
                vscode.postMessage({ type: "plans:archive", code: p.code });
              }}
              size="small"
              title={
                p.status === "DONE"
                  ? "Archivar plan"
                  : "Solo se puede archivar planes en estado DONE"
              }
            >
              <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
                <path d="M2.5 8.5h11v5h-11z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
                <path d="M2 3.5h12v3H2z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
                <path d="M7 4.5v5M5.5 7.5 8 10l2.5-2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
              </svg>
            </Button>
            <Button
              className="atom-button--icon"
              intent="danger"
              onClick={(e) => {
                e.stopPropagation();
                vscode.postMessage({ type: "plans:delete", code: p.code });
              }}
              size="small"
              title="Eliminar plan"
            >
              <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
                <path d="M2.5 3.5h11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
                <path d="M5 3.5V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
                <path d="M3.5 3.5v9.25A1.25 1.25 0 0 0 4.75 14h6.5a1.25 1.25 0 0 0 1.25-1.25V3.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
                <path d="M6.5 6.5v4M9.5 6.5v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
              </svg>
            </Button>
          </span>
        ),
      },
    ],
    [agentMap],
  );

  if (loading && plans.length === 0) {
    return (
      <div className="loading">
        <span>Cargando Planes...</span>
      </div>
    );
  }

  if (error && plans.length === 0) {
    return (
      <div className="loading">
        <span className="error-text">{error}</span>
        <Button intent="refresh" onClick={handleRefresh}>
          Reintentar
        </Button>
      </div>
    );
  }

  const header = (
    <Header
      name="CORTEX PLANS"
      actions={
        <>
          <Button intent="new" onClick={() => setWizardOpen(true)} size="small">
            + Nuevo
          </Button>
          <Button intent="refresh" onClick={handleRefresh} size="small">
            Refresh
          </Button>
        </>
      }
    />
  );

  const secondBar = (
    <SecondBar
      filters={
        <div className="plans-secondbar-filters">
          <FilterSelect
            onChange={(e) => setStatusFilter(e.target.value)}
            value={statusFilter}
          >
            <option value="all">Todos los estados</option>
            <option value="PLANNING">Planning</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="DONE">Done</option>
            <option value="PAUSED">Paused</option>
            <option value="ARCHIVED">Archived</option>
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setProductFilter(e.target.value)}
            value={productFilter}
          >
            <option value="all">Todos los productos</option>
            {productOptions.map((product) => (
              <option key={product} value={product}>
                {product}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setReleaseFilter(e.target.value)}
            value={releaseFilter}
          >
            <option value="all">Todas las releases</option>
            {releaseOptions.map((release) => (
              <option key={release} value={release}>
                {release}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setProjectFilter(e.target.value)}
            value={projectFilter}
          >
            <option value="all">Todos los proyectos</option>
            {projectOptions.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setAuthorFilter(e.target.value)}
            value={authorFilter}
          >
            <option value="all">Todos los autores</option>
            {authorOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </FilterSelect>
        </div>
      }
    />
  );

  const drawer = (
    <DrawerShell
      actions={
        selectedPlan ? (
          <>
            <Button intent="change" onClick={() => handleViewGraph(selectedPlan.code)} size="small">
              View graph
            </Button>
            <Button intent="change" onClick={() => handleOpenEditor(selectedPlan.code)} size="small">
              Editar
            </Button>
          </>
        ) : undefined
      }
      header={
        selectedPlan ? (
          <>
            <div className="drawer-header__code">{selectedPlan.code}</div>
            <h2 className="drawer-header__title">{selectedPlan.title}</h2>
          </>
        ) : undefined
      }
      isOpen={Boolean(drawerPlanCode && selectedPlan)}
      onClose={handleCloseDrawer}
    >
      {selectedPlan ? (
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
              {selectedPlan.progress.done} / {selectedPlan.progress.total} tareas completadas
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
        </div>
      ) : null}
    </DrawerShell>
  );

  const footer = (
    <Footer
      left={
        <>
          <Metric label="Total">{plans.length}</Metric>
          <Metric label="Visibles">{filteredPlans.length}</Metric>
        </>
      }
    />
  );

  return (
    <Module
      drawer={drawer}
      footer={footer}
      header={header}
      overlay={
        wizardOpen ? (
          <PlanWizard
            agents={catalogAgents}
            onClose={() => setWizardOpen(false)}
            onCreate={handleCreate}
          />
        ) : undefined
      }
      secondBar={secondBar}
    >
      <div className="table-section">
        <DataTable
          className="plans-table"
          columns={columns}
          empty="Sin planes"
          getRowKey={(p) => p.code}
          onRowClick={(p) => handleRowClick(p.code)}
          rows={filteredPlans}
        />
      </div>
    </Module>
  );
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b),
  );
}
