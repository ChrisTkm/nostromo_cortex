import * as vscode from "vscode";

export function getGraphHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.css"));
  const csp = `default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Cortex Graph</title>
      <link rel="stylesheet" href="${styleUri}" />
      <style>
        :root {
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
          background:
            radial-gradient(circle at top left, rgba(80, 126, 255, 0.12) 0%, transparent 28%),
            radial-gradient(circle at top right, rgba(10, 170, 145, 0.12) 0%, transparent 24%),
            linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 94%, #06080d 6%), var(--vscode-editor-background));
          color: var(--vscode-editor-foreground);
          font-family: var(--vscode-font-family), sans-serif;
        }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
  </html>`;
}
