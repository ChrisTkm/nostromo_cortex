import { describe, expect, it } from "vitest";
import {
  isScriptFlowHostMessage,
  isScriptFlowWebviewMessage,
  type ScriptFlowHostMessage,
  type ScriptFlowWebviewMessage
} from "./bridge.js";

const minimalSnapshot = {
  metadata: { path: "test.ts", language: "typescript", hash: "abc", parsedAt: "2024-01-01T00:00:00Z" },
  nodes: [{ id: "n1", kind: "entry", label: "start" }],
  edges: [],
  analysis: { entryPoints: ["n1"], summary: "test", decisions: [], loops: [], observations: [] }
};

describe("isScriptFlowHostMessage", () => {
  it("returns true for valid snapshot message", () => {
    const msg: ScriptFlowHostMessage = { type: "scriptFlow:snapshot", snapshot: minimalSnapshot };
    expect(isScriptFlowHostMessage(msg)).toBe(true);
  });

  it("returns true for snapshot message with runtime overlay", () => {
    const msg: ScriptFlowHostMessage = {
      type: "scriptFlow:snapshot",
      snapshot: minimalSnapshot,
      runtimeOverlay: {
        runs: [],
        runsById: {},
        warnings: [],
        acceptedLines: 0,
        skippedLines: 0
      }
    };
    expect(isScriptFlowHostMessage(msg)).toBe(true);
  });

  it("returns true for snapshot message with runtime live state", () => {
    const msg: ScriptFlowHostMessage = {
      type: "scriptFlow:snapshot",
      snapshot: minimalSnapshot,
      runtimeLive: {
        mode: "file-watch",
        status: "watching",
        throttleMs: 750,
        candidateCount: 3,
        tracePath: "sample.ts.scriptflow.trace.jsonl",
        updatedAt: "2026-06-19T21:45:00.000Z",
      }
    };
    expect(isScriptFlowHostMessage(msg)).toBe(true);
  });

  it("returns true for valid error message", () => {
    const msg: ScriptFlowHostMessage = { type: "scriptFlow:error", error: "something broke" };
    expect(isScriptFlowHostMessage(msg)).toBe(true);
  });

  it("returns true for unsupported with language", () => {
    const msg: ScriptFlowHostMessage = { type: "scriptFlow:unsupported", language: "ruby" };
    expect(isScriptFlowHostMessage(msg)).toBe(true);
  });

  it("returns true for unsupported without language", () => {
    const msg: ScriptFlowHostMessage = { type: "scriptFlow:unsupported" };
    expect(isScriptFlowHostMessage(msg)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isScriptFlowHostMessage(null)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isScriptFlowHostMessage("hello")).toBe(false);
  });

  it("returns false for an unknown type", () => {
    expect(isScriptFlowHostMessage({ type: "scriptFlow:unknown" })).toBe(false);
  });

  it("returns false for snapshot with malformed nodes", () => {
    const bad = { type: "scriptFlow:snapshot", snapshot: { ...minimalSnapshot, nodes: [{ id: "n1" }] } };
    expect(isScriptFlowHostMessage(bad)).toBe(false);
  });
});

describe("isScriptFlowWebviewMessage", () => {
  it("returns true for ready", () => {
    const msg: ScriptFlowWebviewMessage = { type: "ready" };
    expect(isScriptFlowWebviewMessage(msg)).toBe(true);
  });

  it("returns true for selectNode with nodeId", () => {
    const msg: ScriptFlowWebviewMessage = { type: "scriptFlow:selectNode", nodeId: "n1" };
    expect(isScriptFlowWebviewMessage(msg)).toBe(true);
  });

  it("returns true for drawerClick with section", () => {
    const msg: ScriptFlowWebviewMessage = { type: "scriptFlow:drawerClick", section: "observations" };
    expect(isScriptFlowWebviewMessage(msg)).toBe(true);
  });

  it("returns true for refresh", () => {
    const msg: ScriptFlowWebviewMessage = { type: "scriptFlow:refresh" };
    expect(isScriptFlowWebviewMessage(msg)).toBe(true);
  });

  it("returns true for openGlossary", () => {
    const msg: ScriptFlowWebviewMessage = { type: "scriptFlow:openGlossary" };
    expect(isScriptFlowWebviewMessage(msg)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isScriptFlowWebviewMessage(null)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isScriptFlowWebviewMessage(42)).toBe(false);
  });

  it("returns false for an unknown type", () => {
    expect(isScriptFlowWebviewMessage({ type: "scriptFlow:unknown" })).toBe(false);
  });

  it("returns false for selectNode without nodeId", () => {
    expect(isScriptFlowWebviewMessage({ type: "scriptFlow:selectNode" })).toBe(false);
  });

  it("returns false for drawerClick without section", () => {
    expect(isScriptFlowWebviewMessage({ type: "scriptFlow:drawerClick" })).toBe(false);
  });
});
