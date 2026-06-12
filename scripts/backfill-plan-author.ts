import { loadConfig } from "@cortex/core";
import { MongoClient } from "mongodb";

/* ------------------------------------------------------------------ */
/*  Agent inference from notes text                                    */
/* ------------------------------------------------------------------ */

const AGENT_PATTERNS: [RegExp, string][] = [
  [/\bcodex\b/i, "codex"],
  [/\bgithub[-\s]?copilot\b|\bcopilot\b/i, "copilot"],
  [/\bclaude[-\s]code\b/i, "claude-code"],
  [/\bclaude\b/i, "claude"],
  [/\bbig[-\s]?pickle\b/i, "big-pickle"],
  [/\bcursor\b/i, "cursor"],
  [/\bgemini\b/i, "gemini"]
];

function inferAgentFromText(text: string): string | null {
  for (const [re, slug] of AGENT_PATTERNS) {
    if (re.test(text)) return slug;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

interface Report {
  total: number;
  updatedAuthor: number;
  updatedAgent: number;
  alreadySet: number;
}

async function main() {
  const flags = process.argv.slice(2);
  const isDryRun = !flags.includes("--apply");

  const config = loadConfig();
  const mongoUrl = process.env.MONGO_URL ?? config.mongoUrl;
  const dbName = process.env.MONGO_DB_NAME ?? config.mongoDbName;
  const plansCollection = process.env.MONGO_PLANS_COLLECTION ?? "action_plans";

  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db(dbName);

  const report: Report = { total: 0, updatedAuthor: 0, updatedAgent: 0, alreadySet: 0 };

  try {
    const plans = await db.collection(plansCollection).find({}).toArray();
    report.total = plans.length;

    const bulk: { code: string; author: string; assigned_agent?: string; updated_at: string }[] = [];

    for (const doc of plans) {
      const record = doc as Record<string, unknown>;
      const code = record.code as string;
      const hasAuthor = typeof record.author === "string" && (record.author as string).trim().length > 0;
      const notes = (record.notes as string) ?? "";
      const currentAgent = record.assigned_agent as string | undefined;

      if (hasAuthor && (typeof currentAgent === "string" && currentAgent.trim().length > 0)) {
        report.alreadySet++;
        continue;
      }

      const update: { code: string; author: string; assigned_agent?: string; updated_at: string } = {
        code,
        author: "Christian",
        updated_at: new Date().toISOString()
      };

      if (!hasAuthor) {
        report.updatedAuthor++;
      }

      const inferred = inferAgentFromText(notes);
      if (inferred && (!currentAgent || currentAgent.trim().length === 0)) {
        update.assigned_agent = inferred;
        report.updatedAgent++;
      }

      if (update.assigned_agent || !hasAuthor) {
        bulk.push(update);
      } else {
        report.alreadySet++;
      }
    }

    if (bulk.length > 0) {
      if (isDryRun) {
        console.log(`[dry-run] would update ${bulk.length} plans`);
        for (const b of bulk) {
          const parts = [`author=Christian`];
          if (b.assigned_agent) parts.push(`assigned_agent=${b.assigned_agent}`);
          console.log(`  ${b.code} → ${parts.join(", ")}`);
        }
      } else {
        const now = new Date().toISOString();
        for (const b of bulk) {
          const $set: Record<string, unknown> = { author: b.author, updated_at: now };
          if (b.assigned_agent) $set.assigned_agent = b.assigned_agent;
          await db.collection(plansCollection).updateOne(
            { code: b.code },
            { $set }
          );
        }
        console.log(`[apply] updated ${bulk.length} plans`);
      }
    }

    if (isDryRun) {
      console.log("── dry-run (no writes) ──");
    }

    console.log(`Total planes:      ${report.total}`);
    console.log(`Author set:         ${report.updatedAuthor}`);
    console.log(`Agent inferred:     ${report.updatedAgent}`);
    console.log(`Ya tenían ambos:    ${report.alreadySet}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
