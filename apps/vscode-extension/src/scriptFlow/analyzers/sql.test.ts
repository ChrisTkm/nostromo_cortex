import { describe, expect, it } from "vitest";
import { analyzeSqlDocument } from "./sql.js";

const run = (source: string) =>
  analyzeSqlDocument({ documentPath: "fixture.sql", source });

describe("analyzeSqlDocument", () => {
  it("parses a single SELECT without regression", () => {
    const snap = run("SELECT id, name FROM users WHERE id = 1;");
    expect(snap.metadata.language).toBe("sql");
    expect(snap.analysis.entryPoints).toHaveLength(1);
    expect(snap.nodes.some((n) => n.kind === "select")).toBe(true);
  });

  it("parses multi-statement CREATE + INSERT + SELECT as 3 entry points", () => {
    const sql = `
      CREATE TABLE users (id INT PRIMARY KEY, name TEXT);
      INSERT INTO users (id, name) VALUES (1, 'ada');
      SELECT name FROM users WHERE id = 1;
    `;
    const snap = run(sql);
    expect(snap.analysis.entryPoints).toHaveLength(3);
    const kinds = snap.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === "select")).toHaveLength(1);
    expect(kinds.filter((k) => k === "call")).toHaveLength(2);
  });

  it("parses a single INSERT without throwing (previously rejected)", () => {
    const snap = run("INSERT INTO logs (msg) VALUES ('hi');");
    expect(snap.analysis.entryPoints).toHaveLength(1);
    expect(snap.nodes[0]?.kind).toBe("call");
    expect(snap.nodes[0]?.label).toMatch(/INSERT/i);
  });

  it("parses pure DDL: CREATE + DROP as 2 entry points", () => {
    const snap = run("CREATE TABLE t (id INT); DROP TABLE t;");
    expect(snap.analysis.entryPoints).toHaveLength(2);
    expect(snap.nodes.every((n) => n.kind === "call")).toBe(true);
  });

  it("extracts target names for non-SELECT statements", () => {
    const snap = run("UPDATE users SET name='x' WHERE id=1;");
    expect(snap.nodes[0]?.label).toMatch(/UPDATE/i);
    expect(snap.nodes[0]?.label).toMatch(/users/i);
  });

  it("throws on invalid SQL (no regression on parser errors)", () => {
    expect(() => run("SELECT FROM WHERE;")).toThrow(/could not parse/);
  });

  it("preserves CTE + JOIN handling when SELECT is part of a multi-statement", () => {
    const sql = `
      CREATE TABLE a (id INT);
      WITH base AS (SELECT id FROM a) SELECT b.id FROM base b JOIN a ON b.id = a.id;
    `;
    const snap = run(sql);
    expect(snap.nodes.some((n) => n.kind === "cte")).toBe(true);
    expect(snap.nodes.some((n) => n.kind === "join")).toBe(true);
  });
});
