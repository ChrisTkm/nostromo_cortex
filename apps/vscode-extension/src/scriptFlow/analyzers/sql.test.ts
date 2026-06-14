import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeSqlDocument } from "./sql.js";

const FIXTURES = path.resolve(__dirname, "../../../fixtures/script-flow");
const SAMPLE_SQL = readFileSync(path.join(FIXTURES, "sample.sql"), "utf8");

describe("SQL analyzer", () => {
  it("analyzes CTE/WITH, JOIN and subqueries (happy path)", () => {
    const result = analyzeSqlDocument({
      documentPath: "sample.sql",
      source: SAMPLE_SQL,
    });

    expect(result.metadata.language).toBe("sql");

    const ctes = result.nodes.filter((n) => n.kind === "cte");
    expect(ctes.length).toBeGreaterThanOrEqual(2);
    expect(ctes.some((c) => c.label.includes("ledger_totals"))).toBe(true);
    expect(ctes.some((c) => c.label.includes("active_accounts"))).toBe(true);

    const joins = result.nodes.filter((n) => n.kind === "join");
    expect(joins.length).toBeGreaterThanOrEqual(2);
    expect(joins.some((j) => j.label.includes("LEFT JOIN"))).toBe(true);
    expect(joins.some((j) => j.label.includes("INNER JOIN"))).toBe(true);

    const subqueries = result.nodes.filter((n) => n.kind === "subquery");
    expect(subqueries.length).toBeGreaterThanOrEqual(1);

    const selectNodes = result.nodes.filter((n) => n.kind === "select");
    expect(selectNodes).toHaveLength(1);

    const dataflowEdges = result.edges.filter((e) => e.kind === "dataflow");
    expect(dataflowEdges.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);

    expect(result.analysis.summary).toContain("postgresql");
    expect(result.analysis.entryPoints).toHaveLength(1);
  });

  it("analyzes a simple SELECT statement", () => {
    const result = analyzeSqlDocument({
      documentPath: "simple.sql",
      source: "SELECT id, name FROM users WHERE active = 1",
    });

    const selectNodes = result.nodes.filter((n) => n.kind === "select");
    expect(selectNodes).toHaveLength(1);
    expect(result.nodes.filter((n) => n.kind === "join")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.kind === "cte")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.kind === "subquery")).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.analysis.entryPoints).toHaveLength(1);
  });

  it("throws controlled error for empty input", () => {
    expect(() =>
      analyzeSqlDocument({ documentPath: "empty.sql", source: "" }),
    ).toThrow(/SQL analyzer could not parse/);
  });

  it("throws controlled error for non-SELECT statement", () => {
    expect(() =>
      analyzeSqlDocument({
        documentPath: "insert.sql",
        source: "INSERT INTO users(id, name) VALUES (1, 'a')",
      }),
    ).toThrow(/SQL analyzer could not parse/);
  });
});
