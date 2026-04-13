import { buildTaskGraph, createMongoTaskStore, loadConfig } from "@cortex/core";

async function main() {
  const config = loadConfig();
  const store = createMongoTaskStore({
    mongoUrl: config.mongoUrl,
    dbName: config.mongoDbName,
    collectionName: config.mongoTasksCollection
  });
  const tasks = await store.listTasks();
  const graph = buildTaskGraph(tasks);

  if (graph.cycles.length === 0) {
    console.log("No dependency cycles detected.");
  } else {
    console.error("Dependency cycles detected:");
    for (const cycle of graph.cycles) {
      console.error(`- ${cycle.path.join(" -> ")}`);
    }
    process.exitCode = 2;
  }

  await store.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

