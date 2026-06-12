import { readFile } from "node:fs/promises";

async function loadConfig(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function heavyComputation(): number {
  for (let i = 0; i < 1e6; i++) {
    Math.sqrt(i);
  }
  return 42;
}

function voidSideEffect(): void {
  // This function has no explicit return
  console.log("side effect");
}
