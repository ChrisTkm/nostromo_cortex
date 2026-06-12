import { loadConfig } from "@cortex/core";
import { MongoClient } from "mongodb";
import { execSync } from "node:child_process";

/* ------------------------------------------------------------------ */
/*  Evidence parser (pure, testable)                                   */
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

export function findAgentInText(text: string): string | null {
  for (const [re, slug] of AGENT_PATTERNS) {
    if (re.test(text)) return slug;
  }
  return null;
}

export function findAgentInLines(lines: string[], taskCode: string): string | null {
  const taskLine = lines.find((l) => l.includes(taskCode));
  if (!taskLine) return null;
  return findAgentInText(taskLine);
}

export function parseCommitBody(body: string): string | null {
  return findAgentInText(body);
}

export type EvidenceSource = "detail" | "prompt" | "plan_notes" | "git_commit";

export interface Evidence {
  source: EvidenceSource;
  agent: string;
}

export function resolveAgent(evidence: Evidence[]): { agent: string | null; conflict: boolean } {
  const agents = [...new Set(evidence.map((e) => e.agent))];
  if (agents.length === 0) return { agent: null, conflict: false };
  if (agents.length === 1) return { agent: agents[0]!, conflict: false };
  return { agent: null, conflict: true };
}

/* ------------------------------------------------------------------ */
/*  Git evidence                                                       */
/* ------------------------------------------------------------------ */

function gitLogForTask(taskCode: string): string | null {
  try {
    const buf = execSync(`git log --grep="${taskCode}" --format=%B --max-count=5`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return buf || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

interface BackfillReport {
  candidatas: number;
  atribuidas: Record<string, number>;
  conflictos: number;
  sin_evidencia: number;
}

async function main() {
  const flags = process.argv.slice(2);
  const isDryRun = !flags.includes("--apply");

  const config = loadConfig();
  const mongoUrl = process.env.MONGO_URL ?? config.mongoUrl;
  const dbName = process.env.MONGO_DB_NAME ?? config.mongoDbName;
  const tasksCollection = process.env.MONGO_TASKS_COLLECTION ?? config.mongoTasksCollection;
  const plansCollection = process.env.MONGO_PLANS_COLLECTION ?? "action_plans";

  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db(dbName);

  const report: BackfillReport = { candidatas: 0, atribuidas: {}, conflictos: 0, sin_evidencia: 0 };

  try {
    /* load action plans into a map: plan_code → notes text */
    const planDocs = await db.collection(plansCollection).find({}).toArray();
    const planNotes = new Map<string, string>();
    for (const doc of planDocs) {
      const code = (doc as Record<string, unknown>).code as string | undefined;
      const notes = (doc as Record<string, unknown>).notes as string | undefined;
      if (code && notes) planNotes.set(code, notes);
    }

    /* find candidates: status=DONE, agent=any */
    const candidates = await db
      .collection(tasksCollection)
      .find({ status: "DONE", agent: "any" })
      .toArray();

    report.candidatas = candidates.length;
    if (candidates.length === 0) {
      console.log("No candidate tasks found (status=DONE, agent=any).");
      return;
    }

    const bulk: { code: string; agent: string }[] = [];

    for (const doc of candidates) {
      const record = doc as Record<string, unknown>;
      const code = record.code as string;
      const detail = (record.detail as string) ?? "";
      const prompt = (record.prompt as string) ?? "";
      const planCode = record.plan_code as string | undefined;

      const evidence: Evidence[] = [];

      /* 1. detail / prompt */
      const fromDetail = findAgentInText(detail);
      if (fromDetail) evidence.push({ source: "detail", agent: fromDetail });

      const fromPrompt = findAgentInText(prompt);
      if (fromPrompt) evidence.push({ source: "prompt", agent: fromPrompt });

      /* 2. plan notes */
      if (planCode && planNotes.has(planCode)) {
        const fromPlan = findAgentInLines(planNotes.get(planCode)!.split("\n"), code);
        if (fromPlan) evidence.push({ source: "plan_notes", agent: fromPlan });
      }

      /* 3. git log */
      const commitBody = gitLogForTask(code);
      if (commitBody) {
        const fromGit = parseCommitBody(commitBody);
        if (fromGit) evidence.push({ source: "git_commit", agent: fromGit });
      }

      const { agent, conflict } = resolveAgent(evidence);

      if (conflict) {
        report.conflictos++;
        const slugs = [...new Set(evidence.map((e) => e.agent))].join(" vs ");
        console.warn(`conflict: ${code} — ${slugs}`);
        continue;
      }

      if (agent) {
        bulk.push({ code, agent });
        report.atribuidas[agent] = (report.atribuidas[agent] ?? 0) + 1;
      } else {
        report.sin_evidencia++;
      }
    }

    /* apply */
    if (bulk.length > 0) {
      if (isDryRun) {
        console.log(`[dry-run] would update ${bulk.length} tasks`);
      } else {
        const now = new Date().toISOString();
        for (const { code, agent } of bulk) {
          await db.collection(tasksCollection).updateOne(
            { code },
            { $set: { agent, updated_at: now } }
          );
        }
        console.log(`[apply] updated ${bulk.length} tasks`);
      }
    }

    if (isDryRun) {
      console.log("── dry-run (no writes) ──");
    }

    console.log(`Candidatas:      ${report.candidatas}`);
    console.log(`Atribuidas:       ${Object.values(report.atribuidas).reduce((a, b) => a + b, 0)}`);
    for (const [slug, count] of Object.entries(report.atribuidas).sort()) {
      console.log(`  ${slug}: ${count}`);
    }
    console.log(`Conflictos:       ${report.conflictos}`);
    console.log(`Sin evidencia:    ${report.sin_evidencia}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
