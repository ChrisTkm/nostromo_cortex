import { createHash } from "node:crypto";
import path from "node:path";

import { Parser, type AST, type LocationRange, type Select } from "node-sql-parser";

import type { ScriptFlowAnalysis, ScriptFlowEdge, ScriptFlowEdgeKind, ScriptFlowNode, ScriptFlowNodeKind, ScriptFlowSnapshot } from "../types.js";

type ScriptFlowAnalyzerInput = {
  documentPath: string;
  source: string;
};

type SqlDialect = "postgresql" | "mysql";

type ScriptFlowRange = ScriptFlowNode["range"];

type SqlFromItem = {
  as?: string | null;
  db?: string | null;
  expr?: {
    ast?: AST | Select;
    columnList?: string[];
    parentheses?: boolean | { length: number };
    tableList?: string[];
  };
  join?: string;
  loc?: LocationRange;
  on?: unknown;
  schema?: string;
  table?: string;
  using?: string[];
};

type SqlSubqueryCarrier = {
  ast: AST | Select;
  columnList?: string[];
  tableList?: string[];
};

type SearchCursorKey = "cte" | "join";

export function analyzeSqlDocument(input: ScriptFlowAnalyzerInput): ScriptFlowSnapshot {
  const parser = new Parser();
  const parsed = parseSqlDocument(parser, input.documentPath, input.source);
  const analyzer = new SqlFlowAnalyzer(input.documentPath, input.source, parsed.ast, parsed.dialect);
  return analyzer.analyze();
}

function parseSqlDocument(parser: Parser, documentPath: string, source: string) {
  const parseAttempts: Array<{ dialect: SqlDialect; error?: unknown; ast?: AST | AST[] }> = [];

  for (const dialect of ["postgresql", "mysql"] as const) {
    try {
      const ast = parser.astify(source, {
        database: dialect,
        parseOptions: {
          includeLocations: true
        }
      });
      parseAttempts.push({ dialect, ast });
      return {
        ast: unwrapSelectAst(ast, documentPath),
        dialect
      };
    } catch (error) {
      parseAttempts.push({ dialect, error });
    }
  }

  const failureSummary = parseAttempts
    .map((attempt) => `${attempt.dialect}: ${String(attempt.error)}`)
    .join(" | ");

  throw new Error(`SQL analyzer could not parse ${path.basename(documentPath)}. ${failureSummary}`);
}

function unwrapSelectAst(ast: AST | AST[], documentPath: string) {
  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw new Error(`SQL analyzer expects a single SELECT statement in ${path.basename(documentPath)}.`);
    }
    return unwrapSelectAst(ast[0], documentPath);
  }

  if (!isSelectAst(ast)) {
    throw new Error(`SQL analyzer only supports SELECT statements, received ${ast.type} in ${path.basename(documentPath)}.`);
  }

  return ast;
}

class SqlFlowAnalyzer {
  private readonly documentPath: string;
  private readonly source: string;
  private readonly statement: Select;
  private readonly dialect: SqlDialect;
  private readonly nodes: ScriptFlowNode[] = [];
  private readonly edges: ScriptFlowEdge[] = [];
  private readonly entryPoints: string[] = [];
  private readonly observations = new Set<string>();
  private readonly edgeKeys = new Set<string>();
  private readonly idCounters = new Map<string, number>();
  private readonly cteNodeIds = new Map<string, string>();
  private readonly searchOffsets: Record<SearchCursorKey, number> = {
    cte: 0,
    join: 0
  };

  constructor(documentPath: string, source: string, statement: Select, dialect: SqlDialect) {
    this.documentPath = documentPath;
    this.source = source;
    this.statement = statement;
    this.dialect = dialect;
  }

  analyze(): ScriptFlowSnapshot {
    this.createCteNodes();

    const selectId = this.createNode(
      "select",
      "SELECT result",
      "final-select",
      this.createSelectRange(),
      { dialect: this.dialect }
    );
    this.entryPoints.push(selectId);

    this.processSelectBody(selectId, this.statement, "final SELECT");

    return {
      metadata: {
        path: this.documentPath.replace(/\\/g, "/"),
        language: "sql",
        hash: createHash("sha1").update(this.source).digest("hex"),
        parsedAt: new Date().toISOString()
      },
      nodes: this.nodes,
      edges: this.edges,
      analysis: this.buildAnalysis()
    };
  }

  private buildAnalysis(): ScriptFlowAnalysis {
    const fileName = path.basename(this.documentPath);
    const cteCount = this.nodes.filter((node) => node.kind === "cte").length;
    const joinCount = this.nodes.filter((node) => node.kind === "join").length;
    const subqueryCount = this.nodes.filter((node) => node.kind === "subquery").length;
    const summaryLines = [
      `${fileName} parsed as ${this.dialect} SQL with ${cteCount} CTE${cteCount === 1 ? "" : "s"}, ${joinCount} JOIN${
        joinCount === 1 ? "" : "s"
      }, and ${subqueryCount} subquer${subqueryCount === 1 ? "y" : "ies"}.`,
      `${this.observations.size} observation${this.observations.size === 1 ? "" : "s"} flagged while building the pipeline.`
    ];

    return {
      entryPoints: [...new Set(this.entryPoints)],
      summary: summaryLines.join("\n"),
      decisions: [],
      loops: [],
      observations: [...this.observations]
    };
  }

