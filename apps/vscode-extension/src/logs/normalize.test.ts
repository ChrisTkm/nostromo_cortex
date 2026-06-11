import { describe, expect, it } from "vitest";
import { normalizeLogDocument } from "./normalize";

describe("buildSummary extra keys", () => {
  it("event=INSERT with rows and table injects key=value pairs", () => {
    const result = normalizeLogDocument({
      event: "INSERT",
      rows: 8,
      table: "impuesto_2cat",
      process: "impuesto_2cat_runner",
      message: "Inserting rows",
    });
    expect(result.summary).toContain("rows=8");
    expect(result.summary).toContain("table=impuesto_2cat");
  });

  it("event=API with endpoint and status injects key=value pairs", () => {
    const result = normalizeLogDocument({
      event: "API",
      endpoint: "https://www.sii.cl/consulta",
      status: 200,
      process: "currency_loader",
      message: "API call",
    });
    expect(result.summary).toContain("endpoint=https://www.sii.cl/consulta");
    expect(result.summary).toContain("status=200");
  });

  it("event=MOVE_FILE_START with file injects file=...", () => {
    const result = normalizeLogDocument({
      event: "MOVE_FILE_START",
      file: "AA00393.pdf",
      process: "cargas_sii",
      message: "Moving file",
    });
    expect(result.summary).toContain("file=AA00393.pdf");
  });

  it("event with no entry in EVENT_SUMMARY_KEYS (e.g. INFO) produces same summary as before", () => {
    const result = normalizeLogDocument({
      event: "INFO",
      message: "Operation completed",
      process: "worker",
      source: "worker",
    });
    expect(result.summary).toBe("INFO - Operation completed (worker)");
  });

  it("event=INSERT but without rows/table in record adds nothing extra", () => {
    const result = normalizeLogDocument({
      event: "INSERT",
      message: "No rows data",
      process: "loader",
    });
    expect(result.summary).toBe("INSERT - No rows data (loader)");
  });

  it("no event produces same summary as before", () => {
    const result = normalizeLogDocument({
      message: "Plain message",
      process: "worker",
    });
    expect(result.summary).toBe("Plain message (worker)");
  });

  it("value longer than MAX_SUMMARY_VALUE_LENGTH is omitted", () => {
    const longFile = "a".repeat(200);
    const result = normalizeLogDocument({
      event: "MOVE_FILE_START",
      file: longFile,
      process: "cargas_sii",
      message: "Moving file",
    });
    expect(result.summary).not.toContain("file=");
  });
});
