import "../styles/tokens.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NotesApp } from "./NotesApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing required root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <NotesApp />
  </StrictMode>
);
