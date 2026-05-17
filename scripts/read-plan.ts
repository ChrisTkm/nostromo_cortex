import { MongoClient } from "mongodb";

async function main() {
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  try {
    await client.connect();
    const db = client.db("cortex");

    console.log("=== PLAN CORTEX-V015 ===");
    const plan = await db.collection("action_plans").findOne({ code: "CORTEX-V015" });
    if (plan) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log("Plan not found");
    }

    console.log("\n=== TASKS ===");
    const tasks = await db
      .collection("tasks")
      .find({ plan_code: "CORTEX-V015" })
      .sort({ order_hint: 1 })
      .toArray();

    if (tasks.length === 0) {
      console.log("No tasks found");
    } else {
      tasks.forEach((t) => {
        console.log(`\n${t.code}:`);
        console.log(`  Task: ${t.short_task}`);
        console.log(`  Status: ${t.status}`);
        if (t.depends_on?.length) console.log(`  Depends: ${t.depends_on.join(", ")}`);
      });
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
