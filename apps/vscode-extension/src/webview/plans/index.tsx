import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PlansApp } from "./PlansApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing required root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <PlansApp />
  </StrictMode>
);
