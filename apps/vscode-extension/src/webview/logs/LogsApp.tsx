import type { LogRecord } from "../../logs/normalize";
import type { RunGroup } from "../../logs/runModel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildProcessRows,
  countLogsByLevel,
  filterLogsByPeriod,
  formatDuration,
  formatLiveSince,
  formatRelativeTime,
  runStatusClass,
  runStatusIcon,
  type PeriodFilter,
  type ProcessRow,
} from "./state";
import { RunDrawer } from "./components/RunDrawer";
import { Button, FilterSelect, Metric, Search } from "../components/atoms";
import { Footer, Header, SecondBar } from "../components/molecules";
import { Module } from "../components/organisms";

type LogsMessage =
  | {
      type: "logs:list";
      logs: LogRecord[];
      sources?: string[];
      hasMore: boolean;
    }
  | { type: "logs:liveStatus"; live: boolean; refreshAt: string };

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

export function LogsApp() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [tz, setTz] = useState<string>("UTC");
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [selectedRunIndex, setSelectedRunIndex] = useState(0);
  const [live, setLive] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const liveTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent<LogsMessage>) {
      const message = event.data;
      if (message?.type === "logs:list" && Array.isArray(message.logs)) {
        setLogs(message.logs);
        if (Array.isArray(message.sources)) setSources(message.sources);
        return;
      }
      if (message?.type === "logs:liveStatus") {
        setLive(Boolean(message.live));
        setLastRefreshAt(message.refreshAt);
      }
    }
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!live) {
      if (liveTickRef.current) clearInterval(liveTickRef.current);
      liveTickRef.current = null;
      return;
    }
    liveTickRef.current = setInterval(() => {
      setLastRefreshAt((c) => (c ? c.slice(0) : c));
    }, 5000);
    return () => {
      if (liveTickRef.current) clearInterval(liveTickRef.current);
      liveTickRef.current = null;
    };
  }, [live]);

  const deferredSearch = search.trim().toLowerCase();

  const baseFilteredLogs = useMemo(() => {
    const periodFiltered =
      period !== "all" ? filterLogsByPeriod(logs, period) : logs;
    if (!deferredSearch) return periodFiltered;
    return periodFiltered.filter((entry) => {
      const haystack = [
        entry.summary,
        entry.message,
        entry.process,
        entry.event,
        entry.executionId,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(deferredSearch);
    });
  }, [logs, period, deferredSearch]);

  const filteredLogs = useMemo(
    () =>
      level === "all"
        ? baseFilteredLogs
        : baseFilteredLogs.filter((e) => e.level === level),
    [baseFilteredLogs, level],
  );

  const levelCounts = useMemo(
    () => countLogsByLevel(baseFilteredLogs),
    [baseFilteredLogs],
  );
  const processRows = useMemo(
    () => buildProcessRows(filteredLogs),
    [filteredLogs],
  );

  const currentProcess: ProcessRow | null = useMemo(() => {
    if (processRows.length === 0) return null;
    return (
      processRows.find((p) => p.process === selectedProcess) ?? processRows[0]
    );
  }, [processRows, selectedProcess]);

  const currentRuns: RunGroup[] = currentProcess?.runs ?? [];
  const currentRun: RunGroup | null =
    currentRuns[selectedRunIndex] ?? currentRuns[0] ?? null;

  useEffect(() => {
    if (selectedRunIndex >= currentRuns.length) {
      setSelectedRunIndex(0);
    }
  }, [currentRuns.length, selectedRunIndex]);

  function pickProcess(name: string) {
    setSelectedProcess(name);
    setSelectedRunIndex(0);
  }

  function processStatus(row: ProcessRow): "ok" | "err" | "open" {
    if (row.errorCount > 0) return "err";
    if (row.runs.some((r) => r.status === "abierta")) return "open";
    return "ok";
  }

  function clearFilters() {
    setSearch("");
    setLevel("all");
    setPeriod("all");
  }

  const folderLabel =
    sources.length > 0 ? sources[0] : "Sin carpeta configurada";

  const header = (
    <Header
      external={sources.length > 0}
      title="CORTEX LOGS"
      route={
        <span className="logs-head__folder" title={sources.join(", ")}>
          {folderLabel}
        </span>
      }
      actions={
        <>
          <Button
            intent="change"
            onClick={() => vscode.postMessage({ type: "logs:selectFolder" })}
            size="small"
          >
            Carpeta
          </Button>
          <Button
            className={live ? "is-active logs-live-button" : "logs-live-button"}
            intent="change"
            onClick={() => {
              const next = !live;
              setLive(next);
              vscode.postMessage({ type: "logs:toggleLive", live: next });
            }}
            size="small"
          >
            {live ? "LIVE" : "Live"}
            {live && lastRefreshAt
              ? ` · ${formatLiveSince(lastRefreshAt)}`
              : ""}
          </Button>
          <Button
            intent="refresh"
            onClick={() => vscode.postMessage({ type: "logs:refresh" })}
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
      search={
        <Search
          className="logs-search"
          onChange={setSearch}
          placeholder="Search messages…"
          value={search}
        />
      }
      filters={
        <div className="logs-filterbar">
          <FilterSelect
            onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
            value={period}
          >
            <option value="month">Month</option>
            <option value="semester">Semester</option>
            <option value="year">Year</option>
            <option value="all">All time</option>
          </FilterSelect>
          <FilterSelect
            onChange={(e) => setTz(e.target.value)}
            title="Zona horaria de visualización"
            value={tz}
          >
            <option value="UTC">UTC (log)</option>
            <option value="America/Santiago">Chile</option>
            <option value="America/New_York">New York</option>
            <option value="local">Local</option>
          </FilterSelect>
          <div className="logs-levelchips">
            {(["ERROR", "WARN", "INFO"] as const).map((lvl) => {
              const active = level === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  aria-pressed={active}
                  className={`logs-chip logs-chip--${lvl.toLowerCase()}${active ? " logs-chip--active" : ""}`}
                  onClick={() => setLevel(active ? "all" : lvl)}
                >
                  {lvl}
                  <span className="logs-chip__n">{levelCounts[lvl] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
      }
    />
  );

  const footer = (
    <Footer
      left={
        <div className="logs-stats">
          <Metric label="Total">{logs.length}</Metric>
          <Metric label="Visibles">{filteredLogs.length}</Metric>
          <Metric label="Procesos">{processRows.length}</Metric>
          {live ? <Metric label="Live">On</Metric> : null}
        </div>
      }
    />
  );

  return (
    <Module
      className="logs-module"
      footer={footer}
      header={header}
      secondBar={secondBar}
    >
      {logs.length === 0 ? (
        <div className="logs-empty">
          <div className="logs-eyebrow">No logs yet</div>
          <h2 className="logs-empty__title">Configurá una carpeta de logs</h2>
          <p className="logs-empty__text">
            Cortex lee archivos (.jsonl / .log) de una carpeta externa,
            read-only. Sin MongoDB.
          </p>
          <Button
            intent="action"
            onClick={() => vscode.postMessage({ type: "logs:selectFolder" })}
          >
            Carpeta
          </Button>
          <p className="logs-empty__hint">
            Actual: <code>{folderLabel}</code>
          </p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="logs-empty logs-empty--filtered">
          <div className="logs-eyebrow">No visible logs</div>
          <h2 className="logs-empty__title">Los filtros no dejan resultados visibles</h2>
          <p className="logs-empty__text">
            Hay {logs.length} eventos cargados desde la carpeta seleccionada,
            pero el periodo, nivel o búsqueda actual los oculta.
          </p>
          <Button intent="change" onClick={clearFilters}>
            Mostrar todo
          </Button>
          <p className="logs-empty__hint">
            Actual: <code>{folderLabel}</code>
          </p>
        </div>
      ) : (
        <div className="logs-master">
          {/* LEFT: processes */}
          <aside className="logs-proclist">
            <div className="logs-eyebrow">Processes</div>
            {processRows.length === 0 ? (
              <div className="logs-proclist__empty">No processes match.</div>
            ) : (
              processRows.map((row) => {
                const st = processStatus(row);
                const selected = currentProcess?.process === row.process;
                return (
                  <button
                    key={row.process}
                    type="button"
                    className={`logs-proc${selected ? " logs-proc--sel" : ""}`}
                    onClick={() => pickProcess(row.process)}
                  >
                    <span className={`logs-dot logs-dot--${st}`} />
                    <span className="logs-proc__body">
                      <span className="logs-proc__name">{row.process}</span>
                      <span className="logs-proc__sub">
                        {row.runCount} runs ·{" "}
                        {formatRelativeTime(row.lastRunAt)}
                        {row.errorCount > 0 ? ` · ${row.errorCount} err` : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </aside>

          {/* RIGHT: runs + detail */}
          <section className="logs-pane">
            {!currentProcess ? (
              <div className="logs-pane__empty">Seleccioná un proceso.</div>
            ) : (
              <>
                <h2 className="logs-pane__title">
                  {currentProcess.process} — corridas
                </h2>
                <table className="logs-runs">
                  <thead>
                    <tr>
                      <th>Inicio</th>
                      <th>Duración</th>
                      <th>Estado</th>
                      <th className="num">Filas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRuns.map((run, i) => {
                      const sel = i === selectedRunIndex;
                      const rows = run.rowsInserted ?? run.rowsRead;
                      return (
                        <tr
                          key={i}
                          className={`logs-runs__row${sel ? " logs-runs__row--sel" : ""}`}
                          onClick={() => setSelectedRunIndex(i)}
                        >
                          <td>{formatStart(run.startedAt, tz)}</td>
                          <td>{formatDuration(run.durationMs)}</td>
                          <td>
                            <span
                              className={`logs-run-status ${runStatusClass(run.status)}`}
                            >
                              {runStatusIcon(run.status)}
                            </span>{" "}
                            {run.status}
                          </td>
                          <td className="num">{rows ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="logs-pane__detail">
                  {currentRun ? (
                    <RunDrawer run={currentRun} tz={tz} />
                  ) : (
                    <div className="logs-pane__empty">
                      Seleccioná una corrida.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </Module>
  );
}

function formatStart(value: string, tz: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(tz === "local" ? {} : { timeZone: tz }),
  });
}
