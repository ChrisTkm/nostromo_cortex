import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SnapshotNode } from "../types";
import { Drawer } from "./Drawer";

const sampleNode: SnapshotNode = {
  id: "TASK-1",
  code: "TASK-1",
  label: "Edit the selected graph task",
  detail: "Existing graph task detail",
  status: "PENDING",
  severity: "LOW",
  agent: "codex",
  createdAt: "2026-04-20T10:00:00.000Z",
  updatedAt: "2026-04-20T11:00:00.000Z",
  dependsOn: ["TASK-0"],
  ready: true,
  blockedByCount: 0,
  downstreamCount: 1,
  tags: ["graph"],
  tooltip: "TASK-1"
};

describe("Drawer", () => {
  it("shows an Edit task action in the inspector", () => {
    const markup = renderToStaticMarkup(
      createElement(Drawer, {
        activeTab: "inspector",
        filters: {},
        isOpen: true,
        onClearFilters: vi.fn(),
        onClose: vi.fn(),
        onClosePromptPanel: vi.fn(),
        onEditTask: vi.fn(),
        onOpenPromptPanel: vi.fn(),
        onSelectDependency: vi.fn(),
        onTabChange: vi.fn(),
        promptExpanded: false,
        selectedNode: sampleNode
      })
    );

    expect(markup).toContain("Edit task");
    expect(markup).toContain("drawer-task-actions");
  });
});
