import "@xyflow/react/dist/style.css";
import "../styles/tokens.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { MdxGraphApp } from "./MdxGraphApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing required root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <MdxGraphApp />
  </StrictMode>
);
