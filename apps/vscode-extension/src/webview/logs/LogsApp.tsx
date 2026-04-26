import type { LogRecord } from "../../logs";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { buildLogKey, coerceLogFilterValue, getLogsEmptyState, reconcileSelectedLogKey } from "./state";

type LogsMessage = {
  type: "logs:list";
  logs: LogRecord[];
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
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<LogsMessage>) {
      const message = event.data;
      if (message?.type !== "logs:list" || !Array.isArray(message.logs)) {
        return;
      }

      setLogs(message.logs);
      setLevel((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.level)));
      setSource((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.source)));
      setFolder((current) => coerceLogFilterValue(current, message.logs.map((entry) => entry.folder)));
      setSelectedKey((current) => {
        return reconcileSelectedLogKey(current, message.logs);
      });
      setDetailOpen((current) => (message.logs.length === 0 ? false : current));
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const levels = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.level))], [logs]);
  const sources = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.source))], [logs]);
  const folders = useMemo(() => ["all", ...new Set(logs.map((entry) => entry.folder))], [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (level !== "all" && entry.level !== level) {
        return false;
      }
      if (source !== "all" && entry.source !== source) {
        return false;
      }
      if (folder !== "all" && entry.folder !== folder) {
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
        ...entry.details.map((detail) => `${detail.label} ${detail.value}`)
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(deferredSearch);
    });
  }, [deferredSearch, folder, level, logs, source]);

  const hasActiveFilters = Boolean(search.trim()) || level !== "all" || source !== "all" || folder !== "all";
  const emptyState = getLogsEmptyState(logs.length, filteredLogs.length, hasActiveFilters);

  const groupedLogs = useMemo(() => {
    const groups: Array<{ day: string; logs: LogRecord[] }> = [];
    for (const entry of filteredLogs) {
      const current = groups[groups.length - 1];
      if (!current || current.day !== entry.day) {
        groups.push({ day: entry.day, logs: [entry] });
      } else {
        current.logs.push(entry);
      }
    }
    return groups;
  }, [filteredLogs]);

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
          </div>
        </header>

        <div className="logs-filters">
          <input
            className="logs-input logs-filters__search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search source, process, event, message..."
            type="search"
            value={search}
          />
          <select className="logs-input" onChange={(event) => setLevel(event.target.value)} value={level}>
            {levels.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All levels" : option}
              </option>
            ))}
          </select>
          <select className="logs-input" onChange={(event) => setFolder(event.target.value)} value={folder}>
            {folders.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All folders" : option}
              </option>
            ))}
          </select>
          <select className="logs-input" onChange={(event) => setSource(event.target.value)} value={source}>
            {sources.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All sources" : option}
                {option !== "all" ? option : null}
              </option>
            ))}
          </select>
        </div>

        <div className="logs-list">
          {emptyState === "empty" ? (
            <div className="logs-empty-state">
              <div className="logs-toolbar__eyebrow">No data yet</div>
              <h2 className="logs-empty-state__title">No logs available in the current collection.</h2>
              <p className="logs-empty-state__text">Refresh the panel or verify the extension is pointed at the expected Mongo database.</p>
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
              <section className="logs-day-group" key={group.day}>
                <div className="logs-day-group__title">{formatDay(group.day)}</div>
                <div className="logs-day-group__items">
                  {group.logs.map((entry) => {
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
                          <span className="log-row__source">{entry.source}</span>
                        </div>
                        <div className="log-row__summary">{entry.summary}</div>
                        <div className="log-row__meta">
                          <span className="log-chip">{entry.folder}</span>
                          {entry.process ? <span className="log-chip">{entry.process}</span> : null}
                          {entry.event ? <span className="log-chip">{entry.event}</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </section>

      {detailOpen && selectedLog ? (
        <aside className="logs-detail">
          <header className="logs-detail__header">
            <div>
              <div className="logs-toolbar__eyebrow">Log detail</div>
              <h2 className="logs-detail__title">{selectedLog.summary}</h2>
            </div>
            <button className="logs-button" onClick={() => setDetailOpen(false)} type="button">
              Close
            </button>
          </header>

          <div className="logs-detail__meta">
            <span className={`log-pill log-pill--${selectedLog.level.toLowerCase()}`}>{selectedLog.level}</span>
            <span className="log-chip">{selectedLog.source}</span>
            <span className="log-chip">{formatTimestamp(selectedLog.timestamp)}</span>
            {selectedLog.process ? <span className="log-chip">{selectedLog.process}</span> : null}
            {selectedLog.event ? <span className="log-chip">{selectedLog.event}</span> : null}
          </div>

          <section className="logs-detail__section">
            <div className="logs-detail__label">Message</div>
            <pre className="logs-detail__message">{selectedLog.message}</pre>
          </section>

          {selectedLog.details.length > 0 ? (
            <section className="logs-detail__section">
              <div className="logs-detail__label">Structured fields</div>
              <div className="logs-detail__fields">
                {selectedLog.details.map((detail) => (
                  <div className="logs-detail__field" key={detail.key}>
                    <div className="logs-detail__field-label">{detail.label}</div>
                    <div className="logs-detail__field-value">{detail.value}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function formatDay(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
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
