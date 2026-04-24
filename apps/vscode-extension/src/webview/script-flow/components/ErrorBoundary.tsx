import { Component, type ErrorInfo, type ReactNode } from "react";

import { sendRefresh } from "../../../scriptFlow/bridge.js";
import { vscode } from "../vscodeApi";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Script Flow render error", error, errorInfo);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="script-flow-boundary">
        <div className="script-flow-boundary__eyebrow">Render failure</div>
        <h1 className="script-flow-boundary__title">Script Flow hit an unexpected render error.</h1>
        <p className="script-flow-boundary__text">{this.state.error.message}</p>
        <div className="script-flow-boundary__actions">
          <button className="script-flow-button script-flow-button--primary" onClick={() => sendRefresh(vscode)} type="button">
            Reload panel
          </button>
        </div>
      </div>
    );
  }
}
