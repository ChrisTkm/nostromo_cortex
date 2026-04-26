import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

import type { ScriptFlowAnalysis, ScriptFlowEdge, ScriptFlowNode, ScriptFlowNodeKind, ScriptFlowSnapshot } from "../types.js";

type ScriptFlowAnalyzerInput = {
  documentPath: string;
  source: string;
};

type FlowEndpoint = {
  id: string;
  label?: string;
};

type FlowSegment = {
  entries: string[];
  exits: FlowEndpoint[];
};

const EMPTY_SEGMENT: FlowSegment = {
  entries: [],
  exits: []
};

export function analyzeTypeScriptDocument(input: ScriptFlowAnalyzerInput): ScriptFlowSnapshot {
  const analyzer = new TypeScriptFlowAnalyzer(input.documentPath, input.source);
  return analyzer.analyze();
}

class TypeScriptFlowAnalyzer {
  private readonly sourceFile: ts.SourceFile;
  private readonly documentPath: string;
  private readonly source: string;
  private readonly nodes: ScriptFlowNode[] = [];
  private readonly edges: ScriptFlowEdge[] = [];
  private readonly decisions: ScriptFlowAnalysis["decisions"] = [];
  private readonly loops: ScriptFlowAnalysis["loops"] = [];
  private readonly entryPoints: string[] = [];
  private readonly observations = new Set<string>();
  private readonly edgeKeys = new Set<string>();
  private readonly idCounters = new Map<string, number>();

  constructor(documentPath: string, source: string) {
    this.documentPath = documentPath;
    this.source = source;
    this.sourceFile = ts.createSourceFile(
      documentPath,
      source,
      ts.ScriptTarget.Latest,
      true,
      documentPath.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
  }

  analyze(): ScriptFlowSnapshot {
    const entryId = this.createNode("entry", path.basename(this.documentPath), this.sourceFile, path.basename(this.documentPath));
    const topLevelSegments: FlowSegment[] = [];

    ts.forEachChild(this.sourceFile, (node) => {
      const segment = this.parseTopLevelNode(node);
      if (segment.entries.length > 0) {
        topLevelSegments.push(segment);
      }
    });

    const topLevelFlow = this.sequenceSegments(topLevelSegments);
    this.connect([{ id: entryId }], topLevelFlow.entries);

    return {
      metadata: {
        path: this.documentPath.replace(/\\/g, "/"),
        language: "typescript",
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
    const functionCount = this.nodes.filter((node) => node.kind === "function").length;
    const entryPointCount = [...new Set(this.entryPoints)].length;
    const summaryLines = [
      `${fileName} exposes ${entryPointCount} entry point${entryPointCount === 1 ? "" : "s"} and ${functionCount} function${
        functionCount === 1 ? "" : "s"
      }.`,
      `${this.decisions.length} decision${this.decisions.length === 1 ? "" : "s"} and ${this.loops.length} loop${
        this.loops.length === 1 ? "" : "s"
      } shape the current flow.`
    ];

    if (functionCount === 0 && this.nodes.length > 1) {
      this.observations.add("No top-level function flow was detected in this file.");
    }

    return {
      entryPoints: [...new Set(this.entryPoints)],
      summary: summaryLines.join("\n"),
      decisions: this.decisions,
      loops: this.loops,
      observations: [...this.observations]
    };
  }

  private parseTopLevelNode(node: ts.Node): FlowSegment {
    if (ts.isFunctionDeclaration(node) && node.body) {
      return this.parseFunctionLike(node, node.body, node.name?.text ?? "anonymous", node.parameters, true);
    }

    if (ts.isClassDeclaration(node)) {
      return this.parseClassDeclaration(node);
    }

    if (ts.isVariableStatement(node)) {
      const segments = this.parseTopLevelVariableFunctions(node);
      if (segments.length > 0) {
        return this.sequenceSegments(segments);
      }
    }

    if (ts.isStatement(node)) {
      return this.parseExecutableStatement(node);
    }

    return EMPTY_SEGMENT;
  }

  private parseClassDeclaration(statement: ts.ClassDeclaration): FlowSegment {
    const segments: FlowSegment[] = [];
    const className = statement.name?.text;

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) {
        continue;
      }

      const name = this.readPropertyName(member.name);
      const qualifiedName = className ? `${className}.${name}` : name;
      segments.push(this.parseFunctionLike(member, member.body, qualifiedName, member.parameters, false));
    }

    return this.sequenceSegments(segments);
  }

  private parseTopLevelVariableFunctions(statement: ts.VariableStatement): FlowSegment[] {
    const segments: FlowSegment[] = [];

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) {
        continue;
      }

      const name = ts.isIdentifier(declaration.name) ? declaration.name.text : "anonymous";
      if (ts.isBlock(initializer.body)) {
        segments.push(this.parseFunctionLike(declaration, initializer.body, name, initializer.parameters, true));
        continue;
      }

      const functionId = this.createNode("function", `${name}(${this.formatParameters(initializer.parameters)})`, declaration, name);
      this.entryPoints.push(functionId);
      segments.push({
        entries: [functionId],
        exits: [{ id: functionId }]
      });
    }

