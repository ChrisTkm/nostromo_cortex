import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileLogsSource, type FileLogsSourceLogger } from "./fileSource.js";

vi.mock("node:fs", () => ({
  promises: {
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(""),
    stat: vi.fn(),
  },
}));

const logEntries: Array<{
  type: "warn" | "info";
  message: string;
  meta?: Record<string, unknown>;
}> = [];
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

function makeSource(sources: string[]): FileLogsSource {
  return new FileLogsSource({ sources, log: testLogger });
}

function mockDirSource(): void {
  vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => false, isDirectory: () => true } as any);
}
function mockLogFile(size = 100, mtimeMs = 1000): void {
  vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false, size, mtimeMs } as any);
}
function mockStatOnce(size = 100, mtimeMs = 1000): void {
  vi.mocked(fs.stat).mockResolvedValueOnce({ size, mtimeMs } as any);
}

describe("FileLogsSource", () => {
  it("returns empty array when directory does not exist", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
    const source = makeSource(["C:\\dev\\Nostromo\\logs"]);
    expect(await source.list({ limit: 10 })).toEqual([]);
  });

  it("parses valid JSONL lines into LogRecord", async () => {
    mockDirSource();
    mockLogFile();
    mockStatOnce();
    vi.mocked(fs.readdir).mockResolvedValue(["test.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "hello",
      }) + "\n",
    );
    const source = makeSource(["C:\\logs"]);
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2026-06-07T10:00:00.000Z");
    expect(logs[0].level).toBe("INFO");
  });

  it("skips malformed JSON lines in .jsonl silently", async () => {
    mockDirSource();
    mockLogFile();
    mockStatOnce();
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      'not json\n{"timestamp":"2026-06-07T10:00:00.000Z","level":"INFO","source":"app","message":"ok"}\n',
    );
    const source = makeSource(["C:\\logs"]);
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(1);
  });

  it("sorts by timestamp descending", async () => {
    mockDirSource();
    mockLogFile(200);
    mockStatOnce(200);
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "older",
      }) +
        "\n" +
        JSON.stringify({
          timestamp: "2026-06-07T12:00:00.000Z",
          level: "ERROR",
          source: "app",
          message: "newer",
        }) +
        "\n",
    );
    const source = makeSource(["C:\\logs"]);
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("newer");
    expect(logs[1].message).toBe("older");
  });

  it("applies limit", async () => {
    mockDirSource();
    mockLogFile(300);
    mockStatOnce(300);
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({
          timestamp: `2026-06-07T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
          level: "INFO",
          source: "app",
          message: `log ${i}`,
        }),
      ).join("\n") + "\n",
    );
    const source = makeSource(["C:\\logs"]);
    const logs = await source.list({ limit: 3 });
    expect(logs).toHaveLength(3);
  });

  it("applies beforeTimestamp cursor", async () => {
    mockDirSource();
    mockLogFile(200);
    mockStatOnce(200);
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "too old",
      }) +
        "\n" +
        JSON.stringify({
          timestamp: "2026-06-07T12:00:00.000Z",
          level: "INFO",
          source: "app",
          message: "recent",
        }) +
        "\n",
    );
    const source = makeSource(["C:\\logs"]);
    const logs = await source.list({
      limit: 10,
      beforeTimestamp: "2026-06-07T11:00:00.000Z",
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("too old");
  });

  it("caches results while signature is unchanged", async () => {
    mockDirSource();
    mockLogFile();
    mockStatOnce();
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "hello",
      }) + "\n",
    );
    const source = makeSource(["C:\\logs"]);
    await source.list({ limit: 10 });
    // Second call: discoverFiles re-scans (needs 2 stats again + 1 for sig + 1 for mtime)
    mockDirSource();
    mockLogFile();
    mockStatOnce();
    await source.list({ limit: 10 });
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(1);
  });

  it("re-reads when signature changes (mtime changed)", async () => {
    mockDirSource();
    mockLogFile(100, 1000);
    mockStatOnce(100, 1000);
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "hello",
      }) + "\n",
    );
    const source = makeSource(["C:\\logs"]);
    await source.list({ limit: 10 });
    // Second call: same dir but file mtime changed
    mockDirSource();
    mockLogFile(100, 2000);
    mockStatOnce(100, 2000);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "updated",
      }) + "\n",
    );
    await source.list({ limit: 10 });
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(2);
  });

  it("scans multiple source directories", async () => {
    // discoverFiles: dir a, file a, dir b, file b
    mockDirSource();
    mockLogFile();
    mockDirSource();
    mockLogFile();
    // signatureOf: file a, file b
    mockStatOnce();
    mockStatOnce();
    // readAndCache loop mtime: file a, file b
    mockStatOnce();
    mockStatOnce();
    vi.mocked(fs.readdir).mockResolvedValue(["app.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "hello",
      }) + "\n",
    );
    const source = makeSource(["C:\\logs\\a", "C:\\logs\\b"]);
    const logs = await source.list({ limit: 10 });
    expect(logs).toHaveLength(2);
  });

  it("ensureIndexes is no-op", async () => {
    const source = makeSource(["C:\\logs"]);
    await expect(source.ensureIndexes()).resolves.toBeUndefined();
  });

  it("dispose clears cache", async () => {
    mockDirSource();
    mockLogFile();
    mockStatOnce();
    vi.mocked(fs.readdir).mockResolvedValue(["cortex.jsonl"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-06-07T10:00:00.000Z",
        level: "INFO",
        source: "app",
        message: "hello",
      }) + "\n",
    );
    const source = makeSource(["C:\\logs"]);
    await source.list({ limit: 10 });
    await source.dispose();
    // After dispose: cache cleared, re-read needs stat mocks again
    mockDirSource();
    mockLogFile();
    mockStatOnce();
    await source.list({ limit: 10 });
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(2);
  });

  it("logs a warning when a source is unavailable", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
    const source = makeSource(["C:\\missing"]);
    const logs = await source.list({ limit: 10 });
    expect(logs).toEqual([]);
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].type).toBe("warn");
    expect(logEntries[0].message).toBe("fileLogsSource.source_unavailable");
  });
});
