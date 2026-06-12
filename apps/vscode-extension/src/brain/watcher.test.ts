import { describe, expect, it, vi } from "vitest";
import { createDebouncedRefresh } from "./watcher.js";

describe("createDebouncedRefresh", () => {
  it("collapses multiple schedules within delay into a single refresh call", () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const { schedule } = createDebouncedRefresh(refresh, 500);

    schedule();
    schedule();
    schedule();

    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents refresh when called before delay elapses", () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const { schedule, cancel } = createDebouncedRefresh(refresh, 500);

    schedule();
    cancel();

    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("fires exactly once after advancing to the delay boundary", () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const { schedule } = createDebouncedRefresh(refresh, 500);

    schedule();

    vi.advanceTimersByTime(499);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("produces two separate calls for schedule + advance, then schedule again + advance", () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const { schedule } = createDebouncedRefresh(refresh, 500);

    schedule();
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);

    schedule();
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
