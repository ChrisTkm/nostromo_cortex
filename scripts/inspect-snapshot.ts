import { buildGraphSnapshot, createMongoTaskStore, loadConfig } from "@cortex/core";

async function main() {
  const config = loadConfig();
  const store = createMongoTaskStore({
    mongoUrl: config.mongoUrl,
    dbName: config.mongoDbName,
    collectionName: config.mongoTasksCollection
  });
  const tasks = await store.listTasks();
  console.log(JSON.stringify(buildGraphSnapshot(tasks), null, 2));
  await store.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

