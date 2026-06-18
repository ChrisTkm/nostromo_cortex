import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  BarChart,
  Button,
  FilterSelect,
  Metric,
  Status,
  type BarChartDatum,
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

type AgentRunRecord = {
  id: string;
  agentSlug: string;
  modelId?: string;
  startedAt: string;
  endedAt: string | null;
  durationMs?: number;
  taskCodes: string[];
  planCodes: string[];
  filesTouched: string[];
  commits: string[];
  tokensIn?: number;
  tokensOut?: number;
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

type RunDraft = {
  agentSlug: string;
  modelId: string;
  status: AgentRunRecord["status"];
  startedAt: string;
  endedAt: string;
  planCodes: string;
  taskCodes: string;
  filesTouched: string;
  commits: string;
  tokensIn: string;
  tokensOut: string;
  notes: string;
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

const RUN_TONE: Record<AgentRunRecord["status"], StatusTone> = {
  running: "in-progress",
  completed: "done",
  failed: "failed",
};

const RUN_LABEL: Record<AgentRunRecord["status"], string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
};

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
  const style = {
    "--ledger-agent-size": `${s}px`,
    "--ledger-agent-color": `hsl(${slugToHue(agent.slug)}, ${SATURATION}%, ${LIGHTNESS}%)`,
  } as CSSProperties;
  if (agent.iconUri) {
    return (
      <img
        src={agent.iconUri}
        alt={agent.name}
        className="ledger-agent-icon"
        style={style}
      />
    );
  }
  return (
    <span
      className="ledger-agent-icon ledger-agent-icon--fallback"
      style={style}
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

function isoToDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function getDurationMs(run: AgentRunRecord): number | null {
  if (typeof run.durationMs === "number") return run.durationMs;
  const started = new Date(run.startedAt).getTime();
  const ended = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  return Math.max(0, ended - started);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function isoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const keep = Math.max(4, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function joinLines(values: string[]): string {
  return values.join("\n");
}

function splitLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function draftFromRun(run: AgentRunRecord): RunDraft {
  return {
    agentSlug: run.agentSlug,
    modelId: run.modelId ?? "",
    status: run.status,
    startedAt: isoToDateTimeLocal(run.startedAt),
    endedAt: isoToDateTimeLocal(run.endedAt),
    planCodes: joinLines(run.planCodes),
    taskCodes: joinLines(run.taskCodes),
    filesTouched: joinLines(run.filesTouched),
    commits: joinLines(run.commits),
    tokensIn: typeof run.tokensIn === "number" ? String(run.tokensIn) : "",
    tokensOut: typeof run.tokensOut === "number" ? String(run.tokensOut) : "",
    notes: run.notes ?? "",
  };
}

function computeDailyCounts(
  runs: AgentRunRecord[],
  days: number,
): { date: string; count: number }[] {
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
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [chartDays, setChartDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

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
    return runs.filter((run) => {
      if (agentFilter !== "all" && run.agentSlug !== agentFilter) {
        return false;
      }
      if (planFilter !== "all" && !run.planCodes.includes(planFilter)) {
        return false;
      }
      return true;
    });
  }, [runs, agentFilter, planFilter]);

  const planOptions = useMemo(
    () =>
      [...new Set(runs.flatMap((run) => run.planCodes))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [runs],
  );

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(null);
    }
  }, [runs, selectedRunId]);

  const chartData = useMemo<BarChartDatum[]>(
    () =>
      computeDailyCounts(filteredRuns, chartDays).map((d) => ({
        label: d.date.slice(5),
        value: d.count,
        title: `${d.date}: ${d.count} runs`,
      })),
    [filteredRuns, chartDays],
  );

  const agentMap = useMemo(() => {
    const m = new Map<string, LedgerAgent>();
    for (const a of agents) m.set(a.slug, a);
    return m;
  }, [agents]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    vscode.postMessage({ type: "ledger:refresh" });
  }, []);

  const handleAgentFilter = useCallback((next: string) => {
    setAgentFilter(next);
    vscode.postMessage({
      type: "ledger:setFilter",
      agentSlug: next === "all" ? undefined : next,
    });
  }, []);

  const columns = useMemo<DataTableColumn<AgentRunRecord>[]>(
    () => [
      {
        key: "agent",
        label: "Agente",
        width: 180,
        sortable: true,
        sortValue: (r) =>
          (agentMap.get(r.agentSlug)?.name ?? r.agentSlug).toLowerCase(),
        render: (r) => {
          const agent = agentMap.get(r.agentSlug);
          return (
            <span className="agent-cell">
              {agent ? <AgentIcon agent={agent} /> : null}
              <span className="agent-slug">{agent?.name ?? r.agentSlug}</span>
            </span>
          );
        },
      },
      {
        key: "model",
        label: "Modelo",
        width: 140,
        sortable: true,
        sortValue: (r) => r.modelId ?? "",
        render: (r) =>
          r.modelId ? (
            <span className="codes-list" title={r.modelId}>
              {truncateMiddle(r.modelId, 22)}
            </span>
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "startedAt",
        label: "Inicio",
        width: 130,
        sortable: true,
        sortValue: (r) => new Date(r.startedAt).getTime(),
        render: (r) => isoToLocal(r.startedAt),
      },
      {
        key: "status",
        label: "Estado",
        width: 120,
        sortable: true,
        sortValue: (r) => r.status,
        render: (r) => (
          <Status tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Status>
        ),
      },
      {
        key: "duration",
        label: "Duración",
        width: 100,
        sortable: true,
        align: "right",
        sortValue: (r) => getDurationMs(r) ?? 0,
        render: (r) => formatDuration(getDurationMs(r)),
      },
      {
        key: "plans",
        label: "Planes",
        width: 170,
        sortable: true,
        sortValue: (r) => {
          const codes = r.planCodes;
          return Array.isArray(codes) ? codes.length : String(codes ?? "").length;
        },
        render: (r) =>
          r.planCodes.length > 0 ? (
            <span className="codes-list" title={r.planCodes.join(", ")}>
              {r.planCodes.join(", ")}
            </span>
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "tasks",
        label: "Tasks",
        width: 200,
        sortable: true,
        sortValue: (r) => {
          const codes = r.taskCodes;
          return Array.isArray(codes) ? codes.length : String(codes ?? "").length;
        },
        render: (r) =>
          r.taskCodes.length > 0 ? (
            <span className="codes-list">{r.taskCodes.join(", ")}</span>
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "tokens",
        label: "Tokens",
        width: 130,
        sortable: true,
        align: "right",
        sortValue: (r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
        render: (r) =>
          typeof r.tokensIn === "number" || typeof r.tokensOut === "number" ? (
            `${r.tokensIn ?? "?"} / ${r.tokensOut ?? "?"}`
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "files",
        label: "Archivos",
        width: 90,
        sortable: true,
        align: "right",
        sortValue: (r) => r.filesTouched.length,
        render: (r) =>
          r.filesTouched.length > 0 ? (
            String(r.filesTouched.length)
          ) : (
            <span className="dim">—</span>
          ),
      },
    ],
    [agentMap],
  );

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
        <Button intent="refresh" onClick={handleRefresh}>
          Reintentar
        </Button>
      </div>
    );
  }

  const header = (
    <Header
      name="CORTEX LEDGER"
      actions={
        <Button intent="refresh" onClick={handleRefresh} size="small">
          Actualizar
        </Button>
      }
    />
  );

  const secondBar = (
    <SecondBar
      filters={
        <>
          <FilterSelect
            onChange={(e) => handleAgentFilter(e.target.value)}
            value={agentFilter}
          >
            <option value="all">Todos los agentes</option>
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setPlanFilter(e.target.value)}
            value={planFilter}
          >
            <option value="all">Todos los planes</option>
            {planOptions.map((planCode) => (
              <option key={planCode} value={planCode}>
                {planCode}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setChartDays(Number(e.target.value))}
            value={chartDays}
          >
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={30}>30 días</option>
          </FilterSelect>
        </>
      }
    />
  );

  const banner = (
    <div className="ledger-chart">
      <div className="ledger-chart__title">Runs / día</div>
      <BarChart data={chartData} />
    </div>
  );

  const footer = (
    <Footer
      left={
        <div className="ledger-stats">
          <Metric label="Total">{runs.length}</Metric>
          <Metric label="Visibles">{filteredRuns.length}</Metric>
        </div>
      }
    />
  );

  const drawer = (
    selectedRun ? (
      <RunDetailDrawer
        agent={agentMap.get(selectedRun.agentSlug) ?? null}
        agents={agents}
        isOpen={Boolean(selectedRun)}
        onClose={() => setSelectedRunId(null)}
        run={selectedRun}
      />
    ) : null
  );

  return (
    <Module
      banner={banner}
      drawer={drawer}
      footer={footer}
      header={header}
      secondBar={secondBar}
    >
      <div className="table-section">
        <DataTable
          className="ledger-table"
          columns={columns}
          empty="Sin runs"
          getRowKey={(r) => r.id}
          onRowClick={(run) => setSelectedRunId(run.id)}
          rowClassName={(run) =>
            run.id === selectedRunId ? "ledger-row--selected" : undefined
          }
          rows={filteredRuns}
        />
      </div>
    </Module>
  );
}

function RunDetailDrawer({
  agent,
  agents,
  isOpen,
  onClose,
  run,
}: {
  agent: LedgerAgent | null;
  agents: LedgerAgent[];
  isOpen: boolean;
  onClose: () => void;
  run: AgentRunRecord;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<RunDraft>(() => draftFromRun(run));

  useEffect(() => {
    setDraft(draftFromRun(run));
    setIsEditing(false);
  }, [run]);

  function patchDraft(patch: Partial<RunDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function saveDraft() {
    const startedAt = localDateTimeToIso(draft.startedAt);
    const endedAt = localDateTimeToIso(draft.endedAt);
    vscode.postMessage({
      type: "ledger:updateRunReport",
      id: run.id,
      patch: {
        agent_slug: draft.agentSlug,
        model_id: draft.modelId,
        status: draft.status,
        ...(startedAt ? { started_at: startedAt } : {}),
        ended_at: endedAt,
        plan_codes: splitLines(draft.planCodes),
        task_codes: splitLines(draft.taskCodes),
        files_touched: splitLines(draft.filesTouched),
        commits: splitLines(draft.commits),
        tokens_in: optionalNumber(draft.tokensIn),
        tokens_out: optionalNumber(draft.tokensOut),
        notes: draft.notes,
      },
    });
    setIsEditing(false);
  }

  const actions = isEditing ? (
    <>
      <Button
        intent="action"
        onClick={saveDraft}
        size="small"
      >
        Guardar
      </Button>
    </>
  ) : (
    <Button intent="change" onClick={() => setIsEditing(true)} size="small">
      Editar
    </Button>
  );

  const header = (
    <>
      <div className="drawer-header__code">{run.id}</div>
      <h2 className="drawer-header__title">
        {agent?.name ?? run.agentSlug}
      </h2>
      <div className="drawer-header__status">
        {agent ? <AgentIcon agent={agent} size={22} /> : null}
        <Status tone={RUN_TONE[run.status]}>{RUN_LABEL[run.status]}</Status>
        <span className="drawer-inline-stat">
          <span className="drawer-inline-stat__label">Duración</span>
          <span className="drawer-inline-stat__value">
            {formatDuration(getDurationMs(run))}
          </span>
        </span>
      </div>
    </>
  );

  return (
    <DrawerShell actions={actions} header={header} isOpen={isOpen} onClose={onClose}>
      <div className="drawer-panel">
        <section className="drawer-section">
          <div className="drawer-section__label">Tiempo</div>
          {isEditing ? (
            <div className="ledger-detail-grid">
              <EditField label="Inicio">
                <input
                  className="ledger-input"
                  onChange={(event) => patchDraft({ startedAt: event.target.value })}
                  type="datetime-local"
                  value={draft.startedAt}
                />
              </EditField>
              <EditField label="Fin">
                <input
                  className="ledger-input"
                  onChange={(event) => patchDraft({ endedAt: event.target.value })}
                  type="datetime-local"
                  value={draft.endedAt}
                />
              </EditField>
            </div>
          ) : (
            <div className="ledger-detail-grid">
              <DetailField label="Inicio" value={isoToLocal(run.startedAt)} />
              <DetailField
                label="Fin"
                value={run.endedAt ? isoToLocal(run.endedAt) : "En curso"}
              />
            </div>
          )}
        </section>

        <section className="drawer-section">
          <div className="drawer-section__label">Identidad</div>
          {isEditing ? (
            <div className="ledger-detail-grid">
              <EditField label="Agente">
                <select
                  className="ledger-input"
                  onChange={(event) => patchDraft({ agentSlug: event.target.value })}
                  value={draft.agentSlug}
                >
                  {agents.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Modelo">
                <input
                  className="ledger-input"
                  onChange={(event) => patchDraft({ modelId: event.target.value })}
                  value={draft.modelId}
                />
              </EditField>
              <EditField label="Estado">
                <select
                  className="ledger-input"
                  onChange={(event) =>
                    patchDraft({
                      status: event.target.value as AgentRunRecord["status"],
                    })
                  }
                  value={draft.status}
                >
                  <option value="running">Running</option>
                  <option value="completed">Done</option>
                  <option value="failed">Failed</option>
                </select>
              </EditField>
            </div>
          ) : (
            <div className="ledger-detail-grid">
              <DetailField label="Agente" value={run.agentSlug} />
              <DetailField label="Modelo" value={run.modelId ?? "—"} />
            </div>
          )}
        </section>

        {isEditing ? (
          <>
            <EditTextarea
              label="Planes"
              onChange={(value) => patchDraft({ planCodes: value })}
              value={draft.planCodes}
            />
            <EditTextarea
              label="Tasks"
              onChange={(value) => patchDraft({ taskCodes: value })}
              value={draft.taskCodes}
            />
            <EditTextarea
              label="Archivos"
              onChange={(value) => patchDraft({ filesTouched: value })}
              value={draft.filesTouched}
            />
            <EditTextarea
              label="Commits"
              onChange={(value) => patchDraft({ commits: value })}
              value={draft.commits}
            />
          </>
        ) : (
          <>
            <CodeList label="Planes" values={run.planCodes} />
            <CodeList label="Tasks" values={run.taskCodes} />
            <CodeList label="Archivos" values={run.filesTouched} />
            <CodeList label="Commits" values={run.commits} />
          </>
        )}

        <section className="drawer-section">
          <div className="drawer-section__label">Tokens</div>
          {isEditing ? (
            <div className="ledger-detail-grid">
              <EditField label="Tokens in">
                <input
                  className="ledger-input"
                  min={0}
                  onChange={(event) => patchDraft({ tokensIn: event.target.value })}
                  type="number"
                  value={draft.tokensIn}
                />
              </EditField>
              <EditField label="Tokens out">
                <input
                  className="ledger-input"
                  min={0}
                  onChange={(event) => patchDraft({ tokensOut: event.target.value })}
                  type="number"
                  value={draft.tokensOut}
                />
              </EditField>
            </div>
          ) : (
            <div className="ledger-detail-grid">
              <DetailField
                label="Tokens in"
                value={typeof run.tokensIn === "number" ? String(run.tokensIn) : "—"}
              />
              <DetailField
                label="Tokens out"
                value={
                  typeof run.tokensOut === "number" ? String(run.tokensOut) : "—"
                }
              />
            </div>
          )}
        </section>

        <section className="drawer-section">
          <div className="drawer-section__label">Notas</div>
          {isEditing ? (
            <textarea
              className="ledger-notes-editor"
              onChange={(event) => patchDraft({ notes: event.target.value })}
              rows={8}
              value={draft.notes}
            />
          ) : (
            <div className="drawer-section__text">
              {run.notes?.trim() || "Sin notas."}
            </div>
          )}
        </section>
      </div>
    </DrawerShell>
  );
}

function EditField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="ledger-edit-field">
      <span className="ledger-detail-field__label">{label}</span>
      {children}
    </label>
  );
}

function EditTextarea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <section className="drawer-section">
      <div className="drawer-section__label">{label}</div>
      <textarea
        className="ledger-notes-editor ledger-notes-editor--compact"
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        value={value}
      />
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="ledger-detail-field">
      <span className="ledger-detail-field__label">{label}</span>
      <span className="ledger-detail-field__value">{value}</span>
    </div>
  );
}

function CodeList({ label, values }: { label: string; values: string[] }) {
  return (
    <section className="drawer-section">
      <div className="drawer-section__label">{label}</div>
      {values.length > 0 ? (
        <div className="drawer-list">
          {values.map((value) => (
            <span className="drawer-badge" key={value}>
              {value}
            </span>
          ))}
        </div>
      ) : (
        <div className="drawer-empty">—</div>
      )}
    </section>
  );
}
