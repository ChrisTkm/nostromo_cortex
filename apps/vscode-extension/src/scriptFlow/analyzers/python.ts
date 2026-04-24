import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Language, Node, Parser } from "web-tree-sitter";

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

const MODULE_DIR = typeof __dirname === "string" ? __dirname : process.cwd();
const TREE_SITTER_PYTHON_VERSION = "0.25.0";
const WEB_TREE_SITTER_WASM = "web-tree-sitter.wasm";
const PYTHON_WASM = "tree-sitter-python.wasm";

let parserPromise: Promise<Parser> | undefined;
let languagePromise: Promise<Language> | undefined;
let loadLogged = false;

export async function analyzePythonDocument(input: ScriptFlowAnalyzerInput): Promise<ScriptFlowSnapshot> {
  const parser = await getPythonParser();
  const analyzer = new PythonFlowAnalyzer(input.documentPath, input.source, parser);
  return analyzer.analyze();
}

async function getPythonParser() {
  if (!parserPromise) {
    parserPromise = initializePythonParser().catch((error) => {
      parserPromise = undefined;
      languagePromise = undefined;
      throw error;
    });
  }

  return parserPromise;
}

async function initializePythonParser() {
  const extensionRoot = resolveExtensionRoot();
  const runtimeWasmPath = path.join(extensionRoot, "media", WEB_TREE_SITTER_WASM);
  const pythonWasmPath = path.join(extensionRoot, "media", PYTHON_WASM);

  if (!existsSync(runtimeWasmPath)) {
    throw new Error(`Python analyzer could not find ${WEB_TREE_SITTER_WASM} at ${runtimeWasmPath}. Run the extension build first.`);
  }
  if (!existsSync(pythonWasmPath)) {
    throw new Error(`Python analyzer could not find ${PYTHON_WASM} at ${pythonWasmPath}. Run the extension build first.`);
  }

  try {
    const wasmBinary = readFileSync(runtimeWasmPath);
    await Parser.init({
      wasmBinary,
      instantiateWasm(imports: WebAssembly.Imports, callback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
        WebAssembly.instantiate(wasmBinary, imports)
          .then(({ instance, module }) => callback(instance, module))
          .catch((err) => {
            throw err;
          });
        return {};
      },
      locateFile(scriptName: string) {
        return path.join(extensionRoot, "media", scriptName);
      }
    } as Parameters<typeof Parser.init>[0]);
  } catch (error) {
    const stack = error instanceof Error ? error.stack ?? error.message : String(error);
    throw new Error(`Python analyzer failed to initialize tree-sitter runtime: ${stack}`);
  }

  if (!languagePromise) {
    const languageBytes = readFileSync(pythonWasmPath);
    languagePromise = Language.load(languageBytes).catch((error) => {
      languagePromise = undefined;
      throw new Error(`Python analyzer failed to load ${PYTHON_WASM}: ${String(error)}`);
    });
  }

  const parser = new Parser();
  parser.setLanguage(await languagePromise);

  if (!loadLogged) {
    console.info(`[script-flow] Loaded ${PYTHON_WASM} from media (${TREE_SITTER_PYTHON_VERSION})`);
    loadLogged = true;
  }

  return parser;
}

