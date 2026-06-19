import { describe, expect, it, beforeAll } from "vitest";
import { analyzePythonDocument } from "./python.js";
import { loadFixture } from "./__fixtures__/helpers.js";

let ready = false;
let skipReason: string | undefined;

const run = (source: string) =>
  analyzePythonDocument({ documentPath: "fixture.py", source });

beforeAll(async () => {
  try {
    await run("x = 1");
    ready = true;
  } catch (error) {
    skipReason = error instanceof Error ? error.message : String(error);
  }
}, 30_000);

function skipIfNotReady(ctx: { skip: (note?: string) => void }) {
  if (!ready) {
    ctx.skip(`Python WASM unavailable: ${skipReason ?? "unknown"}`);
  }
}

describe("analyzePythonDocument", () => {
  it("parses simple function declarations", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("simple-function.py"));
    const fns = snap.nodes.filter((n) => n.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(2);
    expect(fns.some((n) => /greet/i.test(n.label))).toBe(true);
    expect(fns.some((n) => /add/i.test(n.label))).toBe(true);
  });

  it("detects async function declarations", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run("async def fetch_data(): return await call_api()");
    const fn = snap.nodes.find((n) => n.kind === "function");
    expect(fn?.meta?.async).toBe(true);
  });

  it("does NOT flag sync functions as async", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run("def sync_fn(): return 42");
    const fn = snap.nodes.find((n) => n.kind === "function");
    expect(fn?.meta?.async).toBeUndefined();
  });

  it("splits try/except/else/finally with exception types", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("python-try-except.py"));
    const tryNodes = snap.nodes.filter((n) => n.kind === "tryCatch");
    expect(tryNodes.length).toBeGreaterThanOrEqual(4);
    const subKinds = tryNodes.map((n) => n.meta?.subKind as string);
    expect(subKinds).toContain("try");
    expect(subKinds).toContain("except");
    expect(subKinds).toContain("finally");
    const exceptionTypes = tryNodes.map(
      (n) => n.meta?.exceptionType as string | undefined,
    );
    expect(exceptionTypes).toContain("FileNotFoundError");
    expect(exceptionTypes).toContain("PermissionError");
  });

  it("emits observations for loops and I/O", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("python-with-observations.py"));
    expect(snap.analysis.observations.length).toBeGreaterThan(0);
  });

  it("flags broad except handlers", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("python-broad-except.py"));
    const allObs = snap.analysis.observations.join(" ");
    expect(allObs).toMatch(/broad except handler/i);
    const tryNodes = snap.nodes.filter((n) => n.kind === "tryCatch");
    expect(tryNodes.length).toBeGreaterThan(0);
    expect(tryNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({
            autoObservations: expect.arrayContaining([
              expect.objectContaining({
                kind: "flow-gap",
                message: expect.stringMatching(/broad except handler/i),
              }),
            ]),
          }),
        }),
      ]),
    );
  });

  it("flags pass-only loops", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("python-empty-loop.py"));
    const allObs = snap.analysis.observations.join(" ");
    expect(allObs).toMatch(/loop body is pass-only/i);
    const loopNodes = snap.nodes.filter((n) => n.kind === "loop");
    expect(loopNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({
            autoObservations: expect.arrayContaining([
              expect.objectContaining({
                kind: "flow-gap",
                message: expect.stringMatching(/loop body is pass-only/i),
              }),
            ]),
          }),
        }),
      ]),
    );
  });

  it("reports observation naming the function without explicit return", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("python-with-observations.py"));
    const allObs = snap.analysis.observations.join(" ");
    expect(allObs).toMatch(/not_covered/);
    expect(allObs).toMatch(/no explicit return/i);
  });

  it("handles match-case without error", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(`
def handler(status: int) -> str:
    match status:
        case 0: return "ok"
        case 1: return "warn"
        case _: return "unknown"
`);
    expect(snap.nodes.length).toBeGreaterThan(0);
  });

  it("produces entry points from a multi-function file", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(loadFixture("python-with-observations.py"));
    expect(snap.analysis.entryPoints.length).toBeGreaterThanOrEqual(1);
    expect(snap.metadata.language).toBe("python");
  });

  it("creates edges between function calls", async (ctx) => {
    skipIfNotReady(ctx);
    const snap = await run(`
def caller():
    callee()

def callee():
    pass
`);
    expect(snap.edges.length).toBeGreaterThan(0);
  });
});
