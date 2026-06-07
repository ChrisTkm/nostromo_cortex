import type { LogRecord } from "../../logs";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildExecutionGroups, buildLogJson, buildLogKey, buildLogsCsvExport, buildLogsJsonExport, coerceLogFilterValue, countLogsByLevel, filterLogsByTime, getLogsEmptyState, getOldestLogTimestamp, LOGS_PYTHON_SNIPPET, mergeLogPages, reconcileSelectedLogKey, shouldShowFilter, sortLogLevelKeys } from "./state";
import { highlightLogText } from "./highlightText";

type LogsMessage = {
  type: "logs:list";
  logs: LogRecord[];
  autoRefreshSeconds: number;
  hasMore: boolean;
} | {
  type: "logs:append";
  logs: LogRecord[];
  hasMore: boolean;
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
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<LogsMessage>) {
      const message = event.data;
      if (message?.type === "logs:list" && Array.isArray(message.logs)) {
        setLogs(message.logs);
        setAutoRefreshSeconds(message.autoRefreshSeconds ?? 0);
        setHasMore(Boolean(message.hasMore));
        setLoadingOlder(false);
        setLevel((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.level)));
        setSource((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.source)));
        setFolder((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.folder)));
        setTag((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.tag ?? entry.event ?? "untagged")));
        setProcess((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.process ?? "unknown")));
        setSelectedKey((current) => {
          return reconcileSelectedLogKey(current, message.logs);
        });
        setDetailOpen((current) => (message.logs.length === 0 ? false : current));
        return;
      }
      if (message?.type === "logs:append" && Array.isArray(message.logs)) {
        setLogs((current) => mergeLogPages(current, message.logs));
        setHasMore(Boolean(message.hasMore));
        setLoadingOlder(false);
      }
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const levels = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.level))], [logs]);
  const sources = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.source))], [logs]);
  const folders = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.folder))], [logs]);
  const tags = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.tag ?? entry.event ?? "untagged"))], [logs]);
  const processes = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.process ?? "unknown"))], [logs]);

  const baseFilteredLogs = useMemo(() => {
    const timeFiltered = filterLogsByTime(logs, timeRange);
    return timeFiltered.filter((entry) => {
      if (source !== "all" && entry.source !== source) {
        return false;
      }
      if (folder !== "all" && entry.folder !== folder) {
        return false;
      }
      if (tag !== "all" && (entry.tag ?? entry.event ?? "untagged") !== tag) {
        return false;
      }
      if (process !== "all" && (entry.process ?? "unknown") !== process) {
        return false;
      }
      if (!deferredSearch) {
        return true;
      }
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
        ...entry.details.map((detail) => `${detail.label} ${detail.value}`)
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(deferredSearch);
    });
  }, [deferredSearch, folder, logs, process, source, tag, timeRange]);

  const filteredLogs = useMemo(() => {
    if (level === "all") return baseFilteredLogs;
    return baseFilteredLogs.filter((entry) => entry.level === level);
  }, [baseFilteredLogs, level]);

  const levelCounts = useMemo(() => countLogsByLevel(baseFilteredLogs), [baseFilteredLogs]);
  const orderedLevelKeys = useMemo(() => sortLogLevelKeys(Object.keys(levelCounts)), [levelCounts]);

  const hasActiveFilters = Boolean(search.trim()) || level !== "all" || source !== "all" || folder !== "all" || tag !== "all" || process !== "all" || timeRange !== "all";
  const emptyState = getLogsEmptyState(logs.length, filteredLogs.length, hasActiveFilters);
  const groupedLogs = useMemo(() => buildExecutionGroups(filteredLogs), [filteredLogs]);

  const selectedLog = useMemo(() => {
    if (!selectedKey) {
      return filteredLogs[0] ?? null;
    }
    return filteredLogs.find((entry) => buildLogKey(entry) === selectedKey) ?? filteredLogs[0] ?? null;
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
  }

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

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
    const content = format === "csv"
      ? buildLogsCsvExport(filteredLogs)
      : buildLogsJsonExport(filteredLogs);
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
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <div className={`logs-app${detailOpen && selectedLog ? "" : " logs-app--list-only"}`}>
      <section className="logs-list-panel">
        <header className="logs-toolbar">
          <div>
            <div className="logs-toolbar__eyebrow">Mongo collection</div>
            <h1 className="logs-toolbar__title">Cortex Logs</h1>
          </div>
          <div className="logs-toolbar__actions">
            <span className="logs-toolbar__count">
              {filteredLogs.length} visible{logs.length !== filteredLogs.length ? ` of ${logs.length}` : ""}
            </span>
            <button className="logs-button logs-button--primary" onClick={() => vscode.postMessage({ type: "logs:refresh" })} type="button">
              Refresh
            </button>
            <button className="logs-button" onClick={() => exportLogs("csv")} disabled={filteredLogs.length === 0} type="button" title="Export the currently filtered logs as CSV">
              Export CSV
            </button>
            <button className="logs-button" onClick={() => exportLogs("json")} disabled={filteredLogs.length === 0} type="button" title="Export the currently filtered logs as JSON">
              Export JSON
            </button>
            {autoRefreshSeconds > 0 ? (
              <span className="logs-toolbar__autorefresh" title={`Auto-refreshing every ${autoRefreshSeconds}s`}>
                <span className="logs-toolbar__autorefresh-dot" />
                {autoRefreshSeconds}s
              </span>
            ) : null}
          </div>
        </header>

        {orderedLevelKeys.length > 0 ? (
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

        <div className="logs-filters">
          <input
            className="logs-input logs-filters__search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search source, process, event, message..."
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
          </div>
          {shouldShowFilter(processes) ? (
            <select className="logs-input" onChange={(event) => setProcess(event.target.value)} value={process}>
              {processes.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All processes" : option}
                </option>
              ))}
            </select>
          ) : null}
          {shouldShowFilter(levels) ? (
            <select className="logs-input" onChange={(event) => setLevel(event.target.value)} value={level}>
              {levels.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All levels" : option}
                </option>
              ))}
            </select>
          ) : null}
          {shouldShowFilter(folders) ? (
            <select className="logs-input" onChange={(event) => setFolder(event.target.value)} value={folder}>
              {folders.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All folders" : option}
                </option>
              ))}
            </select>
          ) : null}
          {shouldShowFilter(tags) ? (
            <select className="logs-input" onChange={(event) => setTag(event.target.value)} value={tag}>
              {tags.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All tags" : option}
                </option>
              ))}
            </select>
          ) : null}
          {shouldShowFilter(sources) ? (
            <select className="logs-input" onChange={(event) => setSource(event.target.value)} value={source}>
              {sources.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All sources" : option}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="logs-list">
          {emptyState === "empty" ? (
            <div className="logs-empty-state logs-empty-state--onboarding">
              <div className="logs-toolbar__eyebrow">No logs yet</div>
              <h2 className="logs-empty-state__title">Start emitting logs to Cortex</h2>
              <p className="logs-empty-state__text">
                Cortex Logs reads from your MongoDB <code>logs</code> collection. Emit one document per event
                following the Cortex log contract. Below is a runnable Python snippet using <code>pymongo</code>.
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
              <p className="logs-empty-state__text">Try clearing a filter or broadening the search query.</p>
              {hasActiveFilters ? (
                <button className="logs-button" onClick={clearFilters} type="button">
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            groupedLogs.map((group) => (
              <section
                className={`logs-execution-group${group.isUngrouped ? " logs-execution-group--ungrouped" : ""}${group.kind === "process" ? " logs-execution-group--process" : ""}`}
                key={group.id}
              >
                <button className="logs-execution-group__header" onClick={() => toggleGroup(group.id)} type="button">
                  <span className="logs-execution-group__chevron">{collapsedGroups.has(group.id) ? ">" : "v"}</span>
                  <span className={`log-pill log-pill--${group.dominantTag.toLowerCase()}`}>{group.dominantTag}</span>
                  {group.kind === "process" ? (
                    <>
                      <span className="logs-execution-group__title">{group.label}</span>
                      <span className="logs-execution-group__time">
                        {formatTime(group.beginTimestamp)} &rarr; {formatTime(group.endTimestamp ?? group.beginTimestamp)}
                      </span>
                      <span className="log-chip">{group.logs.length} logs</span>
                    </>
                  ) : (
                    <>
                      <span className="logs-execution-group__title">{group.classMethod}</span>
                      <span className="logs-execution-group__time">{formatTimestamp(group.beginTimestamp)}</span>
                      {group.endTimestamp ? <span className="log-chip">END {formatTime(group.endTimestamp)}</span> : <span className="log-chip">open</span>}
                      {typeof group.durationMs === "number" ? <span className="log-chip">{formatDuration(group.durationMs)}</span> : null}
                      <span className="log-chip">{group.logs.length} logs</span>
                      <span className="logs-execution-group__id">{group.label}</span>
                    </>
                  )}
                </button>
                <div className="logs-day-group__items" hidden={collapsedGroups.has(group.id)}>
                  {group.runs ? (
                    group.runs.map((run) => {
                      const runKey = `${group.id}::${run.id}`;
                      return (
                        <div className="logs-process-run" key={runKey}>
                          <button className="logs-process-run__header" onClick={() => toggleGroup(runKey)} type="button">
                            <span className="logs-execution-group__chevron">{collapsedGroups.has(runKey) ? ">" : "v"}</span>
                            <span className={`log-pill log-pill--${run.dominantTag.toLowerCase()}`}>{run.dominantTag}</span>
                            <span className="logs-process-run__label">{run.label}</span>
                            <span className="logs-execution-group__time">
                              {formatTime(run.beginTimestamp)} &rarr; {formatTime(run.endTimestamp ?? run.beginTimestamp)}
                            </span>
                            {typeof run.durationMs === "number" ? <span className="log-chip">{formatDuration(run.durationMs)}</span> : null}
                            <span className="log-chip">{run.logs.length} logs</span>
                          </button>
                          <div className="logs-process-run__logs" hidden={collapsedGroups.has(runKey)}>
                            {run.logs.map((entry) => {
                              const isSelected = selectedLog ? buildLogKey(selectedLog) === buildLogKey(entry) : false;
                              return (
                                <button
                                  className={`log-row${isSelected ? " log-row--selected" : ""}`}
                                  key={buildLogKey(entry)}
                                  onClick={() => handleSelect(entry)}
                                  type="button"
                                >
                                  <div className="log-row__top">
                                    <span className={`log-pill log-pill--${entry.level.toLowerCase()}`}>{entry.level}</span>
                                    <span className="log-row__time">{formatTime(entry.timestamp)}</span>
                                    <span className="log-row__source">{highlightLogText(entry.source, deferredSearch)}</span>
                                  </div>
                                  <div className="log-row__summary">{highlightLogText(entry.summary, deferredSearch)}</div>
                                  <div className="log-row__meta">
                                    {entry.executionId ? <span className="log-chip">{entry.executionId}</span> : null}
                                    {entry.tag ? <span className="log-chip">{entry.tag}</span> : null}
                                    <span className="log-chip">{entry.folder}</span>
                                    {entry.process ? <span className="log-chip">{entry.process}</span> : null}
                                    {entry.event ? <span className="log-chip">{entry.event}</span> : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    group.logs.map((entry) => {
                      const isSelected = selectedLog ? buildLogKey(selectedLog) === buildLogKey(entry) : false;
                      return (
                        <button
                          className={`log-row${isSelected ? " log-row--selected" : ""}`}
                          key={buildLogKey(entry)}
                          onClick={() => handleSelect(entry)}
                          type="button"
                        >
                          <div className="log-row__top">
                            <span className={`log-pill log-pill--${entry.level.toLowerCase()}`}>{entry.level}</span>
                            <span className="log-row__time">{formatTime(entry.timestamp)}</span>
                            <span className="log-row__source">{highlightLogText(entry.source, deferredSearch)}</span>
                          </div>
                          <div className="log-row__summary">{highlightLogText(entry.summary, deferredSearch)}</div>
                          <div className="log-row__meta">
                            {entry.executionId ? <span className="log-chip">{entry.executionId}</span> : null}
                            {entry.tag ? <span className="log-chip">{entry.tag}</span> : null}
                            <span className="log-chip">{entry.folder}</span>
                            {entry.process ? <span className="log-chip">{entry.process}</span> : null}
                            {entry.event ? <span className="log-chip">{entry.event}</span> : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            ))
          )}
          {hasMore && filteredLogs.length > 0 ? (
            <div className="logs-load-older">
              <button
                type="button"
                className="logs-button"
                onClick={loadOlder}
                disabled={loadingOlder}
              >
                {loadingOlder ? "Loading older..." : "Load older"}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {detailOpen && selectedLog ? (
        <aside className="logs-detail">
          <header className="logs-detail__header">
            <div>
              <div className="logs-toolbar__eyebrow">Log detail</div>
              <h2 className="logs-detail__title">{highlightLogText(selectedLog.summary, deferredSearch)}</h2>
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
            <span className={`log-pill log-pill--${selectedLog.level.toLowerCase()}`}>{selectedLog.level}</span>
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
              <span className="log-chip">{[selectedLog.className, selectedLog.methodName].filter(Boolean).join(".")}</span>
            ) : null}
            {selectedLog.process ? <span className="log-chip">{selectedLog.process}</span> : null}
            {selectedLog.event ? <span className="log-chip">{selectedLog.event}</span> : null}
          </div>

          <section className="logs-detail__section">
            <div className="logs-detail__label">Message</div>
            <pre className="logs-detail__message">{highlightLogText(selectedLog.message, deferredSearch)}</pre>
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
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }
  return `${Math.round(durationMs / 1000)} s`;
}
