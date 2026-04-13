import * as vscode from "vscode";

export function getGraphHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.js"));
  const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Cortex Graph</title>
      <style>
        :root {
          color-scheme: dark;
        }

        * {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          height: 100%;
          background: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          font-family: "JetBrains Mono", var(--vscode-editor-font-family), var(--vscode-font-family), monospace;
        }

        body {
          background:
            radial-gradient(circle at top left, rgba(80, 126, 255, 0.12) 0%, transparent 28%),
            radial-gradient(circle at top right, rgba(10, 170, 145, 0.12) 0%, transparent 24%),
            linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 94%, #06080d 6%), var(--vscode-editor-background));
        }

        .layout {
          display: grid;
          grid-template-rows: auto 1fr;
          height: 100%;
          min-height: 0;
        }

        .toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 84%, #0d121b 16%);
          backdrop-filter: blur(8px);
        }

        .toolbar-actions,
        .toolbar-meta,
        .toolbar-filters {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .toolbar-meta {
          margin-left: auto;
          justify-content: flex-end;
        }

        .workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          min-height: 0;
        }

        body.sidebar-collapsed .workspace {
          grid-template-columns: minmax(0, 1fr);
        }

        .canvas {
          position: relative;
          min-height: 0;
          overflow: hidden;
          background:
            linear-gradient(color-mix(in srgb, var(--vscode-panel-border) 24%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--vscode-panel-border) 24%, transparent) 1px, transparent 1px);
          background-size: 32px 32px;
        }

        #graph {
          position: absolute;
          inset: 0;
        }

        .overlay {
          position: absolute;
          z-index: 5;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          max-width: min(620px, calc(100% - 24px));
        }

        .overlay.top {
          top: 12px;
          left: 12px;
        }

        .overlay.bottom {
          bottom: 12px;
          left: 12px;
        }

        .panel,
        .chip,
        .badge {
          border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 82%, transparent);
          background: rgba(10, 14, 22, 0.84);
          box-shadow: 0 18px 36px rgba(0, 0, 0, 0.18);
          backdrop-filter: blur(12px);
        }

        .chip,
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
        }

        .chip strong,
        .badge strong {
          font-weight: 700;
        }

        .status-chip-done { border-color: rgba(100, 241, 194, 0.55); color: #64f1c2; }
        .status-chip-progress { border-color: rgba(129, 140, 248, 0.55); color: #818cf8; }
        .status-chip-pending { border-color: rgba(129, 140, 248, 0.4); color: #a5b4fc; }
        .status-chip-blocked { border-color: rgba(148, 163, 184, 0.4); color: #cbd5e1; }
        .status-chip-failed { border-color: rgba(107, 114, 128, 0.4); color: #9ca3af; }
        .severity-low { border-color: rgba(148, 163, 184, 0.45); color: #e2e8f0; }
        .severity-medium { border-color: rgba(103, 232, 249, 0.45); color: #cffafe; }
        .severity-high { border-color: rgba(251, 191, 36, 0.45); color: #fde68a; }
        .severity-critical { border-color: rgba(251, 113, 133, 0.55); color: #fecdd3; }

        .sidebar {
          border-left: 1px solid color-mix(in srgb, var(--vscode-panel-border) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, #070b12 6%);
          padding: 12px;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        body.sidebar-collapsed .sidebar {
          display: none;
        }

        .panel {
          border-radius: 14px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .metric {
          padding: 10px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .metric-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          opacity: 0.7;
        }

        .metric-value {
          margin-top: 4px;
          font-size: 18px;
          font-weight: 700;
        }

        .summary-title {
          margin: 0;
          font-size: 18px;
          line-height: 1.25;
        }

        .summary-text,
        .muted {
          opacity: 0.78;
        }

        .meta-list,
        .list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .meta-list .badge,
        .list .badge {
          box-shadow: none;
          background: rgba(255, 255, 255, 0.04);
        }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .meta-item {
          padding: 10px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .meta-item .label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          opacity: 0.68;
        }

        .meta-item .value {
          margin-top: 4px;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.35;
          word-break: break-word;
        }

        .empty {
          opacity: 0.6;
          font-style: italic;
        }

        .tooltip {
          position: absolute;
          pointer-events: none;
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(7, 10, 16, 0.94);
          color: white;
          font-size: 12px;
          display: none;
          z-index: 9;
          max-width: 280px;
          box-shadow: 0 18px 40px rgba(0,0,0,0.35);
        }

        button, select {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 10px;
          padding: 7px 12px;
          cursor: pointer;
        }

        button.secondary, select {
          background: color-mix(in srgb, var(--vscode-dropdown-background) 86%, #08101a 14%);
          color: var(--vscode-dropdown-foreground);
          border: 1px solid var(--vscode-dropdown-border);
        }

        .legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          display: inline-block;
        }

        code {
          font-family: "JetBrains Mono", var(--vscode-editor-font-family), monospace;
        }
      </style>
    </head>
    <body>
      <div class="layout">
        <div class="toolbar">
          <div class="toolbar-actions">
            <button id="refresh">Refresh</button>
            <button id="fit" class="secondary">Fit</button>
            <button id="clear-selection" class="secondary">Clear</button>
            <button id="edit-task" class="secondary">Edit task</button>
            <button id="toggle-sidebar" class="secondary">Hide details</button>
            <select id="orientation" class="secondary">
              <option value="LR">Left to right</option>
              <option value="TB">Top to bottom</option>
            </select>
          </div>
          <div class="toolbar-filters">
            <span class="chip" id="filter-projects">Project · all</span>
            <span class="chip" id="filter-groups">Group · all</span>
            <span class="chip" id="filter-tags">Tags · all</span>
          </div>
          <div class="toolbar-meta">
            <span class="chip" id="selected-code">No task selected</span>
            <span class="chip" id="connection-db">mongo://cortex.tasks</span>
            <span class="muted" id="stats"></span>
          </div>
        </div>

        <div class="workspace">
          <div class="canvas">
            <div class="overlay top">
              <span class="chip status-chip-done">Done <strong id="count-done">0</strong></span>
              <span class="chip status-chip-progress">In progress <strong id="count-progress">0</strong></span>
              <span class="chip status-chip-pending">Pending <strong id="count-pending">0</strong></span>
              <span class="chip status-chip-blocked">Blocked <strong id="count-blocked">0</strong></span>
              <span class="chip status-chip-failed">Failed <strong id="count-failed">0</strong></span>
            </div>

            <div class="overlay bottom">
              <span class="badge"><span class="legend-dot" style="background:#20384b; border:1px solid #67e8f9;"></span> Low / Medium / High / Critical border</span>
              <span class="badge"><span class="legend-dot" style="background:#64f1c2;"></span> Ready edge</span>
              <span class="badge"><span class="legend-dot" style="background:#7aa2ff;"></span> Selected path</span>
            </div>

            <div id="graph"></div>
            <div id="tooltip" class="tooltip"></div>
          </div>

          <aside class="sidebar">
            <section class="panel">
              <div class="metrics-grid">
                <div class="metric"><div class="metric-label">Tasks</div><div class="metric-value" id="kpi-total">0</div></div>
                <div class="metric"><div class="metric-label">Ready</div><div class="metric-value" id="kpi-ready">0</div></div>
                <div class="metric"><div class="metric-label">Blocked</div><div class="metric-value" id="kpi-blocked">0</div></div>
                <div class="metric"><div class="metric-label">Done</div><div class="metric-value" id="kpi-done">0</div></div>
                <div class="metric"><div class="metric-label">Est. hours</div><div class="metric-value" id="kpi-duration">0h</div></div>
                <div class="metric"><div class="metric-label">Ready hours</div><div class="metric-value" id="kpi-ready-duration">0h</div></div>
              </div>
            </section>

            <section class="panel">
              <div class="meta-list">
                <span class="badge" id="selected-project">No project</span>
                <span class="badge" id="selected-agent">No agent</span>
                <span class="badge" id="selected-status">No status</span>
                <span class="badge" id="selected-severity">No severity</span>
              </div>
              <h2 class="summary-title" id="summary-title">Select a task</h2>
              <div id="summary" class="summary-text">Pick a node from the graph or task navigator to inspect the task and edit it if needed.</div>
            </section>

            <section class="panel">
              <div class="metrics-grid">
                <div class="metric"><div class="metric-label">Ready</div><div class="metric-value" id="metric-ready">—</div></div>
                <div class="metric"><div class="metric-label">Est. duration</div><div class="metric-value" id="metric-duration">—</div></div>
                <div class="metric"><div class="metric-label">Blocked by</div><div class="metric-value" id="metric-blocked">—</div></div>
                <div class="metric"><div class="metric-label">Downstream</div><div class="metric-value" id="metric-downstream">—</div></div>
              </div>
            </section>

            <section class="panel">
              <div class="meta-grid">
                <div class="meta-item"><div class="label">Project</div><div class="value" id="meta-project">—</div></div>
                <div class="meta-item"><div class="label">Group</div><div class="value" id="meta-lane">—</div></div>
                <div class="meta-item"><div class="label">Source</div><div class="value" id="meta-source">—</div></div>
                <div class="meta-item"><div class="label">Collection</div><div class="value" id="meta-collection">—</div></div>
                <div class="meta-item"><div class="label">Created</div><div class="value" id="meta-created">—</div></div>
                <div class="meta-item"><div class="label">Updated</div><div class="value" id="meta-updated">—</div></div>
              </div>
            </section>

            <section class="panel">
              <div class="metric-label">Dependencies</div>
              <div id="dependencies" class="list"><span class="empty">—</span></div>
              <div class="metric-label">Successors</div>
              <div id="successors" class="list"><span class="empty">—</span></div>
              <div class="metric-label">Tags</div>
              <div id="metadata" class="list"><span class="empty">—</span></div>
            </section>
          </aside>
        </div>
      </div>
      <script nonce="${nonce}">
        window.CORTEX_WEBVIEW_BOOT = {
          extensionUri: ${JSON.stringify(extensionUri.toString())}
        };
      </script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
  </html>`;
}