    return segments;
  }

  private parseFunctionLike(
    anchorNode: ts.Node,
    body: ts.Block,
    displayName: string,
    parameters: readonly ts.ParameterDeclaration[],
    isEntryPoint: boolean
  ): FlowSegment {
    const functionId = this.createNode("function", `${displayName}(${this.formatParameters(parameters)})`, anchorNode, displayName);
    if (isEntryPoint) {
      this.entryPoints.push(functionId);
    }
    if (!this.hasExplicitReturn(body)) {
      this.observations.add(`Function ${displayName} has no explicit return.`);
    }

    const bodySegment = this.parseStatementList(body.statements);
    this.connect([{ id: functionId }], bodySegment.entries);

    return {
      entries: [functionId],
      exits: [{ id: functionId }]
    };
  }

  private parseStatementList(statements: readonly ts.Statement[]): FlowSegment {
    const segments: FlowSegment[] = [];

    for (const statement of statements) {
      const segment = this.parseExecutableStatement(statement);
      if (segment.entries.length > 0) {
        segments.push(segment);
      }
    }

    return this.sequenceSegments(segments);
  }

  private parseExecutableStatement(statement: ts.Statement): FlowSegment {
    if (ts.isIfStatement(statement)) {
      return this.parseIfStatement(statement);
    }
    if (ts.isSwitchStatement(statement)) {
      return this.parseSwitchStatement(statement);
    }
    if (
      ts.isForStatement(statement) ||
      ts.isForOfStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isWhileStatement(statement) ||
      ts.isDoStatement(statement)
    ) {
      return this.parseLoopStatement(statement);
    }
    if (ts.isTryStatement(statement)) {
      return this.parseTryStatement(statement);
    }
    if (ts.isReturnStatement(statement)) {
      return this.parseReturnStatement(statement);
    }
    if (ts.isBlock(statement)) {
      return this.parseStatementList(statement.statements);
    }

    const call = this.extractImportantCall(statement);
    if (call) {
      return this.parseCallStatement(call);
    }

    return EMPTY_SEGMENT;
  }

  private parseIfStatement(statement: ts.IfStatement): FlowSegment {
    const label = `if ${this.formatExpression(statement.expression)}`;
    const branchId = this.createNode("branch", label, statement, label);
    const branchCount = statement.elseStatement ? 2 : 1;
    this.setNodeMeta(branchId, { branches: branchCount });

    this.decisions.push({
      nodeId: branchId,
      label,
      branches: branchCount
    });

    const thenSegment = this.parseNestedStatement(statement.thenStatement);
    const elseSegment = statement.elseStatement ? this.parseNestedStatement(statement.elseStatement) : EMPTY_SEGMENT;

    if (thenSegment.entries.length > 0) {
      this.connect([{ id: branchId, label: "then" }], thenSegment.entries);
    }
    if (statement.elseStatement && elseSegment.entries.length > 0) {
      this.connect([{ id: branchId, label: "else" }], elseSegment.entries);
    }

    const exits: FlowEndpoint[] = [];
    if (thenSegment.exits.length > 0) {
      exits.push(...thenSegment.exits);
    } else {
      exits.push({ id: branchId, label: "then" });
    }

    if (statement.elseStatement) {
      if (elseSegment.exits.length > 0) {
        exits.push(...elseSegment.exits);
      } else {
        exits.push({ id: branchId, label: "else" });
      }
    } else {
      exits.push({ id: branchId, label: "else" });
    }

    return {
      entries: [branchId],
      exits
    };
  }

  private parseSwitchStatement(statement: ts.SwitchStatement): FlowSegment {
    const label = `switch ${this.formatExpression(statement.expression)}`;
    const branchId = this.createNode("branch", label, statement, label);
    this.setNodeMeta(branchId, { branches: statement.caseBlock.clauses.length });

    this.decisions.push({
      nodeId: branchId,
      label,
      branches: statement.caseBlock.clauses.length
    });

    const exits: FlowEndpoint[] = [];
    for (const clause of statement.caseBlock.clauses) {
      const clauseLabel = ts.isDefaultClause(clause) ? "default" : `case ${this.formatExpression(clause.expression)}`;
      const segment = this.parseStatementList(clause.statements);

      if (segment.entries.length > 0) {
        this.connect([{ id: branchId, label: clauseLabel }], segment.entries);
      }

      if (segment.exits.length > 0) {
        exits.push(...segment.exits);
      } else {
        exits.push({ id: branchId, label: clauseLabel });
      }
    }

    return {
      entries: [branchId],
      exits: exits.length > 0 ? exits : [{ id: branchId }]
    };
  }

  private parseLoopStatement(
    statement: ts.ForStatement | ts.ForOfStatement | ts.ForInStatement | ts.WhileStatement | ts.DoStatement
  ): FlowSegment {
    const label = this.formatLoopLabel(statement);
    const loopId = this.createNode("loop", label, statement, label);
    const loopKind = this.resolveLoopKind(statement);
    this.setNodeMeta(loopId, { kind: loopKind });

    this.loops.push({
      nodeId: loopId,
      label,
      kind: loopKind
    });

    const bodySegment = this.parseNestedStatement(statement.statement);
    if (bodySegment.entries.length > 0) {
      this.connect([{ id: loopId }], bodySegment.entries);
      this.connect(bodySegment.exits, [loopId], "loop");
    }

    return {
      entries: [loopId],
      exits: [{ id: loopId }]
    };
  }

  private parseTryStatement(statement: ts.TryStatement): FlowSegment {
    const tryId = this.createNode("tryCatch", "try / catch", statement, "try-catch");
    const trySegment = this.parseStatementList(statement.tryBlock.statements);
    const catchSegment = statement.catchClause ? this.parseStatementList(statement.catchClause.block.statements) : EMPTY_SEGMENT;
    const finallySegment = statement.finallyBlock ? this.parseStatementList(statement.finallyBlock.statements) : EMPTY_SEGMENT;

    if (statement.catchClause && statement.catchClause.block.statements.length === 0) {
      this.observations.add(`Catch block is empty near line ${this.toRange(statement.catchClause).startLine}.`);
    }

    if (trySegment.entries.length > 0) {
      this.connect([{ id: tryId, label: "try" }], trySegment.entries);
    }
    if (catchSegment.entries.length > 0) {
      this.connect([{ id: tryId, label: "catch" }], catchSegment.entries);
    }

    if (statement.finallyBlock && finallySegment.entries.length > 0) {
      const incoming: FlowEndpoint[] = [];
      if (trySegment.exits.length > 0) {
        incoming.push(...trySegment.exits);
      } else {
        incoming.push({ id: tryId, label: "try" });
      }
      if (catchSegment.exits.length > 0) {
        incoming.push(...catchSegment.exits);
      } else if (statement.catchClause) {
        incoming.push({ id: tryId, label: "catch" });
      }

      this.connect(incoming, finallySegment.entries, "finally");
      return {
        entries: [tryId],
        exits: finallySegment.exits.length > 0 ? finallySegment.exits : [{ id: tryId }]
      };
    }

    const exits: FlowEndpoint[] = [];
    if (trySegment.exits.length > 0) {
      exits.push(...trySegment.exits);
    } else {
      exits.push({ id: tryId, label: "try" });
    }
    if (statement.catchClause) {
      if (catchSegment.exits.length > 0) {
        exits.push(...catchSegment.exits);
      } else {
        exits.push({ id: tryId, label: "catch" });
      }
    }

    return {
      entries: [tryId],
      exits
    };
  }

  private parseReturnStatement(statement: ts.ReturnStatement): FlowSegment {
    const label = statement.expression ? `return ${this.formatExpression(statement.expression)}` : "return";
    const returnId = this.createNode("return", label, statement, label);
    return {
      entries: [returnId],
      exits: []
    };
  }

  private parseCallStatement(call: ts.CallExpression): FlowSegment {
    const callee = this.formatCallExpression(call);
    const callId = this.createNode("call", callee, call, callee);
    return {
      entries: [callId],
      exits: [{ id: callId }]
    };
  }

  private parseNestedStatement(statement: ts.Statement): FlowSegment {
    if (ts.isBlock(statement)) {
      return this.parseStatementList(statement.statements);
    }

    return this.parseExecutableStatement(statement);
  }

  private sequenceSegments(segments: readonly FlowSegment[]): FlowSegment {
    const entries: string[] = [];
    let exits: FlowEndpoint[] = [];

    for (const segment of segments) {
      if (segment.entries.length === 0) {
        continue;
      }

      if (entries.length === 0) {
        entries.push(...segment.entries);
      } else if (exits.length > 0) {
        this.connect(exits, segment.entries);
      }

      exits = segment.exits;
    }

    return {
      entries,
      exits
    };
  }

  private connect(endpoints: readonly FlowEndpoint[], targets: readonly string[], fallbackLabel?: string) {
    for (const endpoint of endpoints) {
      for (const target of targets) {
        this.addEdge(endpoint.id, target, endpoint.label ?? fallbackLabel);
      }
    }
  }

  private addEdge(from: string, to: string, label?: string) {
    const key = `${from}|${to}|${label ?? ""}`;
    if (this.edgeKeys.has(key)) {
      return;
    }

    this.edgeKeys.add(key);
    this.edges.push({
      from,
      to,
      kind: "flow",
      ...(label ? { label } : {})
    });
  }

  private createNode(kind: ScriptFlowNodeKind, label: string, anchor: ts.Node, seed: string): string {
    const id = this.createId(kind, seed);
    this.nodes.push({
      id,
      kind,
      label: this.shorten(label, 56),
      range: this.toRange(anchor)
    });
    return id;
  }

  private setNodeMeta(id: string, meta: Record<string, unknown>) {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      return;
    }

    node.meta = {
      ...(node.meta ?? {}),
      ...meta
    };
  }

  private createId(kind: ScriptFlowNodeKind, seed: string): string {
    const prefix = kind === "function" ? "fn" : kind === "tryCatch" ? "try" : kind;
    const normalizedSeed = this.slugify(seed || kind);
    const base = `${prefix}:${normalizedSeed}`;
    const nextCount = (this.idCounters.get(base) ?? 0) + 1;
    this.idCounters.set(base, nextCount);
    return nextCount === 1 ? base : `${base}-${nextCount}`;
  }

  private toRange(node: ts.Node) {
    const start = this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile));
    const end = this.sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      startLine: start.line + 1,
      startCol: start.character + 1,
      endLine: end.line + 1,
      endCol: end.character + 1
    };
  }

  private formatParameters(parameters: readonly ts.ParameterDeclaration[]) {
    return parameters.map((parameter) => this.shorten(this.normalizeWhitespace(parameter.name.getText(this.sourceFile)), 18)).join(", ");
  }

  private formatExpression(expression: ts.Expression) {
    return this.shorten(this.normalizeWhitespace(expression.getText(this.sourceFile)), 42);
  }

  private formatCallExpression(expression: ts.CallExpression) {
    return `${this.shorten(this.normalizeWhitespace(expression.expression.getText(this.sourceFile)), 32)}()`;
  }

  private formatLoopLabel(statement: ts.ForStatement | ts.ForOfStatement | ts.ForInStatement | ts.WhileStatement | ts.DoStatement) {
    if (ts.isForStatement(statement)) {
      const condition = statement.condition ? this.formatExpression(statement.condition) : "loop";
      return `for ${condition}`;
    }
    if (ts.isForOfStatement(statement)) {
      return `for ${this.normalizeWhitespace(statement.initializer.getText(this.sourceFile))} of ${this.formatExpression(statement.expression)}`;
    }
    if (ts.isForInStatement(statement)) {
      return `for ${this.normalizeWhitespace(statement.initializer.getText(this.sourceFile))} in ${this.formatExpression(statement.expression)}`;
    }
    if (ts.isWhileStatement(statement)) {
      return `while ${this.formatExpression(statement.expression)}`;
    }
    return `do while ${this.formatExpression(statement.expression)}`;
  }

  private resolveLoopKind(statement: ts.ForStatement | ts.ForOfStatement | ts.ForInStatement | ts.WhileStatement | ts.DoStatement) {
    if (ts.isForStatement(statement)) {
      return "for";
    }
    if (ts.isForOfStatement(statement)) {
      return "for-of";
    }
    if (ts.isForInStatement(statement)) {
      return "for-in";
    }
    if (ts.isWhileStatement(statement)) {
      return "while";
    }
    return "do";
  }

  private hasExplicitReturn(body: ts.Block) {
    let found = false;
    const visit = (node: ts.Node) => {
      if (found) {
        return;
      }
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        return;
      }
      if (ts.isReturnStatement(node)) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };

    for (const statement of body.statements) {
      visit(statement);
      if (found) {
        break;
      }
    }

    return found;
  }

  private extractImportantCall(statement: ts.Statement) {
    if (!ts.isExpressionStatement(statement)) {
      return undefined;
    }

    let expression: ts.Expression = statement.expression;
    while (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isVoidExpression(expression)) {
      expression = expression.expression;
    }

    return ts.isCallExpression(expression) ? expression : undefined;
  }

  private readPropertyName(name: ts.PropertyName) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }

    return this.normalizeWhitespace(name.getText(this.sourceFile));
  }

  private normalizeWhitespace(value: string) {
    return value.replace(/\s+/g, " ").trim();
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
