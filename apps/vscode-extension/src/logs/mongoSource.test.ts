import { describe, expect, it, vi } from "vitest";
import { MongoLogsSource } from "./mongoSource.js";
import { LOGS_INDEX_DEFINITIONS } from "./source.js";

function mockCollection() {
  const toArray = vi.fn().mockResolvedValue([]);
  const limit = vi.fn(() => ({ toArray }));
  const sort = vi.fn(() => ({ limit }));
  const find = vi.fn(() => ({ sort }));
  const createIndexes = vi.fn().mockResolvedValue("ok");
  const watch = vi.fn();
  return { find, createIndexes, watch };
}

describe("MongoLogsSource", () => {
  it("list queries collection with limit", async () => {
    const collection = mockCollection();
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
    );
    await source.list({ limit: 100 });
    expect(collection.find).toHaveBeenCalledWith({});
    expect(collection.find().sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(collection.find().sort().limit).toHaveBeenCalledWith(100);
  });

  it("list applies beforeTimestamp filter", async () => {
    const collection = mockCollection();
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
    );
    await source.list({
      limit: 50,
      beforeTimestamp: "2026-06-07T00:00:00.000Z",
    });
    expect(collection.find).toHaveBeenCalledWith({
      timestamp: { $lt: "2026-06-07T00:00:00.000Z" },
    });
  });

  it("ensureIndexes creates indexes from definitions", async () => {
    const collection = mockCollection();
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
    );
    await source.ensureIndexes();
    expect(collection.createIndexes).toHaveBeenCalledWith([
      ...LOGS_INDEX_DEFINITIONS,
    ]);
  });

  it("dispose does not throw", async () => {
    const collection = mockCollection();
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
    );
    await expect(source.dispose()).resolves.toBeUndefined();
  });

  it("subscribe returns null when changeStreamsEnabled is false", async () => {
    const collection = mockCollection();
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
      { changeStreamsEnabled: false },
    );
    const result = await source.subscribe(vi.fn());
    expect(result).toBeNull();
  });

  it("subscribe returns cleanup when watch succeeds", async () => {
    const stream = { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    const collection = {
      ...mockCollection(),
      watch: vi.fn().mockReturnValue(stream),
    };
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
      { changeStreamsEnabled: true },
    );
    const cleanup = await source.subscribe(vi.fn());
    expect(cleanup).toBeInstanceOf(Function);
    expect(collection.watch).toHaveBeenCalledWith(
      [{ $match: { operationType: "insert" } }],
      { fullDocument: "updateLookup" },
    );
    await cleanup!();
    expect(stream.close).toHaveBeenCalled();
  });

  it("subscribe returns null when watch throws", async () => {
    const collection = {
      ...mockCollection(),
      watch: vi.fn().mockImplementation(() => {
        throw new Error("no replica set");
      }),
    };
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
      { changeStreamsEnabled: true },
    );
    const result = await source.subscribe(vi.fn());
    expect(result).toBeNull();
  });

  it("subscribe insert event triggers onAppend with normalized doc", async () => {
    const changeHandler = {
      current: undefined as ((event: any) => void) | undefined,
    };
    const stream = {
      on: vi.fn((event: string, handler: any) => {
        if (event === "change") changeHandler.current = handler;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const collection = {
      ...mockCollection(),
      watch: vi.fn().mockReturnValue(stream),
    };
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
      { changeStreamsEnabled: true },
    );
    const onAppend = vi.fn();
    await source.subscribe(onAppend);

    changeHandler.current!({
      operationType: "insert",
      fullDocument: {
        _id: "new-id",
        timestamp: "2026-06-07T12:00:00.000Z",
        level: "INFO",
        source: "test",
        message: "inserted",
      },
    });

    expect(onAppend).toHaveBeenCalledTimes(1);
    expect(onAppend).toHaveBeenCalledWith([
      expect.objectContaining({ source: "test", message: "inserted" }),
    ]);
  });

  it("subscribe non-insert event does not trigger onAppend", async () => {
    const changeHandler = {
      current: undefined as ((event: any) => void) | undefined,
    };
    const stream = {
      on: vi.fn((event: string, handler: any) => {
        if (event === "change") changeHandler.current = handler;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const collection = {
      ...mockCollection(),
      watch: vi.fn().mockReturnValue(stream),
    };
    const source = new MongoLogsSource(
      () => Promise.resolve(collection as any),
      LOGS_INDEX_DEFINITIONS,
      { changeStreamsEnabled: true },
    );
    const onAppend = vi.fn();
    await source.subscribe(onAppend);

    changeHandler.current!({
      operationType: "delete",
      fullDocument: { _id: "deleted" },
    });

    expect(onAppend).not.toHaveBeenCalled();
  });
});