function resolveExtensionRoot() {
  let current = MODULE_DIR;

  while (true) {
    if (existsSync(path.join(current, "package.json")) && existsSync(path.join(current, "media"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Python analyzer could not resolve the Cortex extension root from ${MODULE_DIR}.`);
    }
    current = parent;
  }
}

class PythonFlowAnalyzer {
  private readonly documentPath: string;
  private readonly source: string;
  private readonly parser: Parser;
  private readonly nodes: ScriptFlowNode[] = [];
  private readonly edges: ScriptFlowEdge[] = [];
  private readonly decisions: ScriptFlowAnalysis["decisions"] = [];
  private readonly loops: ScriptFlowAnalysis["loops"] = [];
  private readonly entryPoints: string[] = [];
  private readonly observations = new Set<string>();
  private readonly edgeKeys = new Set<string>();
  private readonly idCounters = new Map<string, number>();

  constructor(documentPath: string, source: string, parser: Parser) {
    this.documentPath = documentPath;
    this.source = source;
    this.parser = parser;
  }

  analyze(): ScriptFlowSnapshot {
    const tree = this.parser.parse(this.source);
    if (!tree) {
      throw new Error(`Python analyzer could not parse ${this.documentPath}.`);
    }

    try {
      const entryId = this.createNode("entry", path.basename(this.documentPath), tree.rootNode, path.basename(this.documentPath));
      const topLevelSegments = tree.rootNode.namedChildren.map((node) => this.parseTopLevelNode(node)).filter((segment) => segment.entries.length > 0);
      const topLevelFlow = this.sequenceSegments(topLevelSegments);
      this.connect([{ id: entryId }], topLevelFlow.entries);

      return {
        metadata: {
          path: this.documentPath.replace(/\\/g, "/"),
          language: "python",
          hash: createHash("sha1").update(this.source).digest("hex"),
          parsedAt: new Date().toISOString()
        },
        nodes: this.nodes,
        edges: this.edges,
        analysis: this.buildAnalysis()
      };
    } finally {
      tree.delete();
    }
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

  private parseTopLevelNode(node: Node): FlowSegment {
    const statement = this.unwrapDefinition(node);

    if (statement.type === "function_definition") {
      return this.parseFunctionDefinition(statement, true);
    }
    if (statement.type === "class_definition") {
      return this.parseClassDefinition(statement);
    }

    return this.parseStatementNode(statement);
  }

  private parseClassDefinition(node: Node): FlowSegment {
    const classNameNode = node.childForFieldName("name") ?? node.namedChildren.find((child) => child.type === "identifier") ?? null;
    const body = this.findBlock(node);
    if (!body) {
      return EMPTY_SEGMENT;
    }

    const className = classNameNode?.text ?? "class";
    const segments = body.namedChildren
      .map((child) => {
        const statement = this.unwrapDefinition(child);
        if (statement.type === "function_definition") {
          return this.parseFunctionDefinition(statement, false, `${className}.${this.readFunctionName(statement)}`);
        }
        return EMPTY_SEGMENT;
      })
      .filter((segment) => segment.entries.length > 0);

    return this.sequenceSegments(segments);
  }

  private parseFunctionDefinition(node: Node, isEntryPoint: boolean, displayNameOverride?: string): FlowSegment {
    const displayName = displayNameOverride ?? this.readFunctionName(node);
    const parameters = this.readParameters(node);
    const functionId = this.createNode("function", `${displayName}(${parameters})`, node, displayName);
    if (isEntryPoint) {
      this.entryPoints.push(functionId);
    }

    const body = this.findBlock(node);
    if (body && !this.hasExplicitReturn(body)) {
      this.observations.add(`Function ${displayName} has no explicit return.`);
    }

    const bodySegment = body ? this.parseStatementList(body.namedChildren) : EMPTY_SEGMENT;
    this.connect([{ id: functionId }], bodySegment.entries);

    return {
      entries: [functionId],
      exits: [{ id: functionId }]
    };
  }

  private parseStatementList(statements: readonly Node[]): FlowSegment {
    const segments = statements.map((statement) => this.parseStatementNode(statement)).filter((segment) => segment.entries.length > 0);
    return this.sequenceSegments(segments);
  }

  private parseStatementNode(node: Node): FlowSegment {
    const statement = this.unwrapDefinition(node);

    switch (statement.type) {
      case "function_definition":
        return this.parseFunctionDefinition(statement, false);
      case "if_statement":
        return this.parseIfStatement(statement);
      case "for_statement":
      case "while_statement":
        return this.parseLoopStatement(statement);
      case "try_statement":
        return this.parseTryStatement(statement);
      case "return_statement":
        return this.parseReturnStatement(statement);
      case "block":
        return this.parseStatementList(statement.namedChildren);
      case "class_definition":
        return this.parseClassDefinition(statement);
      default: {
        const call = this.extractImportantCall(statement);
        return call ? this.parseCallStatement(call) : EMPTY_SEGMENT;
      }
    }
  }

  private parseIfStatement(node: Node): FlowSegment {
    const condition = node.namedChildren.find((child) => child.type !== "block" && child.type !== "elif_clause" && child.type !== "else_clause") ?? null;
    const label = `if ${this.formatExpression(condition)}`;
    const branchId = this.createNode("branch", label, node, label);
    const elifClauses = node.namedChildren.filter((child) => child.type === "elif_clause");
    const elseClause = node.namedChildren.find((child) => child.type === "else_clause") ?? null;
    const branchCount = 1 + elifClauses.length + (elseClause ? 1 : 0);

    this.setNodeMeta(branchId, { branches: branchCount });
    this.decisions.push({
      nodeId: branchId,
      label,
      branches: branchCount
    });

    const exits: FlowEndpoint[] = [];
    const primaryBlock = this.findBlock(node);
    const primarySegment = primaryBlock ? this.parseStatementList(primaryBlock.namedChildren) : EMPTY_SEGMENT;
    this.collectBranchSegment(branchId, "then", primarySegment, exits);

    for (const clause of elifClauses) {
      const elifCondition = clause.namedChildren.find((child) => child.type !== "block") ?? null;
      const clauseLabel = `elif ${this.formatExpression(elifCondition)}`;
      const clauseBlock = this.findBlock(clause);
      const clauseSegment = clauseBlock ? this.parseStatementList(clauseBlock.namedChildren) : EMPTY_SEGMENT;
      this.collectBranchSegment(branchId, clauseLabel, clauseSegment, exits);
    }

    if (elseClause) {
      const elseBlock = this.findBlock(elseClause);
      const elseSegment = elseBlock ? this.parseStatementList(elseBlock.namedChildren) : EMPTY_SEGMENT;
      this.collectBranchSegment(branchId, "else", elseSegment, exits);
    } else {
      exits.push({ id: branchId, label: "else" });
    }

    return {
      entries: [branchId],
      exits
    };
  }

  private collectBranchSegment(branchId: string, label: string, segment: FlowSegment, exits: FlowEndpoint[]) {
    if (segment.entries.length > 0) {
      this.connect([{ id: branchId, label }], segment.entries);
    }

    if (segment.exits.length > 0) {
      exits.push(...segment.exits);
    } else {
      exits.push({ id: branchId, label });
    }
  }

  private parseLoopStatement(node: Node): FlowSegment {
    const loopKind = node.type === "for_statement" ? "for" : "while";
    const label = this.formatLoopLabel(node);
    const loopId = this.createNode("loop", label, node, label);
    this.setNodeMeta(loopId, { kind: loopKind });
    this.loops.push({
      nodeId: loopId,
      label,
      kind: loopKind
    });

    const body = this.findBlock(node);
    const bodySegment = body ? this.parseStatementList(body.namedChildren) : EMPTY_SEGMENT;
    if (bodySegment.entries.length > 0) {
      this.connect([{ id: loopId }], bodySegment.entries);
      this.connect(bodySegment.exits, [loopId], "loop");
    }

    return {
      entries: [loopId],
      exits: [{ id: loopId }]
    };
  }

  private parseTryStatement(node: Node): FlowSegment {
    const tryId = this.createNode("tryCatch", "try / except", node, "try-except");
    const tryBlock = this.findBlock(node);
    const trySegment = tryBlock ? this.parseStatementList(tryBlock.namedChildren) : EMPTY_SEGMENT;
    const exceptClauses = node.namedChildren.filter((child) => child.type === "except_clause");
    const elseClause = node.namedChildren.find((child) => child.type === "else_clause") ?? null;
    const finallyClause = node.namedChildren.find((child) => child.type === "finally_clause") ?? null;

    if (trySegment.entries.length > 0) {
      this.connect([{ id: tryId, label: "try" }], trySegment.entries);
    }

    const exceptExits: FlowEndpoint[] = [];
    for (const clause of exceptClauses) {
      const clauseBlock = this.findBlock(clause);
      if (clauseBlock && clauseBlock.namedChildren.length === 0) {
        this.observations.add(`Empty except block near line ${clause.startPosition.row + 1}.`);
      }
      const label = clause.namedChildren[0] ? `except ${this.formatExpression(clause.namedChildren[0])}` : "except";
      const clauseSegment = clauseBlock ? this.parseStatementList(clauseBlock.namedChildren) : EMPTY_SEGMENT;
      if (clauseSegment.entries.length > 0) {
        this.connect([{ id: tryId, label }], clauseSegment.entries);
      }
      if (clauseSegment.exits.length > 0) {
        exceptExits.push(...clauseSegment.exits);
      } else {
        exceptExits.push({ id: tryId, label });
      }
    }

    let trySideExits = trySegment.exits.length > 0 ? [...trySegment.exits] : [{ id: tryId, label: "try" }];
    if (elseClause) {
      const elseBlock = this.findBlock(elseClause);
      const elseSegment = elseBlock ? this.parseStatementList(elseBlock.namedChildren) : EMPTY_SEGMENT;
      if (elseSegment.entries.length > 0) {
        this.connect(trySideExits, elseSegment.entries, "else");
      }
      trySideExits = elseSegment.exits.length > 0 ? [...elseSegment.exits] : [{ id: tryId, label: "else" }];
    }

    if (finallyClause) {
      const finallyBlock = this.findBlock(finallyClause);
      const finallySegment = finallyBlock ? this.parseStatementList(finallyBlock.namedChildren) : EMPTY_SEGMENT;
      const incoming = [...trySideExits, ...exceptExits];
      if (finallySegment.entries.length > 0) {
        this.connect(incoming, finallySegment.entries, "finally");
      }
      return {
        entries: [tryId],
        exits: finallySegment.exits.length > 0 ? finallySegment.exits : [{ id: tryId, label: "finally" }]
      };
    }

    return {
      entries: [tryId],
      exits: [...trySideExits, ...exceptExits]
    };
  }

  private parseReturnStatement(node: Node): FlowSegment {
    const expression = node.namedChildren[0] ?? null;
    const label = expression ? `return ${this.formatExpression(expression)}` : "return";
    const returnId = this.createNode("return", label, node, label);
    return {
      entries: [returnId],
      exits: []
    };
  }

  private parseCallStatement(node: Node): FlowSegment {
    const label = `${this.formatExpression(node.namedChildren[0] ?? node)}()`;
    const callId = this.createNode("call", label, node, label);
    return {
      entries: [callId],
      exits: [{ id: callId }]
    };
  }

  private unwrapDefinition(node: Node) {
    if (node.type !== "decorated_definition") {
      return node;
    }

    return node.namedChildren.find((child) => child.type === "function_definition" || child.type === "class_definition") ?? node;
  }

  private extractImportantCall(node: Node) {
    if (node.type !== "expression_statement") {
      return undefined;
    }

    return this.findFirstCall(node);
  }

  private findFirstCall(node: Node): Node | undefined {
    if (node.type === "call") {
      return node;
    }

    for (const child of node.namedChildren) {
      if (child.type === "lambda" || child.type === "function_definition" || child.type === "class_definition") {
        continue;
      }

      const call = this.findFirstCall(child);
      if (call) {
        return call;
      }
    }

    return undefined;
  }

  private hasExplicitReturn(body: Node) {
    for (const statement of body.namedChildren) {
      if (this.statementHasReturn(statement)) {
        return true;
      }
    }

    return false;
  }

  private statementHasReturn(node: Node): boolean {
    const statement = this.unwrapDefinition(node);
    if (statement.type === "return_statement") {
      return true;
    }
    if (statement.type === "function_definition" || statement.type === "class_definition" || statement.type === "lambda") {
      return false;
    }

    return statement.namedChildren.some((child) => this.statementHasReturn(child));
  }

  private readFunctionName(node: Node) {
    return node.childForFieldName("name")?.text ?? node.namedChildren.find((child) => child.type === "identifier")?.text ?? "anonymous";
  }

  private readParameters(node: Node) {
    const parameters = node.childForFieldName("parameters") ?? node.namedChildren.find((child) => child.type === "parameters") ?? null;
    if (!parameters) {
      return "";
    }

    return this.shorten(this.normalizeWhitespace(parameters.text.replace(/^\(|\)$/g, "")), 24);
  }

  private findBlock(node: Node) {
    return node.namedChildren.find((child) => child.type === "block") ?? null;
  }

  private formatLoopLabel(node: Node) {
    if (node.type === "for_statement") {
      const target = node.namedChildren[0] ?? null;
      const iterable = node.namedChildren[1] ?? null;
      return `for ${this.formatExpression(target)} in ${this.formatExpression(iterable)}`;
    }

    const condition = node.namedChildren[0] ?? null;
    return `while ${this.formatExpression(condition)}`;
  }

  private formatExpression(node: Node | null) {
    if (!node) {
      return "expression";
    }

    return this.shorten(this.normalizeWhitespace(node.text), 42);
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

  private createNode(kind: ScriptFlowNodeKind, label: string, anchor: Node, seed: string) {
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

  private createId(kind: ScriptFlowNodeKind, seed: string) {
    const prefix = kind === "function" ? "fn" : kind === "tryCatch" ? "try" : kind;
    const normalizedSeed = this.slugify(seed || kind);
    const base = `${prefix}:${normalizedSeed}`;
    const nextCount = (this.idCounters.get(base) ?? 0) + 1;
    this.idCounters.set(base, nextCount);
    return nextCount === 1 ? base : `${base}-${nextCount}`;
  }

  private toRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startCol: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endCol: node.endPosition.column + 1
    };
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
