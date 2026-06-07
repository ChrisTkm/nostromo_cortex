import { describe, expect, it } from "vitest";
import { clampAutoRefreshSeconds } from "./logsAutoRefresh";

describe("clampAutoRefreshSeconds", () => {
  it("negative -> 0", () => expect(clampAutoRefreshSeconds(-5)).toBe(0));
  it("0 -> 0", () => expect(clampAutoRefreshSeconds(0)).toBe(0));
  it("5 -> 5", () => expect(clampAutoRefreshSeconds(5)).toBe(5));
  it("600 -> 600", () => expect(clampAutoRefreshSeconds(600)).toBe(600));
  it("1000 -> 600 (clamp max)", () => expect(clampAutoRefreshSeconds(1000)).toBe(600));
  it("NaN -> 0", () => expect(clampAutoRefreshSeconds(NaN)).toBe(0));
  it("undefined -> 0", () => expect(clampAutoRefreshSeconds(undefined)).toBe(0));
  it("string numeric '15' -> 15", () => expect(clampAutoRefreshSeconds("15")).toBe(15));
});
