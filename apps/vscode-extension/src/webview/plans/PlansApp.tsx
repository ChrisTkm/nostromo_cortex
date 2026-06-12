import { useCallback, useEffect, useMemo, useState } from "react";

import { AiAgentAvatar } from "../components/AiAgentAvatar";
import { type CatalogAgent } from "../components/AgentSelect";
import { PlanWizard } from "./PlanWizard";

type PlanRecord = {
  id?: string;
  code: string;
  title: string;
  status: string;
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
  | { type: "plans:snapshot"; plans: PlanRecord[]; agents: PlanAgent[]; catalogAgents?: CatalogAgent[] }
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

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PLANNING: { label: "Planning", className: "ps--planning" },
  IN_PROGRESS: { label: "In Progress", className: "ps--progress" },
  DONE: { label: "Done", className: "ps--done" },
  COMPLETED: { label: "Completed", className: "ps--done" },
  PAUSED: { label: "Paused", className: "ps--paused" },
  ARCHIVED: { label: "Archived", className: "ps--archived" },
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

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="progress-cell">
      <span className="progress-text">{done}/{total}</span>
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function PlansApp() {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [agents, setAgents] = useState<PlanAgent[]>([]);
  const [catalogAgents, setCatalogAgents] = useState<CatalogAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [wizardOpen, setWizardOpen] = useState(false);

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

  const filteredPlans = useMemo(() => {
    let result = plans;
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (authorFilter !== "all") {
      result = result.filter((p) => p.author === authorFilter);
    }
    return result;
  }, [plans, statusFilter, authorFilter]);

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
    vscode.postMessage({ type: "plans:open", code });
  }, []);

  const handleCreate = useCallback(
    (plan: { code: string; title: string; description: string; goal: string; author: string; assignedAgent: string; tags: string[] }, tasks: Array<{ code: string; short_task: string; lane: string; severity: string; duration_estimate: number; agent: string }>) => {
      vscode.postMessage({ type: "plans:create", plan, tasks });
    },
    [],
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
        <button className="btn" onClick={handleRefresh}>Reintentar</button>
      </div>
    );
  }

  return (
    <div className="plans-container">
      <div className="toolbar">
        <h2>Planes</h2>
        <div className="filters">
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos los estados</option>
            <option value="PLANNING">Planning</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="DONE">Done</option>
            <option value="PAUSED">Paused</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <select
            className="filter-select"
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
          >
            <option value="all">Todos los autores</option>
            {authorOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button className="btn" onClick={() => setWizardOpen(true)} title="Nuevo plan">
            + Nuevo
          </button>
          <button className="btn" onClick={handleRefresh} title="Refrescar">
            &#x21bb;
          </button>
        </div>
      </div>

      <div className="table-section">
        <table className="plans-table">
          <thead>
            <tr>
              <th>C&oacute;digo</th>
              <th>T&iacute;tulo</th>
              <th>Estado</th>
              <th>Progreso</th>
              <th>Autor</th>
              <th>Agente</th>
              <th>Actualizado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlans.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-row">Sin planes</td>
              </tr>
            )}
            {filteredPlans.map((plan) => {
              const cfg = STATUS_CONFIG[plan.status] ?? { label: plan.status, className: "" };
              const agent = plan.assignedAgent ? agentMap.get(plan.assignedAgent) : undefined;
              return (
                <tr key={plan.code} className="plan-row" onClick={() => handleRowClick(plan.code)}>
                  <td><code className="plan-code">{plan.code}</code></td>
                  <td className="plan-title-cell">{plan.title}</td>
                  <td><span className={`plan-status-badge ${cfg.className}`}>{cfg.label}</span></td>
                  <td><ProgressBar done={plan.progress.done} total={plan.progress.total} /></td>
                  <td>{plan.author ?? <span className="dim">&mdash;</span>}</td>
                  <td>
                    {agent ? (
                      <span className="agent-cell">
                        <AiAgentAvatar
                          displayName={agent.displayName}
                          iconPath={agent.iconPath}
                          slug={agent.slug}
                          size={18}
                        />
                        <span>{agent.displayName}</span>
                      </span>
                    ) : plan.assignedAgent ? (
                      <span className="agent-cell">
                        <AiAgentAvatar
                          displayName={plan.assignedAgent}
                          slug={plan.assignedAgent}
                          size={18}
                        />
                        <span>{plan.assignedAgent}</span>
                      </span>
                    ) : (
                      <span className="dim">&mdash;</span>
                    )}
                  </td>
                  <td>{isoToLocal(plan.updatedAt)}</td>
                  <td>
                    <button
                      className="pa-btn pa-btn--archive"
                      disabled={plan.status !== "DONE"}
                      onClick={(e) => { e.stopPropagation(); vscode.postMessage({ type: "plans:archive", code: plan.code }); }}
                      title={plan.status === "DONE" ? "Archivar plan" : "Solo se puede archivar planes en estado DONE"}
                      type="button"
                    >
                      &#x1f4e4;
                    </button>
                    <button
                      className="pa-btn pa-btn--delete"
                      onClick={(e) => { e.stopPropagation(); vscode.postMessage({ type: "plans:delete", code: plan.code }); }}
                      title="Eliminar plan"
                      type="button"
                    >
                      &#x1f5d1;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {wizardOpen ? (
        <PlanWizard agents={catalogAgents} onClose={() => setWizardOpen(false)} onCreate={handleCreate} />
      ) : null}
    </div>
  );
}
