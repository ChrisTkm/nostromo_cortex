import * as vscode from "vscode";

import type { ExtensionTaskService } from "../service.js";
import type { GroupTreeNode } from "../tree.js";

export async function resolveArchivePlanCode(
  service: ExtensionTaskService,
  arg?: string | { planCode?: string; kind?: string; label?: string },
) {
  if (typeof arg === "string" && arg.trim()) {
    return arg.trim();
  }

  const candidate = arg as Partial<GroupTreeNode> | undefined;
  if (candidate?.planCode?.trim()) {
    return candidate.planCode.trim();
  }

  const donePlans = (await service.loadPlans())
    .filter((plan) => String(plan.status).toUpperCase() === "DONE")
    .sort((left, right) => left.code.localeCompare(right.code));
  if (donePlans.length === 0) {
    void vscode.window.showInformationMessage(
      "No DONE plans available to archive.",
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    donePlans.map((plan) => ({
      label: plan.code,
      description: plan.title,
      detail: `${plan.progress.done}/${plan.progress.total} done`,
      planCode: plan.code,
    })),
    {
      title: "Archive DONE plan",
      placeHolder: "Select a completed plan to archive",
    },
  );
  return picked?.planCode;
}

export async function postArchiveList(
  service: ExtensionTaskService,
  getPanel: () => vscode.WebviewPanel | undefined,
) {
  const panel = getPanel();
  if (!panel) {
    return;
  }

  const plans = await service.listArchivedPlans();
  if (getPanel() !== panel) {
    return;
  }
  await panel.webview.postMessage({
    type: "archive:list",
    plans,
  });
}
