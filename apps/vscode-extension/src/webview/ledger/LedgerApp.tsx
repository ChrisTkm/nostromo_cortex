import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";

type AgentRunRecord = {
  id: string;
  agentSlug: string;
  modelId?: string;
  startedAt: string;
  endedAt: string | null;
  taskCodes: string[];
  filesTouched: string[];
  commits: string[];
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  status: "running" | "completed" | "failed";
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type LedgerAgent = {
  slug: string;
  name: string;
  iconUri: string;
};

type LedgerHostMessage =
  | { type: "ledger:snapshot"; runs: AgentRunRecord[]; agents: LedgerAgent[] }
  | { type: "ledger:error"; message: string };

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

const SATURATION = 55;
const LIGHTNESS = 45;

function slugToHue(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}

function firstLetter(name: string): string {
  return name.charAt(0).toUpperCase();
}

function AgentIcon({ agent, size }: { agent: LedgerAgent; size?: number }) {
  const s = size ?? 20;
  if (agent.iconUri) {
    return (
      <img
        src={agent.iconUri}
        alt={agent.name}
        style={{
          width: s,
          height: s,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: s,
        height: s,
        borderRadius: "50%",
        backgroundColor: `hsl(${slugToHue(agent.slug)}, ${SATURATION}%, ${LIGHTNESS}%)`,
        color: "#fff",
        fontSize: Math.max(9, Math.round(s * 0.45)),
        fontWeight: 600,
        lineHeight: 1,
        flexShrink: 0,
      }}
      title={agent.name}
    >
      {firstLetter(agent.name)}
    </span>
  );
}

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function statusLabel(status: string): string {
  return status === "running" ? "\u25B6" : status === "completed" ? "\u2713" : "\u2717";
}

function statusClass(status: string): string {
  return status === "completed" ? "status-done" : status === "failed" ? "status-fail" : "status-run";
}

function computeDailyCounts(runs: AgentRunRecord[], days: number): { date: string; count: number }[] {
  const map = new Map<string, number>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const run of runs) {
    const key = isoDateOnly(run.startedAt);
    if (map.has(key)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
}

export function LedgerApp() {
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [agents, setAgents] = useState<LedgerAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [chartDays, setChartDays] = useState(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function onMessage(event: MessageEvent<LedgerHostMessage>) {
      const msg = event.data;
      if (msg?.type === "ledger:snapshot") {
        setRuns(msg.runs);
        setAgents(msg.agents);
        setLoading(false);
        setError(null);
      } else if (msg?.type === "ledger:error") {
        setError(msg.message);
        setLoading(false);
      }
    }
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const filteredRuns = useMemo(() => {
    if (agentFilter === "all") return runs;
    return runs.filter((r) => r.agentSlug === agentFilter);
  }, [runs, agentFilter]);

  const dailyCounts = useMemo(() => computeDailyCounts(filteredRuns, chartDays), [filteredRuns, chartDays]);
  const maxCount = useMemo(() => Math.max(1, ...dailyCounts.map((d) => d.count)), [dailyCounts]);

  const agentMap = useMemo(() => {
    const m = new Map<string, LedgerAgent>();
    for (const a of agents) m.set(a.slug, a);
    return m;
  }, [agents]);

  function handleRefresh() {
    setLoading(true);
    vscode.postMessage({ type: "ledger:refresh" });
  }

  function handleAgentFilter(next: string) {
    setAgentFilter(next);
    vscode.postMessage({ type: "ledger:setFilter", agentSlug: next === "all" ? undefined : next });
  }

  if (loading && runs.length === 0) {
    return (
      <div className="loading">
        <span>Cargando Ledger...</span>
      </div>
    );
  }

  if (error && runs.length === 0) {
    return (
      <div className="loading">
        <span className="error-text">{error}</span>
        <button className="btn" onClick={handleRefresh}>Reintentar</button>
      </div>
    );
  }

  return (
    <div className="ledger-container">
      <PageHeader title="CORTEX LEDGER" />
      <div className="toolbar">
        <div className="filters">
          <select
            className="filter-select"
            value={agentFilter}
            onChange={(e) => handleAgentFilter(e.target.value)}
          >
            <option value="all">Todos los agentes</option>
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={chartDays}
            onChange={(e) => setChartDays(Number(e.target.value))}
          >
            <option value={7}>7 d&iacute;as</option>
            <option value={14}>14 d&iacute;as</option>
            <option value={30}>30 d&iacute;as</option>
          </select>
          <button className="btn" onClick={handleRefresh} title="Refrescar">
            &#x21bb;
          </button>
        </div>
      </div>

      <div className="chart-section">
        <h3>Runs / d&iacute;a</h3>
        <div className="bar-chart">
          {dailyCounts.map((d) => (
            <div key={d.date} className="bar-col">
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ height: `${(d.count / maxCount) * 100}%` }}
                  title={`${d.date}: ${d.count} runs`}
                />
              </div>
              <span className="bar-label">
                {d.date.slice(5)}
              </span>
              <span className="bar-value">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="table-section">
        <table className="runs-table">
          <thead>
            <tr>
              <th>Agente</th>
              <th>Inicio</th>
              <th>Estado</th>
              <th>Tasks</th>
              <th>Tokens</th>
              <th>Archivos</th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">Sin runs</td>
              </tr>
            )}
            {filteredRuns.map((run) => {
              const agent = agentMap.get(run.agentSlug);
              return (
                <tr key={run.id} className={`run-row ${statusClass(run.status)}`}>
                  <td>
                    <span className="agent-cell">
                      {agent && <AgentIcon agent={agent} />}
                      <span className="agent-slug">{agent?.name ?? run.agentSlug}</span>
                    </span>
                  </td>
                  <td>{isoToLocal(run.startedAt)}</td>
                  <td><span className={`status-badge ${statusClass(run.status)}`}>{statusLabel(run.status)}</span></td>
                  <td>
                    <span className="codes-list">
                      {run.taskCodes.length > 0
                        ? run.taskCodes.join(", ")
                        : <span className="dim">—</span>
                      }
                    </span>
                  </td>
                  <td>
                    {typeof run.tokensIn === "number" || typeof run.tokensOut === "number"
                      ? `${run.tokensIn ?? "?"} / ${run.tokensOut ?? "?"}`
                      : <span className="dim">—</span>
                    }
                  </td>
                  <td>
                    <span className="dim">
                      {run.filesTouched.length > 0 ? `${run.filesTouched.length}` : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
