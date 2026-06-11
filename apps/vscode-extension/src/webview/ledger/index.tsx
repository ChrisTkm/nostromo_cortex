import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LedgerApp } from "./LedgerApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing required root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <LedgerApp />
  </StrictMode>
);
