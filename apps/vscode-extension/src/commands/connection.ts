import { MongoClient } from "mongodb";
import * as vscode from "vscode";

import type { ExtensionTaskService } from "../service.js";

type ConnectionSettings = ReturnType<
  ExtensionTaskService["getConnectionSettings"]
>;

export const MONGO_URL_SECRET_KEY = "cortex.mongoUrl";

export async function migrateLegacyMongoUrlSetting(
  context: vscode.ExtensionContext,
) {
  const config = vscode.workspace.getConfiguration("cortex");
  const legacyMongoUrl = config.get<string>("mongoUrl")?.trim();
  if (!legacyMongoUrl || (await context.secrets.get(MONGO_URL_SECRET_KEY))) {
    return;
  }

  await context.secrets.store(MONGO_URL_SECRET_KEY, legacyMongoUrl);
  await Promise.all([
    config.update("mongoUrl", undefined, vscode.ConfigurationTarget.Workspace),
    config.update("mongoUrl", undefined, vscode.ConfigurationTarget.Global),
  ]);
  void vscode.window.showInformationMessage(
    "Cortex migrated the Mongo URL to secure storage. Use 'Cortex: Set Mongo URL' to update it.",
  );
}

export async function canConnectToMongoUrl(url: string) {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function pickConnectionSettings(
  service: ExtensionTaskService,
  options?: {
    title?: string;
  },
): Promise<ConnectionSettings | undefined> {
  const current = service.getConnectionSettings();
  const mongoUrl =
    (await vscode.window.showInputBox({
      prompt: options?.title ?? "Mongo connection string",
      value: current.mongoUrl,
      ignoreFocusOut: true,
    })) ?? current.mongoUrl;

  const databaseOptions = await safeList(
    service.listDatabaseNames.bind(service),
  );
  const dbPick = await vscode.window.showQuickPick(
    [
      ...databaseOptions.map((database) => ({
        label: database,
        description: "existing database",
      })),
      {
        label: "$(add) Create / type a new database",
        description: "manual entry",
      },
    ],
    {
      title: "Select Mongo database",
      placeHolder: current.mongoDbName,
      ignoreFocusOut: true,
    },
  );
  if (!dbPick) {
    return undefined;
  }

  const mongoDbName =
    dbPick.label === "$(add) Create / type a new database"
      ? ((await vscode.window.showInputBox({
          prompt: "Mongo database name",
          value: current.mongoDbName,
          ignoreFocusOut: true,
        })) ?? current.mongoDbName)
      : dbPick.label;

  const collectionOptions = await safeList(() =>
    service.listCollectionNames({
      mongoUrl,
      mongoDbName,
      mongoTasksCollection: current.mongoTasksCollection,
    }),
  );
  const collectionPick = await vscode.window.showQuickPick(
    [
      ...collectionOptions.map((collection) => ({
        label: collection,
        description: "existing collection",
      })),
      {
        label: "$(add) Create / type a new collection",
        description: "manual entry",
      },
    ],
    {
      title: "Select tasks collection",
      placeHolder: current.mongoTasksCollection,
      ignoreFocusOut: true,
    },
  );
  if (!collectionPick) {
    return undefined;
  }

  const mongoTasksCollection =
    collectionPick.label === "$(add) Create / type a new collection"
      ? ((await vscode.window.showInputBox({
          prompt: "Mongo tasks collection",
          value: current.mongoTasksCollection,
          ignoreFocusOut: true,
        })) ?? current.mongoTasksCollection)
      : collectionPick.label;

  return {
    mongoUrl,
    mongoDbName,
    mongoTasksCollection,
    mongoPlansCollection: current.mongoPlansCollection,
  };
}

export function formatCollectionMessage(
  prefix: string,
  settings: ConnectionSettings,
  inspection: {
    documentCount: number;
    validTaskCount: number;
    skippedCount: number;
  },
) {
  if (inspection.documentCount === 0) {
    return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} is empty.`;
  }
  if (inspection.validTaskCount === 0) {
    return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} has ${inspection.documentCount} docs but 0 valid Cortex tasks.`;
  }
  if (inspection.skippedCount > 0) {
    return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} loaded ${inspection.validTaskCount} tasks and ignored ${inspection.skippedCount} non-task docs.`;
  }
  return `${prefix}: ${settings.mongoDbName}.${settings.mongoTasksCollection} loaded ${inspection.validTaskCount} tasks.`;
}

export async function safeList(loader: () => Promise<string[]>) {
  try {
    return await loader();
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Cortex could not list options automatically: ${String(error)}`,
    );
    return [];
  }
}
