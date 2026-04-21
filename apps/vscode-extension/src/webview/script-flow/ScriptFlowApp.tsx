import { useEffect, useState } from "react";

type ScriptFlowScope = "file" | "selection";

type ScriptFlowSource = {
  fileName: string;
  fsPath: string;
  extension: string;
  languageId: string;
};

type ScriptFlowSelection = {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  charCount: number;
};

type ScriptFlowInitPayload =
  | {
      status: "empty";
      title: string;
      description: string;
      scope: ScriptFlowScope;
    }
  | {
      status: "unsupported";
      title: string;
      description: string;
      extension: string;
      supportedExtensions: string[];
      scope: ScriptFlowScope;
      source: ScriptFlowSource;
    }
  | {
      status: "error";
      title: string;
      description: string;
      scope: ScriptFlowScope;
      source: ScriptFlowSource;
    }
  | {
      status: "loading";
      title: string;
      description: string;
      scope: ScriptFlowScope;
      source: ScriptFlowSource;
      selection?: ScriptFlowSelection;
    };

type ScriptFlowMessage = {
  type: "init";
  payload: ScriptFlowInitPayload;
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

const defaultState: ScriptFlowInitPayload = {
  status: "empty",
  title: "Waiting for Script Flow",
  description: "Open the panel from a supported editor to inspect a file or selection.",
  scope: "file"
};

export function ScriptFlowApp() {
  const [state, setState] = useState<ScriptFlowInitPayload>(() => {
    const persisted = vscode.getState();
    return isScriptFlowState(persisted) ? persisted : defaultState;
  });
  const [crashRequested, setCrashRequested] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent<ScriptFlowMessage>) {
      const message = event.data;
      if (message?.type !== "init" || !isScriptFlowState(message.payload)) {
        return;
      }
      setCrashRequested(false);
      setState(message.payload);
      vscode.setState(message.payload);
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (crashRequested) {
    throw new Error("Script Flow crash test requested");
  }

  return (
    <div className={`script-flow-app script-flow-app--${state.status}`}>
      <header className="script-flow-header">
        <div>
          <div className="script-flow-header__eyebrow">Process shell</div>
          <h1 className="script-flow-header__title">Script Flow</h1>
        </div>
        <div className="script-flow-header__actions">
          <button className="script-flow-button" onClick={() => setCrashRequested(true)} type="button">
            Test fallback
          </button>
        </div>
      </header>

      <main className="script-flow-surface">
        <section className="script-flow-state-card">
          <div className="script-flow-state-card__label">{formatStatusLabel(state.status)}</div>
          <h2 className="script-flow-state-card__title">{state.title}</h2>
          <p className="script-flow-state-card__text">{state.description}</p>

          {"source" in state ? (
            <dl className="script-flow-meta">
              <div className="script-flow-meta__item">
                <dt>File</dt>
                <dd>{state.source.fileName}</dd>
              </div>
              <div className="script-flow-meta__item">
                <dt>Language</dt>
                <dd>{state.source.languageId}</dd>
              </div>
              <div className="script-flow-meta__item">
                <dt>Extension</dt>
                <dd>{state.source.extension}</dd>
              </div>
              <div className="script-flow-meta__item">
                <dt>Scope</dt>
                <dd>{state.scope === "selection" ? "Selection only" : "Whole file"}</dd>
              </div>
            </dl>
          ) : null}

          {state.status === "loading" && state.selection ? (
            <div className="script-flow-selection">
              <div className="script-flow-selection__title">Selected range</div>
              <div className="script-flow-selection__text">
                Lines {state.selection.startLine}-{state.selection.endLine}, columns {state.selection.startColumn}-{state.selection.endColumn}
              </div>
              <div className="script-flow-selection__text">{state.selection.charCount} characters queued for parsing</div>
            </div>
          ) : null}

          {state.status === "unsupported" ? (
            <div className="script-flow-pill-row">
              {state.supportedExtensions.map((extension) => (
                <span className="script-flow-pill" key={extension}>
                  {extension}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="script-flow-panel">
          <div className="script-flow-panel__eyebrow">What happens next</div>
          {state.status === "loading" ? (
            <>
              <h3 className="script-flow-panel__title">Shell is ready, parser contract lands next.</h3>
              <p className="script-flow-panel__text">
                Opening the panel is the only moment that touches the active editor. No background parsing runs before this command.
              </p>
            </>
          ) : null}
          {state.status === "empty" ? (
            <>
              <h3 className="script-flow-panel__title">Choose a source before opening the shell.</h3>
              <p className="script-flow-panel__text">
                Use the command palette or editor context menu from a supported file to initialize Script Flow on demand.
              </p>
            </>
          ) : null}
          {state.status === "unsupported" ? (
            <>
              <h3 className="script-flow-panel__title">This surface only opens mapped languages.</h3>
              <p className="script-flow-panel__text">
                Switch to a TypeScript, TSX, Python, or SQL file and reopen the panel. Script Flow stays isolated from Graph, Notes, and Logs.
              </p>
            </>
          ) : null}
          {state.status === "error" ? (
            <>
              <h3 className="script-flow-panel__title">The shell received a parser error state.</h3>
              <p className="script-flow-panel__text">
                This placeholder state is reachable without a full parser by adding the marker <code>cortex:script-flow-error</code> to the source.
              </p>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function formatStatusLabel(status: ScriptFlowInitPayload["status"]) {
  switch (status) {
    case "empty":
      return "Empty state";
    case "loading":
      return "Loading shell";
    case "error":
      return "Parser error";
    case "unsupported":
      return "Unsupported file";
  }
}

function isScriptFlowState(value: unknown): value is ScriptFlowInitPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScriptFlowInitPayload>;
  return candidate.status === "empty" || candidate.status === "loading" || candidate.status === "error" || candidate.status === "unsupported";
}
