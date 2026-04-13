import { createMongoTaskStore, loadConfig, sampleTasks } from "@cortex/core";

async function main() {
  const config = loadConfig();
  const store = createMongoTaskStore({
    mongoUrl: config.mongoUrl,
    dbName: config.mongoDbName,
    collectionName: config.mongoTasksCollection
  });

  const count = await store.upsertTasks(sampleTasks);
  console.log(`Seeded ${count} tasks into ${config.mongoDbName}.${config.mongoTasksCollection}`);
  await store.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

