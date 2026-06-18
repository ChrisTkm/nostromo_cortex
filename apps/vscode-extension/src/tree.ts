import * as vscode from "vscode";

import type { ExtensionTaskService } from "./service.js";

export type ControlSection = "modules" | "settings" | "theme" | "status";

type ControlCommand = {
  command: string;
  args?: unknown[];
  title: string;
};

type ControlNodeKind = "section" | "action" | "status";

interface BaseControlNode {
  id: string;
  kind: ControlNodeKind;
  label: string;
  description?: string;
  icon?: string;
}

export interface ControlSectionNode extends BaseControlNode {
  kind: "section";
  section: ControlSection;
  children: ControlTreeNode[];
}

export interface ControlActionNode extends BaseControlNode {
  kind: "action";
  command: ControlCommand;
}

export interface ControlStatusNode extends BaseControlNode {
  kind: "status";
  tooltip?: string;
}

export type ControlTreeNode =
  | ControlSectionNode
  | ControlActionNode
  | ControlStatusNode;

export class CortexTreeProvider implements vscode.TreeDataProvider<ControlTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ControlTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly service: ExtensionTaskService) {}

  refresh() {
    this.emitter.fire();
  }

  getChildren(element?: ControlTreeNode): ControlTreeNode[] {
    if (element?.kind === "section") {
      return element.children;
    }
    if (element) {
      return [];
    }
    return [
      section("modules", "Módulos", "Workspaces", "layout", moduleNodes()),
      section("settings", "Settings", "Configuración", "tools", settingNodes()),
      section("theme", "Theme", currentThemeLabel(), "color-mode", themeNodes()),
      section("status", "Status", statusSummary(this.service), "pulse", statusNodes(this.service)),
    ];
  }

  getTreeItem(element: ControlTreeNode): vscode.TreeItem {
    if (element.kind === "section") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = element.id;
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon(element.icon ?? "folder");
      item.contextValue = `cortex.control.${element.section}`;
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon(element.icon ?? "circle-outline");
    item.contextValue =
      element.kind === "action" ? "cortex.control.action" : "cortex.control.status";

    if (element.kind === "action") {
      item.command = {
        command: element.command.command,
        title: element.command.title,
        arguments: element.command.args,
      };
      item.tooltip = element.description
        ? `${element.label}: ${element.description}`
        : element.label;
    } else {
      item.tooltip = element.tooltip ?? element.description ?? element.label;
    }

    return item;
  }
}

function section(
  section: ControlSection,
  label: string,
  description: string,
  icon: string,
  children: ControlTreeNode[],
): ControlSectionNode {
  return {
    kind: "section",
    id: `section:${section}`,
    section,
    label,
    description,
    icon,
    children,
  };
}

function action(
  id: string,
  label: string,
  description: string,
  icon: string,
  command: string,
  args?: unknown[],
): ControlActionNode {
  return {
    kind: "action",
    id,
    label,
    description,
    icon,
    command: {
      command,
      title: label,
      ...(args ? { args } : {}),
    },
  };
}

function status(
  id: string,
  label: string,
  description: string,
  icon: string,
  tooltip?: string,
): ControlStatusNode {
  return {
    kind: "status",
    id,
    label,
    description,
    icon,
    ...(tooltip ? { tooltip } : {}),
  };
}

function moduleNodes(): ControlTreeNode[] {
  return [
    action("module:graph", "Graph", "PERT, filtros y navegación visual", "type-hierarchy", "cortex.openGraph"),
    action("module:plans", "Plans", "Planificación y wizard", "checklist", "cortex.openPlans"),
    action("module:notes", "Notes", "Notas y recordatorios", "notebook", "cortex.openNotes"),
    action("module:logs", "Logs", "Lectura operacional", "output", "cortex.openLogs"),
    action("module:brain", "Brain", "Grafo de documentación local", "symbol-namespace", "cortex.openBrain"),
    action("module:script-flow", "Script Flow", "Análisis de scripts", "symbol-method", "cortex.openScriptFlow"),
    action("module:ledger", "Ledger", "Runs y costos", "history", "cortex.openLedger"),
    action("module:archive", "Archive", "Planes archivados", "archive", "cortex.openArchive"),
  ];
}

function settingNodes(): ControlTreeNode[] {
  return [
    action("setting:refresh", "Actualizar", "Recargar estado de Cortex", "refresh", "cortex.refresh"),
    action("setting:register-mcp", "Register MCP", "Registrar servidor MCP en el cliente IA", "server", "cortex.registerMCP"),
    action("setting:install-skills", "Install Skills", "Instalar skills de Cortex en el agente IA", "book", "cortex.installSkills"),
    action("setting:database", "Mongo database", "Elegir conexión y colección", "database", "cortex.selectDatabase"),
    action("setting:mongo-url", "Mongo URL", "Guardar connection string", "plug", "cortex.setMongoUrl"),
    action("setting:sample-db", "Bootstrap sample DB", "Crear datos locales de ejemplo", "beaker", "cortex.bootstrapDatabase"),
    action("setting:agent-icon", "AI agent icons", "Asignar icono a un agente", "account", "cortex.setAiAgentIcon"),
    action("setting:cycles", "Dependency cycles", "Abrir reporte de ciclos", "warning", "cortex.listCycles"),
    action(
      "setting:vscode",
      "VS Code settings",
      "Abrir configuración de Cortex",
      "gear",
      "workbench.action.openSettings",
      ["@ext:AlbornozStudio.cortex-local"],
    ),
  ];
}

function themeNodes(): ControlTreeNode[] {
  return [
    action("theme:cortex", "Retro Space", "Tema oscuro por defecto", "color-mode", "cortex.setTheme", ["cortex"]),
    action("theme:light", "Light", "Tema claro", "color-mode", "cortex.setTheme", ["light"]),
    action("theme:vscode", "VS Code", "Sigue el tema del editor", "color-mode", "cortex.setTheme", ["vscode"]),
    action("theme:space", "Space", "Azul profundo con acento cian neón", "color-mode", "cortex.setTheme", ["space"]),
  ];
}

function statusNodes(service: ExtensionTaskService): ControlTreeNode[] {
  const settings = service.getConnectionSettings();
  const filters = service.getFilterState();
  const filterCount =
    filters.selectedProjects.length +
    filters.selectedGroups.length +
    filters.selectedTags.length +
    filters.selectedStatuses.length +
    filters.selectedSeverities.length +
    (filters.searchQuery ? 1 : 0) +
    (filters.selectedPlanCode ? 1 : 0);

  return [
    status(
      "status:database",
      "Database",
      `${settings.mongoDbName}.${settings.mongoTasksCollection}`,
      "database",
      `${settings.mongoUrl}\nTasks: ${settings.mongoTasksCollection}\nPlans: ${settings.mongoPlansCollection}\nNotes: ${settings.mongoNotesCollection}\nLogs: ${settings.mongoLogsCollection}`,
    ),
    status(
      "status:filters",
      "Filters",
      filterCount > 0 ? `${filterCount} active` : "none",
      filterCount > 0 ? "filter-filled" : "filter",
    ),

  ];
}

function currentThemeLabel() {
  const theme = vscode.workspace.getConfiguration("cortex").get<string>("theme", "cortex");
  if (theme === "vscode") return "VS Code";
  if (theme === "light") return "Light";
  if (theme === "space") return "Space";
  return "Retro Space";
}

function statusSummary(service: ExtensionTaskService) {
  const settings = service.getConnectionSettings();
  return `${settings.mongoDbName}.${settings.mongoTasksCollection}`;
}
