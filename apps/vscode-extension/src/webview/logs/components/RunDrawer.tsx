import type { RunGroup } from "../../../logs/runModel";
import type { LogRecord } from "../../../logs/normalize";
import { formatDuration, runStatusClass, runStatusIcon } from "../state";

type RunDrawerProps = {
  run: RunGroup | null;
  onClose?: () => void;
  tz?: string;
};

export function RunDrawer({ run, onClose, tz = "UTC" }: RunDrawerProps) {
  if (!run) return null;

  const events = [...run.events].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  const hasFacets =
    run.sources.length > 0 ||
    run.targets.length > 0 ||
    run.rowsRead !== undefined ||
    run.rowsInserted !== undefined ||
    run.rowsUpdated !== undefined ||
    run.rowsDeleted !== undefined;

  const context = extractContext(events);
  const hasContext = Object.values(context).some(Boolean);

  const bagFields = extractBagFields(events);

  return (
    <aside className="logs-run-drawer">
      <header className="logs-run-drawer__header">
        <div className="logs-run-drawer__header-top">
          <div className="logs-run-drawer__process-name">{run.process}</div>
          {onClose ? (
            <button
              className="logs-button logs-run-drawer__close"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          ) : null}
        </div>
        <div className="logs-run-drawer__header-meta">
          <span className={`logs-run-status ${runStatusClass(run.status)}`}>
            {runStatusIcon(run.status)}
          </span>
          <span className="logs-run-drawer__time">
            {formatLogTimestamp(run.startedAt, tz)}
          </span>
          {run.endedAt ? (
            <span className="logs-run-drawer__time">
              &rarr; {formatLogTimestamp(run.endedAt, tz)}
            </span>
          ) : null}
          <span className="logs-run-drawer__duration">
            {formatDuration(run.durationMs)}
          </span>
          {run.inferred ? (
            <span className="log-chip logs-run-drawer__badge">inferred</span>
          ) : null}
          {run.sinMedicion ? (
            <span className="log-chip logs-run-drawer__badge">sin medición</span>
          ) : null}
          {run.errorCount > 0 ? (
            <span className="logs-badge logs-badge--error">
              {run.errorCount}
            </span>
          ) : null}
        </div>
      </header>

      <div className="logs-run-drawer__body">
        {/* Timeline */}
        <section className="logs-run-drawer__section">
          <h3 className="logs-run-drawer__section-title">Timeline</h3>
          <div className="logs-run-drawer__timeline">
            {events.map((event, i) => (
              <TimelineNode key={i} event={event} isLast={i === events.length - 1} tz={tz} />
            ))}
          </div>
        </section>

        {/* Data movement */}
        {hasFacets ? (
          <section className="logs-run-drawer__section">
            <h3 className="logs-run-drawer__section-title">Data movement</h3>
            <div className="logs-run-drawer__facets">
              {run.sources.length > 0 ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Source</span>
                  <span className="logs-run-drawer__facet-value">
                    {run.sources.join(", ")}
                  </span>
                </div>
              ) : null}
              {run.targets.length > 0 ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Target</span>
                  <span className="logs-run-drawer__facet-value">
                    {run.targets.join(", ")}
                  </span>
                </div>
              ) : null}
              {run.entities.length > 0 ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Entity</span>
                  <span className="logs-run-drawer__facet-value">
                    {run.entities.join(", ")}
                  </span>
                </div>
              ) : null}
              {run.operations.length > 0 ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Operation</span>
                  <span className="logs-run-drawer__facet-value">
                    {run.operations.join(", ")}
                  </span>
                </div>
              ) : null}
              {run.rowsRead !== undefined ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Rows read</span>
                  <span className="logs-run-drawer__facet-value">{run.rowsRead}</span>
                </div>
              ) : null}
              {run.rowsInserted !== undefined ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Rows inserted</span>
                  <span className="logs-run-drawer__facet-value">{run.rowsInserted}</span>
                </div>
              ) : null}
              {run.rowsUpdated !== undefined ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Rows updated</span>
                  <span className="logs-run-drawer__facet-value">{run.rowsUpdated}</span>
                </div>
              ) : null}
              {run.rowsDeleted !== undefined ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Rows deleted</span>
                  <span className="logs-run-drawer__facet-value">{run.rowsDeleted}</span>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Context */}
        {hasContext ? (
          <section className="logs-run-drawer__section">
            <h3 className="logs-run-drawer__section-title">Context</h3>
            <div className="logs-run-drawer__context">
              {context.host ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Host</span>
                  <span className="logs-run-drawer__facet-value">{context.host}</span>
                </div>
              ) : null}
              {context.project ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Project</span>
                  <span className="logs-run-drawer__facet-value">{context.project}</span>
                </div>
              ) : null}
              {context.script ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Script</span>
                  <span className="logs-run-drawer__facet-value">{context.script}</span>
                </div>
              ) : null}
              {context.env ? (
                <div className="logs-run-drawer__facet-row">
                  <span className="logs-run-drawer__facet-label">Env</span>
                  <span className="logs-run-drawer__facet-value">{context.env}</span>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Detail bag */}
        {bagFields.length > 0 ? (
          <section className="logs-run-drawer__section">
            <h3 className="logs-run-drawer__section-title">Details</h3>
            <div className="logs-run-drawer__details-grid">
              {bagFields.map((field, i) => (
                <div key={i} className="logs-run-drawer__detail-item">
                  <span className="logs-run-drawer__facet-label">{field.label}</span>
                  <span className="logs-run-drawer__facet-value">{field.value}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function TimelineNode({ event, isLast, tz }: { event: LogRecord; isLast: boolean; tz: string }) {
  const levelClass = event.level.toLowerCase();
  const time = formatLogTimestamp(event.timestamp, tz);
  return (
    <div className="logs-run-drawer__timeline-node">
      <div className="logs-run-drawer__timeline-line">
        <div className={`logs-run-drawer__timeline-dot logs-run-drawer__timeline-dot--${levelClass}`} />
        {!isLast ? (
          <div className="logs-run-drawer__timeline-connector" />
        ) : null}
      </div>
      <div className="logs-run-drawer__timeline-content">
        <div className="logs-run-drawer__timeline-top">
          <span className={`log-pill log-pill--${levelClass}`}>
            {event.event || event.level}
          </span>
          <span className="logs-run-drawer__timeline-time">{time}</span>
        </div>
        <div className="logs-run-drawer__timeline-message">
          {event.message || event.summary}
        </div>
        {event.details.length > 0 ? (
          <div className="logs-run-drawer__timeline-details">
            {event.details.map((d, di) => (
              <span key={di} className="log-chip">{d.label}: {d.value}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function extractContext(events: LogRecord[]) {
  const ctx = { host: "", project: "", script: "", env: "" };
  for (const ev of events) {
    if (ev.context) {
      if (ev.context.host && !ctx.host) ctx.host = ev.context.host;
      if (ev.context.project && !ctx.project) ctx.project = ev.context.project;
      if (ev.context.script && !ctx.script) ctx.script = ev.context.script;
      if (ev.context.env && !ctx.env) ctx.env = ev.context.env;
      if (ctx.host && ctx.project && ctx.script && ctx.env) break;
    }
  }
  return ctx;
}

function extractBagFields(events: LogRecord[]) {
  const seen = new Set<string>();
  const fields: { label: string; value: string }[] = [];
  for (const ev of events) {
    for (const detail of ev.details) {
      if (seen.has(detail.key)) continue;
      seen.add(detail.key);
      fields.push({ label: detail.label, value: detail.value });
    }
  }
  return fields;
}

function formatLogTimestamp(iso: string, tz: string = "UTC") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    hour12: false,
    ...(tz === "local" ? {} : { timeZone: tz }),
  });
}
