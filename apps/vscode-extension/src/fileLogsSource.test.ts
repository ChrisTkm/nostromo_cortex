import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileLogsSource, type FileLogsSourceLogger } from "./fileLogsSource.js";

vi.mock("node:fs", () => ({
  promises: {
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(""),
    stat: vi.fn(),
  },
}));

const logEntries: Array<{ type: "warn" | "info"; message: string; meta?: Record<string, unknown> }> = [];
const testLogger: FileLogsSourceLogger = (event) => {
  logEntries.push(event);
};

beforeEach(() => {
  logEntries.length = 0;
  vi.mocked(fs.readdir).mockReset();
  vi.mocked(fs.readFile).mockReset();
  vi.mocked(fs.stat).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSource(filePath: string): FileLogsSource {
  return new FileLogsSource({ filePath, log: testLogger });
}

describe("FileLogsSource", () => {
  it("returns empty array when directory does not exist", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));
    const source = makeSource("C:\\logs\\cortex.jsonl");
    expect(await source.list({ limit: 10 })).toEqual([]);
  });

  it("parses valid JSONL lines into LogRecord", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "hello",
        summary: "hello (app)",
      }) + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2026-06-07T10:00:00.000Z");
    expect(logs[0].level).toBe("INFO");
    expect(logs[0].summary).toBe("hello (app)");
  });

  it("skips malformed JSON lines silently", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      "not json\n{\"timestamp\":\"2026-06-07T10:00:00.000Z\",\"level\":\"INFO\",\"source\":\"app\",\"folder\":\"test\",\"message\":\"ok\",\"summary\":\"ok (app)\"}\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(1);
  });

  it("sorts by timestamp descending", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 200, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "older",
        summary: "older (app)",
      }) + "\n" +
      JSON.stringify({
        timestamp: "2026-06-07T12:00:00.000Z",
        level: "ERROR",
        source: "app",
        folder: "test",
        message: "newer",
        summary: "newer (app)",
      }) + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("newer");
    expect(logs[1].message).toBe("older");
  });

  it("applies limit", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 300, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({
          timestamp: `2026-06-07T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
          level: "INFO",
          source: "app",
          folder: "test",
          message: `log ${i}`,
          summary: `log ${i} (app)`,
        }),
      ).join("\n") + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 3 });
    expect(logs).toHaveLength(3);
  });

  it("applies beforeTimestamp cursor", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 200, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "too old",
        summary: "too old (app)",
      }) + "\n" +
      JSON.stringify({
        timestamp: "2026-06-07T12:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "recent",
        summary: "recent (app)",
      }) + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 10, beforeTimestamp: "2026-06-07T11:00:00.000Z" });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("too old");
  });

  it("caches results while signature is unchanged", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "hello",
        summary: "hello (app)",
      }) + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    await source.list({ limit: 10 });
    await source.list({ limit: 10 });
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(1);
  });

  it("re-reads when signature changes (mtime changed)", async () => {
    let statCalls = 0;
    vi.mocked(fs.stat).mockImplementation(async () => {
      statCalls++;
      return { size: 100, mtimeMs: statCalls === 1 ? 1000 : 2000 } as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "hello",
        summary: "hello (app)",
      }) + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    await source.list({ limit: 10 });
    await source.list({ limit: 10 });
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(2);
  });

  it("discovers rotated files (base.jsonl.1, base.jsonl.2)", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl", "cortex.jsonl.1", "cortex.jsonl.2"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 50, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockImplementation(async (file: unknown) => {
      const name = (file as string).split("\\").pop();
      return JSON.stringify({
        timestamp: `2026-06-07T${name === "cortex.jsonl" ? "12" : name === "cortex.jsonl.1" ? "10" : "08"}:00:00.000Z`,
        level: "INFO",
        source: "app",
        folder: "test",
        message: `from ${name}`,
        summary: `from ${name} (app)`,
      }) + "\n";
    });
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(3);
    expect(logs[0].message).toBe("from cortex.jsonl");
    expect(logs[2].message).toBe("from cortex.jsonl.2");
  });

  it("ensureIndexes is no-op", async () => {
    const source = makeSource("C:\\logs\\cortex.jsonl");
    await expect(source.ensureIndexes()).resolves.toBeUndefined();
  });

  it("dispose clears cache", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        folder: "test",
        message: "hello",
        summary: "hello (app)",
      }) + "\n",
    );
    const source = makeSource("C:\\logs\\cortex.jsonl");
    await source.list({ limit: 10 });
    await source.dispose();
    await source.list({ limit: 10 });
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(2);
  });

  it("logs a warning when a rotated file cannot be read", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    vi.mocked(fs.readFile).mockRejectedValue(new Error("permission denied"));
    const source = makeSource("C:\\logs\\cortex.jsonl");
    const logs = await source.list({ limit: 10 });
    expect(logs).toEqual([]);
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].type).toBe("warn");
    expect(logEntries[0].meta?.file).toMatch(/cortex\.jsonl$/);
  });
});
