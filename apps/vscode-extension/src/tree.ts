import { buildTaskGraph, type TaskGraphNode } from "@cortex/core";
import * as vscode from "vscode";

import type { ExtensionTaskService } from "./service.js";

type TreeNodeKind = "group" | "task";

interface BaseTreeNode {
  kind: TreeNodeKind;
  id: string;
  label: string;
}

interface GroupTreeNode extends BaseTreeNode {
  kind: "group";
  description?: string;
  children: Array<GroupTreeNode | TaskTreeNode>;
}

export interface TaskTreeNode extends BaseTreeNode {
  kind: "task";
  task: TaskGraphNode;
}

function taskDescription(task: TaskGraphNode) {
  const ready = task.ready ? "ready" : task.status.toLowerCase();
  const duration = typeof task.durationEstimate === "number" ? ` · ${task.durationEstimate}h` : "";
  const project = task.project ? ` · ${task.project}` : "";
  const group = task.lane ? ` · ${task.lane}` : "";
  return `${task.agent}${project}${group} · ${ready} · ${task.severity.toLowerCase()}${duration}`;
}

export class CortexTreeProvider implements vscode.TreeDataProvider<GroupTreeNode | TaskTreeNode> {
  private readonly emitter = new vscode.EventEmitter<GroupTreeNode | TaskTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly service: ExtensionTaskService) {}

  refresh() {
    this.emitter.fire();
  }

  async getChildren(element?: GroupTreeNode | TaskTreeNode): Promise<Array<GroupTreeNode | TaskTreeNode>> {
    if (element?.kind === "group") {
      return element.children;
    }
    if (element?.kind === "task") {
      return [];
    }

    const tasks = await this.service.loadTasks();
    const graph = buildTaskGraph(tasks);
    const state = this.service.getFilterState();
    const visible = graph.nodes.filter((node) => {
      if (state.selectedProjects.length > 0 && (!node.project || !state.selectedProjects.includes(node.project))) {
        return false;
      }
      if (state.selectedGroups.length > 0 && (!node.lane || !state.selectedGroups.includes(node.lane))) {
        return false;
      }
      if (state.selectedTags.length > 0 && !node.tags.some((tag) => state.selectedTags.includes(tag))) {
        return false;
      }
      if (state.searchQuery) {
        const haystack = `${node.code} ${node.shortTask} ${node.detail}`.toLowerCase();
        if (!haystack.includes(state.searchQuery.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    const byGroup = groupTasks(visible, groupLabelForTask);

    return toGroupedChildren(byGroup, projectLabelForTask);
  }

  getTreeItem(element: GroupTreeNode | TaskTreeNode): vscode.TreeItem {
    if (element.kind === "group") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.description = element.description;
      return item;
    }

    const item = new vscode.TreeItem(`${element.task.code} · ${element.label}`, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = taskDescription(element.task);
    item.tooltip = new vscode.MarkdownString(
      `**${element.task.code}** — ${element.task.shortTask}\n\nStatus: ${element.task.status}\n\nSeverity: ${element.task.severity}\n\nAgent: ${element.task.agent}\n\nProject: ${element.task.project ?? "—"}\n\nGroup: ${element.task.lane ?? "—"}\n\nDuration: ${element.task.durationEstimate ?? "—"}h\n\nTags: ${element.task.tags.join(", ")}`
    );
    item.contextValue = "cortex.task";
    return item;
  }
}

function groupTasks(tasks: TaskGraphNode[], selector: (task: TaskGraphNode) => string) {
  const map = new Map<string, TaskGraphNode[]>();
  for (const task of tasks) {
    const key = selector(task);
    const bucket = map.get(key) ?? [];
    bucket.push(task);
    map.set(key, bucket);
  }
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function toGroupedChildren(groups: Array<[string, TaskGraphNode[]]>, nestedSelector?: (task: TaskGraphNode) => string): GroupTreeNode[] {
  return groups.map(([group, tasks]) => ({
    kind: "group",
    id: group,
    label: group,
    description: `${tasks.length}`,
    children: nestedSelector ? toNestedChildren(group, tasks, nestedSelector) : sortTasks(tasks).map(toTaskNode)
  }));
}

function toNestedChildren(group: string, tasks: TaskGraphNode[], nestedSelector: (task: TaskGraphNode) => string) {
  const nestedGroups = groupTasks(tasks, nestedSelector);
  if (nestedGroups.length <= 1) {
    return sortTasks(tasks).map(toTaskNode);
  }

  return nestedGroups.map(([nestedGroup, nestedTasks]) => ({
    kind: "group" as const,
    id: `${group}:${nestedGroup}`,
    label: nestedGroup,
    description: `${nestedTasks.length}`,
    children: sortTasks(nestedTasks).map(toTaskNode)
  }));
}

function toTaskNode(task: TaskGraphNode): TaskTreeNode {
  return {
    kind: "task",
    id: task.code,
    label: task.shortTask,
    task
  };
}

function groupLabelForTask(task: TaskGraphNode) {
  return task.lane?.trim() || "(ungrouped)";
}

function projectLabelForTask(task: TaskGraphNode) {
  return task.project?.trim() || "(no project)";
}

function sortTasks(tasks: TaskGraphNode[]) {
  return [...tasks].sort((left, right) => {
    const orderDelta = (left.orderHint ?? Number.MAX_SAFE_INTEGER) - (right.orderHint ?? Number.MAX_SAFE_INTEGER);
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return left.code.localeCompare(right.code);
  });
}