  private createCteNodes() {
    const ctes = this.statement.with ?? [];
    for (const cte of ctes) {
      const cteName = this.readIdentifier(cte.name);
      const cteId = this.createNode("cte", `CTE ${cteName}`, cteName, this.createNamedRange(cteName, "cte"), {
        dialect: this.dialect
      });
      this.cteNodeIds.set(cteName.toLowerCase(), cteId);

      if (hasSelectStar(cte.stmt)) {
        this.observations.add(`SELECT * detected in CTE ${cteName}.`);
      }
    }

    for (const cte of ctes) {
      const cteName = this.readIdentifier(cte.name);
      const cteId = this.cteNodeIds.get(cteName.toLowerCase());
      if (!cteId) {
        continue;
      }
      this.processSelectBody(cteId, cte.stmt, `CTE ${cteName}`);
    }
  }

  private processSelectBody(ownerId: string, select: Select, ownerLabel: string) {
    this.connectReferencedCtes(ownerId, select);

    const joinItems = this.normalizeFrom(select).filter((item) => Boolean(item.join));
    let previousJoinId: string | undefined;

    for (const item of joinItems) {
      const joinLabel = this.buildJoinLabel(item);
      const joinId = this.createNode("join", joinLabel, joinLabel, this.createNamedRange(item.join ?? "JOIN", "join"), {
        joinType: item.join ?? "JOIN",
        target: this.describeFromItem(item)
      });

      if (!previousJoinId) {
        this.addEdge(ownerId, joinId, "flow");
      } else {
        this.addEdge(previousJoinId, joinId, "flow");
      }
      previousJoinId = joinId;

      if (!item.on && !(item.using && item.using.length > 0)) {
        this.observations.add(`Cartesian join detected in ${joinLabel}.`);
      }

      const subqueryCarrier = this.readSubqueryCarrier(item);
      if (subqueryCarrier) {
        const subqueryId = this.createSubqueryNode(subqueryCarrier, joinId, `subquery ${item.as ?? "join"}`);
        this.processSelectBody(subqueryId, unwrapSelectAst(subqueryCarrier.ast, this.documentPath), `${joinLabel} subquery`);
      }
    }

    for (const item of this.normalizeFrom(select).filter((candidate) => !candidate.join)) {
      const subqueryCarrier = this.readSubqueryCarrier(item);
      if (!subqueryCarrier) {
        continue;
      }
      const subqueryId = this.createSubqueryNode(subqueryCarrier, ownerId, `subquery ${item.as ?? "from"}`);
      this.processSelectBody(subqueryId, unwrapSelectAst(subqueryCarrier.ast, this.documentPath), `${ownerLabel} FROM subquery`);
    }

    for (const subqueryCarrier of this.collectWhereInSubqueries(select.where)) {
      const subqueryId = this.createSubqueryNode(subqueryCarrier, ownerId, "subquery IN (...)");
      this.processSelectBody(subqueryId, unwrapSelectAst(subqueryCarrier.ast, this.documentPath), `${ownerLabel} WHERE IN subquery`);
    }
  }

  private connectReferencedCtes(ownerId: string, select: Select) {
    const referencedTables = new Set<string>();
    for (const item of this.normalizeFrom(select)) {
      if (item.table) {
        referencedTables.add(item.table.toLowerCase());
      }
    }

    for (const referencedTable of referencedTables) {
      const cteId = this.cteNodeIds.get(referencedTable);
      if (!cteId || cteId === ownerId) {
        continue;
      }
      this.addEdge(cteId, ownerId, "dataflow");
    }
  }

  private collectWhereInSubqueries(expression: unknown): SqlSubqueryCarrier[] {
    const subqueries: SqlSubqueryCarrier[] = [];
    this.walkWhereExpression(expression, subqueries);
    return subqueries;
  }

  private walkWhereExpression(expression: unknown, bucket: SqlSubqueryCarrier[]) {
    if (!expression || typeof expression !== "object") {
      return;
    }

    if (Array.isArray(expression)) {
      for (const entry of expression) {
        this.walkWhereExpression(entry, bucket);
      }
      return;
    }

    if (isSqlSubqueryCarrier(expression)) {
      bucket.push(expression);
    }

    if (isRecord(expression)) {
      for (const value of Object.values(expression)) {
        this.walkWhereExpression(value, bucket);
      }
    }
  }

  private createSubqueryNode(carrier: SqlSubqueryCarrier, parentId: string, label: string) {
    const select = unwrapSelectAst(carrier.ast, this.documentPath);
    const nodeLabel = this.shorten(label, 56);
    const subqueryId = this.createNode("subquery", nodeLabel, nodeLabel);
    this.addEdge(subqueryId, parentId, "dataflow");

    if (hasSelectStar(select)) {
      this.observations.add(`SELECT * detected in ${nodeLabel}.`);
    }

    this.connectReferencedCtes(subqueryId, select);

    return subqueryId;
  }

