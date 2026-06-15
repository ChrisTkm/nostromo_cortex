import * as vscode from "vscode";

export function getNotesHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "notes.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "notes.css"));
  const csp = `default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const uiFont = vscode.workspace.getConfiguration("cortex").get<string>("uiFont", "JetBrains Mono");
  const fontStack = uiFont === "Inter"
    ? `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
    : `'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'Courier New', monospace`;
  const theme = vscode.workspace.getConfiguration("cortex").get<string>("theme", "cortex");

  return `<!DOCTYPE html>
  <html lang="en" data-cortex-theme="${theme}">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Cortex Notes</title>
      <link rel="stylesheet" href="${styleUri}" />
      <style>
        :root {
          --cortex-font: ${fontStack};
          color-scheme: dark;
        }

        * {
          box-sizing: border-box;
        }

        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
        }

        body {
          overflow: hidden;
          padding: 0;
          background: var(--cortex-bg);
          color: var(--cortex-text);
          font-family: var(--cortex-font);
        }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
  </html>`;
}
