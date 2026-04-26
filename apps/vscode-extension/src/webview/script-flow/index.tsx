import "@xyflow/react/dist/style.css";
import "../styles/tokens.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { ScriptFlowApp } from "./ScriptFlowApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing required root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <ScriptFlowApp />
    </ErrorBoundary>
  </StrictMode>
);