  private normalizeFrom(select: Select): SqlFromItem[] {
    if (!select.from) {
      return [];
    }

    return Array.isArray(select.from) ? (select.from as SqlFromItem[]) : ([select.from] as SqlFromItem[]);
  }

  private readSubqueryCarrier(item: SqlFromItem) {
    const carrier = item.expr;
    if (!carrier || !carrier.ast) {
      return undefined;
    }
    return carrier as SqlSubqueryCarrier;
  }

  private buildJoinLabel(item: SqlFromItem) {
    const joinType = item.join ?? "JOIN";
    return `${joinType} ${this.describeFromItem(item)}`;
  }

  private describeFromItem(item: SqlFromItem) {
    if (item.table) {
      return item.table;
    }

    if (item.as) {
      return item.as;
    }

    return "subquery";
  }

  private createSelectRange(): ScriptFlowRange | undefined {
    const startOffset = findTopLevelSelectOffset(this.source);
    if (startOffset === undefined) {
      return this.createDocumentRange();
    }
    return this.offsetsToRange(startOffset, this.source.length);
  }

  private createDocumentRange(): ScriptFlowRange {
    return this.offsetsToRange(0, this.source.length) ?? {
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1
    };
  }

  private createNamedRange(token: string, cursorKey: SearchCursorKey): ScriptFlowRange | undefined {
    const normalizedSource = this.source.toLowerCase();
    const normalizedToken = token.toLowerCase();
    const startIndex = normalizedSource.indexOf(normalizedToken, this.searchOffsets[cursorKey]);

    if (startIndex === -1) {
      return undefined;
    }

    this.searchOffsets[cursorKey] = startIndex + normalizedToken.length;
    return this.offsetsToRange(startIndex, startIndex + normalizedToken.length);
  }

  private offsetsToRange(startOffset: number, endOffset: number): ScriptFlowRange | undefined {
    const start = this.offsetToLineColumn(startOffset);
    const end = this.offsetToLineColumn(Math.max(startOffset, endOffset));

    if (!start || !end) {
      return undefined;
    }

    return {
      startLine: start.line,
      startCol: start.column,
      endLine: end.line,
      endCol: end.column
    };
  }

  private offsetToLineColumn(offset: number) {
    const safeOffset = Math.max(0, Math.min(offset, this.source.length));
    const slice = this.source.slice(0, safeOffset);
    const lines = slice.split(/\r?\n/);
    return {
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1
    };
  }

  private readIdentifier(value: unknown) {
    if (typeof value === "string") {
      return value;
    }
    if (isRecord(value) && typeof value.value === "string") {
      return value.value;
    }
    return "cte";
  }

  private createNode(
    kind: ScriptFlowNodeKind,
    label: string,
    seed: string,
    range?: ScriptFlowRange,
    meta?: Record<string, unknown>
  ) {
    const id = this.createId(kind, seed);
    this.nodes.push({
      id,
      kind,
      label: this.shorten(label, 56),
      ...(range ? { range } : {}),
      ...(meta ? { meta } : {})
    });
    return id;
  }

  private createId(kind: ScriptFlowNodeKind, seed: string) {
    const prefix = kind === "tryCatch" ? "try" : kind;
    const normalizedSeed = this.slugify(seed || kind);
    const base = `${prefix}:${normalizedSeed}`;
    const nextCount = (this.idCounters.get(base) ?? 0) + 1;
    this.idCounters.set(base, nextCount);
    return nextCount === 1 ? base : `${base}-${nextCount}`;
  }

  private addEdge(from: string, to: string, kind: ScriptFlowEdgeKind, label?: string) {
    const key = `${from}|${to}|${kind}|${label ?? ""}`;
    if (this.edgeKeys.has(key)) {
      return;
    }

    this.edgeKeys.add(key);
    this.edges.push({
      from,
      to,
      kind,
      ...(label ? { label } : {})
    });
  }

  private shorten(value: string, maxLength: number) {
    return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
  }

  private slugify(value: string) {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "node"
    );
  }
}

function hasSelectStar(select: Select) {
  return select.columns.some((column) => isRecord(column) && isRecord(column.expr) && column.expr.type === "column_ref" && column.expr.column === "*");
}

function isSelectAst(value: unknown): value is Select {
  return isRecord(value) && value.type === "select";
}

function isSqlSubqueryCarrier(value: unknown): value is SqlSubqueryCarrier {
  return isRecord(value) && "ast" in value && isSelectAst(value.ast);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

function findTopLevelSelectOffset(source: string) {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChars = source.slice(index, index + 6).toLowerCase();

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) {
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && nextChars === "select" && isWordBoundary(source[index - 1]) && isWordBoundary(source[index + 6])) {
      return index;
    }
  }

  return undefined;
}

function isWordBoundary(value: string | undefined) {
  return value === undefined || /[^a-z0-9_]/i.test(value);
}
