import { useEffect, useState } from "react";

import { isScriptFlowHostMessage, sendReady, sendRefresh, sendSelectNode, type ScriptFlowHostMessage } from "../../scriptFlow/bridge.js";
import { isScriptFlowSnapshot, type ScriptFlowSnapshot } from "../../scriptFlow/types.js";

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

type ScriptFlowViewState =
  | {
      status: "empty";
      title: string;
      description: string;
    }
  | {
      status: "unsupported";
      title: string;
      description: string;
      language?: string;
    }
  | {
      status: "error";
      title: string;
      description: string;
    }
  | {
      status: "snapshot";
      title: string;
      description: string;
      snapshot: ScriptFlowSnapshot;
    };

const defaultState: ScriptFlowViewState = {
  status: "empty",
  title: "Waiting for Script Flow",
  description: "Open the validated fixture sample to inspect the Script Flow contract end-to-end."
};

export function ScriptFlowApp() {
  const [state, setState] = useState<ScriptFlowViewState>(() => {
    const persisted = vscode.getState();
    return isScriptFlowState(persisted) ? persisted : defaultState;
  });
  const [crashRequested, setCrashRequested] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>) {
      const message = event.data;
      if (!isScriptFlowHostMessage(message)) {
        return;
      }

      const nextState = mapMessageToState(message);
      setCrashRequested(false);
      setSelectedNodeId(null);
      setState(nextState);
      vscode.setState(nextState);
    }

    window.addEventListener("message", onMessage);
    sendReady(vscode);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (crashRequested) {
    throw new Error("Script Flow crash test requested");
  }

  return (
    <div className={`script-flow-app script-flow-app--${state.status}`}>
      <header className="script-flow-header">
        <div>
          <div className="script-flow-header__eyebrow">Contract shell</div>
          <h1 className="script-flow-header__title">Script Flow</h1>
        </div>
        <div className="script-flow-header__actions">
          <button className="script-flow-button" onClick={() => sendRefresh(vscode)} type="button">
            Reload snapshot
          </button>
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

          {state.status === "snapshot" ? (
            <dl className="script-flow-meta">
              <div className="script-flow-meta__item">
                <dt>File</dt>
                <dd>{state.snapshot.metadata.path}</dd>
              </div>
              <div className="script-flow-meta__item">
                <dt>Language</dt>
                <dd>{state.snapshot.metadata.language}</dd>
              </div>
              <div className="script-flow-meta__item">
                <dt>Hash</dt>
                <dd>{state.snapshot.metadata.hash}</dd>
              </div>
              <div className="script-flow-meta__item">
                <dt>Parsed</dt>
                <dd>{new Date(state.snapshot.metadata.parsedAt).toLocaleString()}</dd>
              </div>
            </dl>
          ) : null}

          {state.status === "snapshot" ? (
            <div className="script-flow-selection">
              <div className="script-flow-selection__title">Analysis shell</div>
              <div className="script-flow-selection__text">{state.snapshot.analysis.summary || "Analysis remains intentionally light in CTX013-04."}</div>
              <div className="script-flow-selection__text">
                {state.snapshot.nodes.length} nodes and {state.snapshot.edges.length} edges crossed the bridge.
              </div>
            </div>
          ) : null}

          {state.status === "unsupported" ? (
            <div className="script-flow-pill-row">
              {["typescript", "python", "sql"].map((language) => (
                <span className="script-flow-pill" key={language}>
                  {language}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="script-flow-panel">
          <div className="script-flow-panel__eyebrow">Bridge output</div>
          {state.status === "snapshot" ? (
            <>
              <h3 className="script-flow-panel__title">Golden snapshot loaded end-to-end.</h3>
              <p className="script-flow-panel__text">
                CTX013-04 validates the contract and message bridge first. Visual flow rendering lands in CTX013-05.
              </p>
              <div className="script-flow-node-list">
                {state.snapshot.nodes.map((node) => (
                  <button
                    className={`script-flow-node${selectedNodeId === node.id ? " script-flow-node--selected" : ""}`}
                    key={node.id}
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      sendSelectNode(vscode, node.id);
                    }}
                    type="button"
                  >
                    <span className="script-flow-node__kind">{node.kind}</span>
                    <span className="script-flow-node__label">{node.label}</span>
                  </button>
                ))}
              </div>
              <pre className="script-flow-json">{JSON.stringify(state.snapshot, null, 2)}</pre>
            </>
          ) : null}
          {state.status === "empty" ? (
            <>
              <h3 className="script-flow-panel__title">Open the validated fixture before parsing anything else.</h3>
              <p className="script-flow-panel__text">
                This phase intentionally wires one golden `.ts` sample through the host and webview before adding real parsers.
              </p>
            </>
          ) : null}
          {state.status === "unsupported" ? (
            <>
              <h3 className="script-flow-panel__title">Only the validated fixture is bridged in this phase.</h3>
              <p className="script-flow-panel__text">
                {state.language
                  ? `The active source resolved to ${state.language}, but CTX013-04 only streams fixtures/script-flow/sample.ts for contract validation.`
                  : "Open fixtures/script-flow/sample.ts to inspect the golden snapshot."}
              </p>
            </>
          ) : null}
          {state.status === "error" ? (
            <>
              <h3 className="script-flow-panel__title">The host failed to deliver a valid Script Flow snapshot.</h3>
              <p className="script-flow-panel__text">{state.description}</p>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function mapMessageToState(message: ScriptFlowHostMessage) {
  if (message.type === "scriptFlow:snapshot") {
    return {
      status: "snapshot",
      title: "Fixture snapshot ready",
      description: "The host loaded the golden Script Flow snapshot and bridged it into the panel.",
      snapshot: message.snapshot
    } satisfies ScriptFlowViewState;
  }

  if (message.type === "scriptFlow:error") {
    return {
      status: "error",
      title: "Bridge delivery failed",
      description: message.error
    } satisfies ScriptFlowViewState;
  }

  return {
    status: "unsupported",
    title: "Script Flow fixture not selected",
    description: "The contract bridge is active, but only the validated sample fixture is wired in CTX013-04.",
    ...(message.language ? { language: message.language } : {})
  } satisfies ScriptFlowViewState;
}

function formatStatusLabel(status: ScriptFlowViewState["status"]) {
  switch (status) {
    case "empty":
      return "Empty state";
    case "snapshot":
      return "Golden snapshot";
    case "error":
      return "Bridge error";
    case "unsupported":
      return "Unsupported source";
  }
}

function isScriptFlowState(value: unknown): value is ScriptFlowViewState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ScriptFlowViewState>;
  if (candidate.status === "empty" || candidate.status === "error") {
    return typeof candidate.title === "string" && typeof candidate.description === "string";
  }
  if (candidate.status === "unsupported") {
    return typeof candidate.title === "string" && typeof candidate.description === "string";
  }
  if (candidate.status === "snapshot") {
    return typeof candidate.title === "string" && typeof candidate.description === "string" && isScriptFlowSnapshot(candidate.snapshot);
  }
  return false;
}
