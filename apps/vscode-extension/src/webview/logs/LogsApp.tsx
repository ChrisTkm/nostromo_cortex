import type { LogRecord } from "../../logs/normalize";
import type { RunGroup } from "../../logs/runModel";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  buildExecutionGroups,
  buildLogJson,
  buildLogKey,
  buildLogsCsvExport,
  buildLogsJsonExport,
  buildProcessRows,
  coerceLogFilterValue,
  countLogsByLevel,
  filterLogsByPeriod,
  filterLogsByTime,
  formatDuration,
  formatLiveSince,
  formatRelativeTime,
  getLogsEmptyState,
  getOldestLogTimestamp,
  LOGS_PYTHON_SNIPPET,
  mergeLogPages,
  reconcileSelectedLogKey,
  runStatusClass,
  runStatusIcon,
  shouldShowFilter,
  sortLogLevelKeys,
  sparklinePath,
  type PeriodFilter,
  type ProcessRow,
  type ViewMode,
} from "./state";
import { RunDrawer } from "./components/RunDrawer";
import { highlightLogText } from "./highlightText";

type LogsMessage =
  | {
      type: "logs:list";
      logs: LogRecord[];
      autoRefreshSeconds: number;
      hasMore: boolean;
    }
  | {
      type: "logs:append";
      logs: LogRecord[];
      hasMore: boolean;
    }
  | {
      type: "logs:liveStatus";
      live: boolean;
      refreshAt: string;
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

export function LogsApp() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [folder, setFolder] = useState("all");
  const [tag, setTag] = useState("all");
  const [process, setProcess] = useState("all");
  const [timeRange, setTimeRange] = useState<"all" | "1h" | "24h" | "7d">("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("historico");
  const [period, setPeriod] = useState<PeriodFilter>("month");
  const [expandedProcess, setExpandedProcess] = useState<Set<string>>(() => new Set());
  const [selectedRun, setSelectedRun] = useState<RunGroup | null>(null);
  const [live, setLive] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const liveTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<LogsMessage>) {
      const message = event.data;
      if (message?.type === "logs:list" && Array.isArray(message.logs)) {
        setLogs(message.logs);
        setHasMore(Boolean(message.hasMore));
        setLoadingOlder(false);
        setLevel((current) =>
          coerceLogFilterValue(current, message.logs.map((entry) => entry.level)),
        );
        setSource((current) =>
          coerceLogFilterValue(current, message.logs.map((entry) => entry.source)),
        );
        setFolder((current) =>
          coerceLogFilterValue(current, message.logs.map((entry) => entry.folder)),
        );
        setTag((current) =>
          coerceLogFilterValue(current, message.logs.map((entry) => entry.tag ?? entry.event ?? "untagged")),
        );
        setProcess((current) =>
          coerceLogFilterValue(current, message.logs.map((entry) => entry.process ?? "unknown")),
        );
        setSelectedKey((current) => reconcileSelectedLogKey(current, message.logs));
        setDetailOpen((current) => (message.logs.length === 0 ? false : current));
        return;
      }
      if (message?.type === "logs:append" && Array.isArray(message.logs)) {
        setLogs((current) => mergeLogPages(current, message.logs));
        setHasMore(Boolean(message.hasMore));
        setLoadingOlder(false);
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

  const processes = useMemo(
    () => ["all", ...new Set(logs.map((entry) => entry.process ?? "unknown"))],
    [logs],
  );

  const baseFilteredLogs = useMemo(() => {
    const timeFiltered = filterLogsByTime(logs, timeRange);
    const periodFiltered = viewMode === "historico" && period !== "all"
      ? filterLogsByPeriod(timeFiltered, period)
      : timeFiltered;
    return periodFiltered.filter((entry) => {
      if (source !== "all" && entry.source !== source) return false;
      if (folder !== "all" && entry.folder !== folder) return false;
      if (tag !== "all" && (entry.tag ?? entry.event ?? "untagged") !== tag) return false;
      if (process !== "all" && (entry.process ?? "unknown") !== process) return false;
      if (!deferredSearch) return true;
      const haystack = [
        entry.summary,
        entry.message,
        entry.source,
        entry.folder,
        entry.process,
        entry.loggerName,
        entry.event,
        entry.executionId,
        entry.tag,
        entry.className,
        entry.methodName,
        entry.title,
        ...entry.details.map((detail) => `${detail.label} ${detail.value}`),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(deferredSearch);
    });
  }, [deferredSearch, folder, logs, period, process, source, tag, timeRange, viewMode]);

  const filteredLogs = useMemo(() => {
    if (level === "all") return baseFilteredLogs;
    return baseFilteredLogs.filter((entry) => entry.level === level);
  }, [baseFilteredLogs, level]);

  const levelCounts = useMemo(() => countLogsByLevel(baseFilteredLogs), [baseFilteredLogs]);
  const orderedLevelKeys = useMemo(() => sortLogLevelKeys(Object.keys(levelCounts)), [levelCounts]);

  const processRows = useMemo(() => buildProcessRows(filteredLogs), [filteredLogs]);

  const hasActiveFilters =
    Boolean(search.trim()) ||
    level !== "all" ||
    source !== "all" ||
    folder !== "all" ||
    tag !== "all" ||
    process !== "all" ||
    timeRange !== "all";

  const emptyState = getLogsEmptyState(logs.length, filteredLogs.length, hasActiveFilters);
  const groupedLogs = useMemo(() => buildExecutionGroups(filteredLogs), [filteredLogs]);

  const selectedLog = useMemo(() => {
    if (!selectedKey) return filteredLogs[0] ?? null;
    return (
      filteredLogs.find((entry) => buildLogKey(entry) === selectedKey) ??
      filteredLogs[0] ??
      null
    );
  }, [filteredLogs, selectedKey]);

  function handleSelect(entry: LogRecord) {
    setSelectedKey(buildLogKey(entry));
    setDetailOpen(true);
  }

  function clearFilters() {
    setSearch("");
    setLevel("all");
    setSource("all");
    setFolder("all");
    setTag("all");
    setProcess("all");
    setTimeRange("all");
    setPeriod("all");
  }

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!live) {
      if (liveTickRef.current) clearInterval(liveTickRef.current);
      liveTickRef.current = null;
      return;
    }
    liveTickRef.current = setInterval(() => {
      setLastRefreshAt((current) => current ? current.slice(0) : current);
    }, 5000);
    return () => {
      if (liveTickRef.current) clearInterval(liveTickRef.current);
      liveTickRef.current = null;
    };
  }, [live]);

  function copyValue(value: string, key: string) {
    if (!value) return;
    vscode.postMessage({ type: "logs:copy", value });
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    setCopiedKey(key);
    copiedTimeoutRef.current = setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
      copiedTimeoutRef.current = null;
    }, 1500);
  }

  function exportLogs(format: "csv" | "json") {
    if (filteredLogs.length === 0) return;
    const content =
      format === "csv" ? buildLogsCsvExport(filteredLogs) : buildLogsJsonExport(filteredLogs);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const defaultFilename = `cortex-logs-${timestamp}.${format}`;
    vscode.postMessage({ type: "logs:export", format, content, defaultFilename });
  }

  function loadOlder() {
    if (loadingOlder || !hasMore) return;
    const cursor = getOldestLogTimestamp(logs);
    if (!cursor) return;
    setLoadingOlder(true);
    vscode.postMessage({ type: "logs:loadOlder", beforeTimestamp: cursor });
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function handleRunClick(run: RunGroup) {
    setSelectedRun(run);
  }

  function handleDrawerClose() {
    setSelectedRun(null);
  }

  function toggleProcess(processName: string) {
    setExpandedProcess((current) => {
      const next = new Set(current);
      if (next.has(processName)) next.delete(processName);
      else next.add(processName);
      return next;
    });
  }

  return (
    <div
      className={`logs-app${selectedRun || (detailOpen && selectedLog && viewMode === "eventos") ? "" : " logs-app--list-only"}`}
    >
      <section className="logs-list-panel">
        {/* Toolbar */}
        <header className="logs-toolbar">
          <div>
            <div className="logs-toolbar__eyebrow">Sources</div>
            <h1 className="logs-toolbar__title">Cortex Logs</h1>
          </div>
          <div className="logs-toolbar__actions">
            <span className="logs-toolbar__count">
              {filteredLogs.length} events
            </span>
            {live ? (
              <span className="logs-live-badge">
                <span className="logs-live-badge__dot" />
                LIVE
                {lastRefreshAt ? ` · ${formatLiveSince(lastRefreshAt)}` : ""}
              </span>
            ) : null}
            <button
              className={`logs-button${live ? " logs-button--active" : ""}`}
              onClick={() => {
                const next = !live;
                setLive(next);
                vscode.postMessage({ type: "logs:toggleLive", live: next });
              }}
              type="button"
            >
              {live ? "LIVE ON" : "LIVE"}
            </button>
            <button
              className="logs-button"
              onClick={() => vscode.postMessage({ type: "logs:refresh" })}
              type="button"
            >
              Refresh
            </button>
            <button
              className="logs-button"
              onClick={() => exportLogs("csv")}
              disabled={filteredLogs.length === 0}
              type="button"
            >
              Export CSV
            </button>
            <button
              className="logs-button"
              onClick={() => exportLogs("json")}
              disabled={filteredLogs.length === 0}
              type="button"
            >
              Export JSON
            </button>
          </div>
        </header>

        {/* View toggle */}
        <div className="logs-view-toggle">
          <button
            type="button"
            className={`logs-view-toggle__btn${viewMode === "historico" ? " logs-view-toggle__btn--active" : ""}`}
            onClick={() => setViewMode("historico")}
          >
            Histórico
          </button>
          <button
            type="button"
            className={`logs-view-toggle__btn${viewMode === "eventos" ? " logs-view-toggle__btn--active" : ""}`}
            onClick={() => setViewMode("eventos")}
          >
            Eventos
          </button>
        </div>

        {/* Level counters */}
        {viewMode === "eventos" && orderedLevelKeys.length > 0 ? (
          <div className="logs-counters">
            {orderedLevelKeys.map((lvl) => {
              const active = level === lvl;
              const count = levelCounts[lvl] ?? 0;
              return (
                <button
                  key={lvl}
                  type="button"
                  className={`logs-counter-chip${active ? " logs-counter-chip--active" : ""}`}
                  onClick={() => setLevel(active ? "all" : lvl)}
                  aria-pressed={active}
                >
                  <span className={`log-pill log-pill--${lvl.toLowerCase()}`}>{lvl}</span>
                  <span className="logs-counter-chip__count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {viewMode === "historico" ? (
          <div className="logs-counters">
            {(["ERROR", "WARN", "INFO"] as const).map((lvl) => {
              const count = levelCounts[lvl] ?? 0;
              const active = level === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  className={`logs-counter-chip${active ? " logs-counter-chip--active" : ""}`}
                  onClick={() => setLevel(active ? "all" : lvl)}
                  aria-pressed={active}
                >
                  <span className={`log-pill log-pill--${lvl.toLowerCase()}`}>{lvl}</span>
                  <span className="logs-counter-chip__count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Filters row */}
        <div className="logs-filters">
          <input
            className="logs-input logs-filters__search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search..."
            type="search"
            value={search}
          />
          <div className="logs-filters__time-row">
            {(["1h", "24h", "7d"] as const).map((range) => {
              const label = range === "1h" ? "Last hour" : range === "24h" ? "Last 24h" : "Last 7d";
              const active = timeRange === range;
              return (
                <button
                  key={range}
                  type="button"
                  className={`logs-time-chip${active ? " logs-time-chip--active" : ""}`}
                  onClick={() => setTimeRange(active ? "all" : range)}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}

            {/* Period filter (only in historico view) */}
            {viewMode === "historico" && (
              <>
                <span className="logs-filters__separator" />
                {(["month", "semester", "year"] as PeriodFilter[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`logs-time-chip${period === p ? " logs-time-chip--active" : ""}`}
                    onClick={() => setPeriod(p)}
                    aria-pressed={period === p}
                  >
                    {p === "month" ? "Month" : p === "semester" ? "Semester" : "Year"}
                  </button>
                ))}
              </>
            )}
          </div>
          {shouldShowFilter(processes) ? (
            <select className="logs-input" onChange={(event) => setProcess(event.target.value)} value={process}>
              {processes.map((option) => (
                <option key={option} value={option}>{option === "all" ? "All processes" : option}</option>
              ))}
            </select>
          ) : null}
        </div>

        {/* Main content */}
        <div className="logs-list">
          {viewMode === "historico" ? (
            logs.length === 0 ? (
              <div className="logs-empty-state logs-empty-state--onboarding">
                <div className="logs-toolbar__eyebrow">No logs yet</div>
                <h2 className="logs-empty-state__title">Configure a log source</h2>
                <p className="logs-empty-state__text">
                  Set <code>cortex.logsSources</code> in settings to a folder
                  containing .jsonl files. Cortex reads logs from an external
                  repository — no MongoDB required.
                </p>
              </div>
            ) : processRows.length === 0 ? (
              <div className="logs-empty-state">
                <div className="logs-toolbar__eyebrow">No matches</div>
                <h2 className="logs-empty-state__title">No processes match the current filters.</h2>
                {hasActiveFilters && (
                  <button className="logs-button" onClick={clearFilters} type="button">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <table className="logs-process-table">
                <thead>
                  <tr className="logs-process-table__header-row">
                    <th className="logs-process-table__th">Process</th>
                    <th className="logs-process-table__th logs-process-table__th--num">Runs</th>
                    <th className="logs-process-table__th">Last run</th>
                    <th className="logs-process-table__th">Duration</th>
                    <th className="logs-process-table__th logs-process-table__th--num">Errors</th>
                    <th className="logs-process-table__th logs-process-table__th--sparkline">Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {processRows.map((row: ProcessRow) => {
                    const isExpanded = expandedProcess.has(row.process);
                    return (
                      <tr key={row.process} className="logs-process-table__group">
                        <td colSpan={6} className="logs-process-table__group-cell">
                          <div className="logs-process-table__process-row">
                            <button
                              type="button"
                              className="logs-process-table__process-header"
                              onClick={() => toggleProcess(row.process)}
                            >
                              <span className="logs-process-table__chevron">
                                {isExpanded ? "v" : ">"}
                              </span>
                              <span className="logs-process-table__process-name">{row.process}</span>
                              <span className="logs-process-table__cell logs-process-table__cell--num">{row.runCount}</span>
                              <span className="logs-process-table__cell logs-process-table__cell--time">
                                {formatRelativeTime(row.lastRunAt)}
                              </span>
                              <span className="logs-process-table__cell logs-process-table__cell--duration">
                                {formatDuration(row.lastDurationMs)} / {formatDuration(row.avgDurationMs)}
                              </span>
                              <span className="logs-process-table__cell logs-process-table__cell--num">
                                {row.errorCount > 0 ? (
                                  <span className="logs-badge logs-badge--error">{row.errorCount}</span>
                                ) : (
                                  <span className="logs-badge logs-badge--ok">0</span>
                                )}
                              </span>
                              <span className="logs-process-table__cell logs-process-table__cell--sparkline">
                                <svg width={80} height={24} className="logs-sparkline">
                                  <path
                                    d={sparklinePath(row.activityBuckets)}
                                    fill="none"
                                    stroke="var(--vscode-focusBorder)"
                                    strokeWidth={1.5}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </span>
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="logs-process-table__runs">
                              {row.runs.map((run, ri) => (
                                <button
                                  key={ri}
                                  type="button"
                                  className="logs-process-table__run"
                                  onClick={() => handleRunClick(run)}
                                >
                                  <span className={`logs-run-status ${runStatusClass(run.status)}`}>
                                    {runStatusIcon(run.status)}
                                  </span>
                                  <span className="logs-process-table__run-time">
                                    {formatRelativeTime(run.startedAt)}
                                  </span>
                                  <span className="logs-process-table__run-duration">
                                    {formatDuration(run.durationMs)}
                                  </span>
                                  {run.inferred && <span className="log-chip">inferred</span>}
                                  {run.sinMedicion && <span className="log-chip">sin medición</span>}
                                  {run.rowsRead !== undefined || run.rowsInserted !== undefined ? (
                                    <span className="log-chip">
                                      R{run.rowsRead ?? "–"} I{run.rowsInserted ?? "–"}
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : viewMode === "eventos" ? (
            emptyState === "empty" ? (
              <div className="logs-empty-state logs-empty-state--onboarding">
                <div className="logs-toolbar__eyebrow">No logs yet</div>
                <h2 className="logs-empty-state__title">Start emitting logs to Cortex</h2>
                <p className="logs-empty-state__text">
                  Cortex Logs reads from your MongoDB <code>logs</code> collection.
                  Emit one document per event following the Cortex log contract.
                </p>
                <pre className="logs-empty-state__snippet"><code>{LOGS_PYTHON_SNIPPET}</code></pre>
                <div className="logs-empty-state__actions">
                  <button
                    type="button"
                    className="logs-button logs-button--primary"
                    onClick={() => copyValue(LOGS_PYTHON_SNIPPET, "snippet")}
                  >
                    {copiedKey === "snippet" ? "Copied" : "Copy snippet"}
                  </button>
                  <button
                    type="button"
                    className="logs-button"
                    onClick={() => vscode.postMessage({ type: "logs:openContract" })}
                  >
                    View log contract
                  </button>
                  <button
                    type="button"
                    className="logs-button"
                    onClick={() => vscode.postMessage({ type: "logs:refresh" })}
                  >
                    Refresh
                  </button>
                </div>
              </div>
            ) : emptyState === "filtered" ? (
              <div className="logs-empty-state">
                <div className="logs-toolbar__eyebrow">No matches</div>
                <h2 className="logs-empty-state__title">No logs match the current filters.</h2>
                {hasActiveFilters && (
                  <button className="logs-button" onClick={clearFilters} type="button">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              groupedLogs.map((group) => (
                <section
                  className={`logs-execution-group${group.isUngrouped ? " logs-execution-group--ungrouped" : ""}${group.kind === "process" ? " logs-execution-group--process" : ""}`}
                  key={group.id}
                >
                  <button
                    className="logs-execution-group__header"
                    onClick={() => toggleGroup(group.id)}
                    type="button"
                  >
                    <span className="logs-execution-group__chevron">
                      {collapsedGroups.has(group.id) ? ">" : "v"}
                    </span>
                    <span className={`log-pill log-pill--${group.dominantTag.toLowerCase()}`}>
                      {group.dominantTag}
                    </span>
                    {group.kind === "process" ? (
                      <>
                        <span className="logs-execution-group__title">{group.label}</span>
                        <span className="logs-execution-group__time">
                          {formatTime(group.beginTimestamp)} &rarr;{" "}
                          {formatTime(group.endTimestamp ?? group.beginTimestamp)}
                        </span>
                        <span className="log-chip">{group.logs.length} logs</span>
                      </>
                    ) : (
                      <>
                        <span className="logs-execution-group__title">{group.classMethod}</span>
                        <span className="logs-execution-group__time">
                          {formatTimestamp(group.beginTimestamp)}
                        </span>
                        {group.endTimestamp ? (
                          <span className="log-chip">END {formatTime(group.endTimestamp)}</span>
                        ) : (
                          <span className="log-chip">open</span>
                        )}
                        {typeof group.durationMs === "number" ? (
                          <span className="log-chip">{formatDuration(group.durationMs)}</span>
                        ) : null}
                        <span className="log-chip">{group.logs.length} logs</span>
                        <span className="logs-execution-group__id">{group.label}</span>
                      </>
                    )}
                  </button>
                  <div
                    className="logs-day-group__items"
                    hidden={collapsedGroups.has(group.id)}
                  >
                    {group.runs
                      ? group.runs.map((run) => {
                          const runKey = `${group.id}::${run.id}`;
                          return (
                            <div className="logs-process-run" key={runKey}>
                              <button
                                className="logs-process-run__header"
                                onClick={() => toggleGroup(runKey)}
                                type="button"
                              >
                                <span className="logs-execution-group__chevron">
                                  {collapsedGroups.has(runKey) ? ">" : "v"}
                                </span>
                                <span className={`log-pill log-pill--${run.dominantTag.toLowerCase()}`}>
                                  {run.dominantTag}
                                </span>
                                <span className="logs-process-run__label">{run.label}</span>
                                <span className="logs-execution-group__time">
                                  {formatTime(run.beginTimestamp)} &rarr;{" "}
                                  {formatTime(run.endTimestamp ?? run.beginTimestamp)}
                                </span>
                                {typeof run.durationMs === "number" ? (
                                  <span className="log-chip">{formatDuration(run.durationMs)}</span>
                                ) : null}
                                <span className="log-chip">{run.logs.length} logs</span>
                              </button>
                              <div
                                className="logs-process-run__logs"
                                hidden={collapsedGroups.has(runKey)}
                              >
                                {run.logs.map((entry) => {
                                  const isSelected = selectedLog
                                    ? buildLogKey(selectedLog) === buildLogKey(entry)
                                    : false;
                                  return (
                                    <button
                                      className={`log-row${isSelected ? " log-row--selected" : ""}`}
                                      key={buildLogKey(entry)}
                                      onClick={() => handleSelect(entry)}
                                      type="button"
                                    >
                                      <div className="log-row__top">
                                        <span className={`log-pill log-pill--${entry.level.toLowerCase()}`}>
                                          {entry.level}
                                        </span>
                                        <span className="log-row__time">
                                          {formatTime(entry.timestamp)}
                                        </span>
                                        <span className="log-row__source">
                                          {highlightLogText(entry.source, deferredSearch)}
                                        </span>
                                      </div>
                                      <div className="log-row__summary">
                                        {highlightLogText(entry.summary, deferredSearch)}
                                      </div>
                                      <div className="log-row__meta">
                                        {entry.executionId ? (
                                          <span className="log-chip">{entry.executionId}</span>
                                        ) : null}
                                        {entry.tag ? <span className="log-chip">{entry.tag}</span> : null}
                                        <span className="log-chip">{entry.folder}</span>
                                        {entry.process ? (
                                          <span className="log-chip">{entry.process}</span>
                                        ) : null}
                                        {entry.event ? (
                                          <span className="log-chip">{entry.event}</span>
                                        ) : null}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      : group.logs.map((entry) => {
                          const isSelected = selectedLog
                            ? buildLogKey(selectedLog) === buildLogKey(entry)
                            : false;
                          return (
                            <button
                              className={`log-row${isSelected ? " log-row--selected" : ""}`}
                              key={buildLogKey(entry)}
                              onClick={() => handleSelect(entry)}
                              type="button"
                            >
                              <div className="log-row__top">
                                <span className={`log-pill log-pill--${entry.level.toLowerCase()}`}>
                                  {entry.level}
                                </span>
                                <span className="log-row__time">{formatTime(entry.timestamp)}</span>
                                <span className="log-row__source">
                                  {highlightLogText(entry.source, deferredSearch)}
                                </span>
                              </div>
                              <div className="log-row__summary">
                                {highlightLogText(entry.summary, deferredSearch)}
                              </div>
                              <div className="log-row__meta">
                                {entry.executionId ? (
                                  <span className="log-chip">{entry.executionId}</span>
                                ) : null}
                                {entry.tag ? <span className="log-chip">{entry.tag}</span> : null}
                                <span className="log-chip">{entry.folder}</span>
                                {entry.process ? (
                                  <span className="log-chip">{entry.process}</span>
                                ) : null}
                                {entry.event ? <span className="log-chip">{entry.event}</span> : null}
                              </div>
                            </button>
                          );
                        })}
                  </div>
                </section>
              ))
            )
          ) : null}
          {hasMore && filteredLogs.length > 0 && (
            <div className="logs-load-older">
              <button type="button" className="logs-button" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "Loading older..." : "Load older"}
              </button>
            </div>
          )}
        </div>
      </section>

      {selectedRun ? (
        <RunDrawer run={selectedRun} onClose={handleDrawerClose} />
      ) : detailOpen && selectedLog && viewMode === "eventos" ? (
        <aside className="logs-detail">
          <header className="logs-detail__header">
            <div>
              <div className="logs-toolbar__eyebrow">Log detail</div>
              <h2 className="logs-detail__title">
                {highlightLogText(selectedLog.summary, deferredSearch)}
              </h2>
            </div>
            <div className="logs-detail__header-actions">
              <button
                className="logs-button logs-detail__copy-json"
                onClick={() => copyValue(buildLogJson(selectedLog), "json")}
                type="button"
                title="Copy the full log entry as formatted JSON"
              >
                {copiedKey === "json" ? "Copied" : "Copy JSON"}
              </button>
              <button className="logs-button" onClick={() => setDetailOpen(false)} type="button">
                Close
              </button>
            </div>
          </header>

          <div className="logs-detail__meta">
            <span className={`log-pill log-pill--${selectedLog.level.toLowerCase()}`}>
              {selectedLog.level}
            </span>
            <span className="log-chip">{selectedLog.source}</span>
            <span className="log-chip">{formatTimestamp(selectedLog.timestamp)}</span>
            {selectedLog.executionId ? (
              <button
                type="button"
                className={`log-chip logs-detail__copy-chip${copiedKey === "executionId" ? " logs-detail__copy-chip--copied" : ""}`}
                onClick={() => copyValue(selectedLog.executionId!, "executionId")}
                title="Click to copy executionId"
              >
                {copiedKey === "executionId" ? "Copied" : selectedLog.executionId}
              </button>
            ) : null}
            {selectedLog.tag ? <span className="log-chip">{selectedLog.tag}</span> : null}
            {selectedLog.className || selectedLog.methodName ? (
              <span className="log-chip">
                {[selectedLog.className, selectedLog.methodName].filter(Boolean).join(".")}
              </span>
            ) : null}
            {selectedLog.process ? <span className="log-chip">{selectedLog.process}</span> : null}
            {selectedLog.event ? <span className="log-chip">{selectedLog.event}</span> : null}
          </div>

          <section className="logs-detail__section">
            <div className="logs-detail__label">Message</div>
            <pre className="logs-detail__message">
              {highlightLogText(selectedLog.message, deferredSearch)}
            </pre>
          </section>

          {selectedLog.details.length > 0 ? (
            <section className="logs-detail__section">
              <div className="logs-detail__label">Structured fields</div>
              <div className="logs-detail__fields">
                {selectedLog.details.map((detail) => {
                  const fieldKey = `field:${detail.key}`;
                  const isCopied = copiedKey === fieldKey;
                  return (
                    <div className="logs-detail__field" key={detail.key}>
                      <div className="logs-detail__field-label">{detail.label}</div>
                      <button
                        type="button"
                        className={`logs-detail__field-value logs-detail__field-value--copyable${isCopied ? " logs-detail__field-value--copied" : ""}`}
                        onClick={() => copyValue(detail.value, fieldKey)}
                        title="Click to copy value"
                      >
                        {isCopied ? "Copied" : detail.value}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
