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

describe("canonical event synonyms", () => {
  it("maps severity -> level", () => {
    const result = normalizeLogDocument({ severity: "ERROR", message: "fail", process: "test" });
    expect(result.level).toBe("ERROR");
  });

  it("maps proc -> process", () => {
    const result = normalizeLogDocument({ proc: "worker", message: "x" });
    expect(result.process).toBe("worker");
  });

  it("maps created_at -> timestamp", () => {
    const result = normalizeLogDocument({ created_at: "2026-06-07T10:00:00Z", message: "x", source: "a" });
    expect(result.timestamp).toBe("2026-06-07T10:00:00.000Z");
  });

  it("original key wins over synonym when both present", () => {
    const result = normalizeLogDocument({ level: "WARN", severity: "ERROR", message: "test", source: "a" });
    expect(result.level).toBe("WARN");
  });
});

describe("canonical event duration_ms", () => {
  it("duration_ms as number is captured", () => {
    const result = normalizeLogDocument({ event: "END", duration_ms: 1234, message: "done", process: "test" });
    expect(result.durationMs).toBe(1234);
  });

  it("duration_ms as string is parsed", () => {
    const result = normalizeLogDocument({ event: "END", duration_ms: "5678", message: "done", process: "test" });
    expect(result.durationMs).toBe(5678);
  });
});

describe("canonical event facets", () => {
  it("populates facets object when facet fields present", () => {
    const result = normalizeLogDocument({
      event: "END", message: "loaded", process: "test",
      source: "db", target: "csv", operation: "extract",
      rows_read: 100, rows_inserted: 50, entity: "users",
    });
    expect(result.facets?.source).toBe("db");
    expect(result.facets?.target).toBe("csv");
    expect(result.facets?.operation).toBe("extract");
    expect(result.facets?.rowsRead).toBe(100);
    expect(result.facets?.rowsInserted).toBe(50);
    expect(result.facets?.entity).toBe("users");
  });

  it("omits facets when no facet fields present", () => {
    const result = normalizeLogDocument({ message: "plain", process: "x" });
    expect(result.facets).toBeUndefined();
  });
});

describe("canonical event context", () => {
  it("populates context object when context fields present", () => {
    const result = normalizeLogDocument({
      message: "run", process: "test",
      host: "server01", project: "cortex", script: "loader.py", env: "production",
    });
    expect(result.context?.host).toBe("server01");
    expect(result.context?.project).toBe("cortex");
    expect(result.context?.script).toBe("loader.py");
    expect(result.context?.env).toBe("production");
  });

  it("omits context when no context fields present", () => {
    const result = normalizeLogDocument({ message: "plain", process: "x" });
    expect(result.context).toBeUndefined();
  });
});
