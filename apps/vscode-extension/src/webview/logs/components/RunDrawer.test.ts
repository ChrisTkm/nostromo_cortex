import { describe, expect, it } from "vitest";
import { formatDuration, runStatusClass, runStatusIcon } from "../state";

describe("RunDrawer helpers", () => {
  it("formatDuration: undefined returns em dash", () => {
    expect(formatDuration(undefined)).toBe("—");
  });

  it("formatDuration: under 1s shows ms", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("runStatusIcon: ok returns checkmark", () => {
    expect(runStatusIcon("ok")).toBe("✓");
  });

  it("runStatusIcon: error returns X", () => {
    expect(runStatusIcon("error")).toBe("✗");
  });

  it("runStatusIcon: abierta returns clock", () => {
    expect(runStatusIcon("abierta")).toBe("◷");
  });

  it("runStatusClass: ok returns correct class", () => {
    expect(runStatusClass("ok")).toBe("logs-run-status--ok");
  });

  it("runStatusClass: error returns correct class", () => {
    expect(runStatusClass("error")).toBe("logs-run-status--error");
  });

  it("runStatusClass: abierta returns correct class", () => {
    expect(runStatusClass("abierta")).toBe("logs-run-status--abierta");
  });
});
