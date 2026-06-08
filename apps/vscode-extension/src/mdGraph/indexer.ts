import path from "node:path";

import * as vscode from "vscode";
import { parse as parseYaml } from "yaml";

import type { MdxGraphEdge, MdxGraphIssue, MdxGraphNode, MdxGraphSnapshot } from "./types.js";

type ParsedDoc = {
  id: string;
  uri: vscode.Uri;
  route: string;
  title: string;
  description?: string;
  domain?: string;
  layer?: string;
  docKind?: string;
  badge?: string;
  tags: string[];
  links: LinkRef[];
  accounts: string[];
};

type LinkRef = {
  href: string;
  relation: "link" | "upstream" | "downstream" | "references" | "standards";
};

const MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

export const LEGACY_ACCOUNT_PATTERN = /\/manual-cuentas\/[^)\s"']+\/(\d{4,})\/?/g;

export type MdxGraphCacheEntry = { mtime: number; doc: ParsedDoc };
export type MdxGraphCache = Map<string, MdxGraphCacheEntry>;

export function createMdxGraphCache(): MdxGraphCache {
  return new Map();
}

const SCAN_BATCH_SIZE = 50;

export type BuildMdxGraphOptions = {
  maxFiles?: number;
  accountPattern?: RegExp | null;
  synthesizeTree?: "auto" | "on" | "off";
  cache?: MdxGraphCache;
};

export async function buildMdxGraphSnapshot(
  rootUri: vscode.Uri,
  options: BuildMdxGraphOptions | number = {}
): Promise<MdxGraphSnapshot> {
  if (typeof options === "number") {
    options = { maxFiles: options };
  }
  const maxFiles = options.maxFiles ?? 800;
  const accountPattern = options.accountPattern ?? null;
  const synthesizeMode = options.synthesizeTree ?? "auto";
  const startedAt = Date.now();
  const pattern = new vscode.RelativePattern(rootUri, "**/*.{md,mdx}");
  const rawFiles = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git,dist,build,.astro,.next}/**", maxFiles + 1);
  const truncated = rawFiles.length > maxFiles;
  const files = rawFiles.slice(0, maxFiles).sort((left, right) =>
    left.fsPath.localeCompare(right.fsPath)
  );

  const isStarlight = synthesizeMode === "on" ? true : synthesizeMode === "auto" ? await detectStarlight(rootUri) : false;
  const workspaceMode: "starlight" | "flat" = isStarlight ? "starlight" : "flat";

  const cache = options.cache;
  const docs: ParsedDoc[] = [];
  const routeToDocId = new Map<string, string>();
  const stemToDocIds = new Map<string, string[]>();

  const parseOrCached = async (uri: vscode.Uri): Promise<ParsedDoc> => {
    const key = uri.fsPath;
    if (cache) {
      const stat = await vscode.workspace.fs.stat(uri);
      const cached = cache.get(key);
      if (cached && cached.mtime === stat.mtime) {
        return cached.doc;
      }
      const source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      const doc = parseDocument(rootUri, uri, source, accountPattern);
      cache.set(key, { mtime: stat.mtime, doc });
      return doc;
    }
    const source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    return parseDocument(rootUri, uri, source, accountPattern);
  };

  for (let offset = 0; offset < files.length; offset += SCAN_BATCH_SIZE) {
    const batch = files.slice(offset, offset + SCAN_BATCH_SIZE);
    const parsed = await Promise.all(batch.map(parseOrCached));
    for (let index = 0; index < batch.length; index += 1) {
      const uri = batch[index]!;
      const doc = parsed[index]!;
      docs.push(doc);
      for (const route of routeAliasesForFile(rootUri, uri)) {
        addRouteAlias(routeToDocId, route, doc.id);
      }
      const stem = path.basename(uri.fsPath).replace(/\.(mdx?|MDX?)$/, "").toLowerCase();
      const bucket = stemToDocIds.get(stem) ?? [];
      bucket.push(doc.id);
      stemToDocIds.set(stem, bucket);
    }
  }

  const nodes = new Map<string, MdxGraphNode>();
  const edges = new Map<string, MdxGraphEdge>();
  const unresolved = new Set<string>();
  const issues: MdxGraphIssue[] = [];

  for (const doc of docs) {
    nodes.set(doc.id, {
      id: doc.id,
      kind: "doc",
      label: doc.title,
      path: doc.uri.fsPath,
      route: doc.route,
      title: doc.title,
      ...(doc.description ? { description: doc.description } : {}),
      ...(doc.domain ? { domain: doc.domain } : {}),
      ...(doc.layer ? { layer: doc.layer } : {}),
      ...(doc.docKind ? { docKind: doc.docKind } : {}),
      ...(doc.badge ? { badge: doc.badge } : {}),
      tags: doc.tags
    });

    for (const tag of doc.tags) {
      const tagId = `tag:${tag}`;
      nodes.set(tagId, {
        id: tagId,
        kind: "tag",
        label: tag
      });
      addEdge(edges, doc.id, tagId, "tag", "tag");
    }

    for (const account of doc.accounts) {
      const accountId = `account:${account}`;
      nodes.set(accountId, {
        id: accountId,
        kind: "account",
        label: account
      });
      addEdge(edges, doc.id, accountId, "account", "account");
    }

    for (const link of doc.links) {
      const targetId = resolveLink(link.href, doc.uri, rootUri, routeToDocId, stemToDocIds);
      if (targetId) {
        if (targetId === doc.id) {
          issues.push({ kind: "self-reference", nodeId: doc.id, detail: link.relation });
          continue;
        }
        const [from, to] = edgeEndpoints(doc.id, targetId, link.relation);
        addEdge(edges, from, to, "link", link.relation);
        continue;
      }

      if (link.relation !== "link") {
        issues.push({ kind: "broken-ref", nodeId: doc.id, detail: `${link.relation}: ${link.href}` });
      }
      const unresolvedId = `external:${normalizeExternalId(link.href)}`;
      unresolved.add(unresolvedId);
      nodes.set(unresolvedId, {
        id: unresolvedId,
        kind: "external",
        label: trimLabel(link.href),
        route: link.href
      });
      const [from, to] = edgeEndpoints(doc.id, unresolvedId, link.relation);
      addEdge(edges, from, to, "unresolved", link.relation);
    }
  }

  if (isStarlight) {
    synthesizeTreeEdges(docs, edges);
  }

  // Huérfanos: doc sin ninguna arista de árbol (upstream/downstream), es
  // decir páginas que no cuelgan del b-tree por ningún lado.
  const treeDegree = new Map<string, number>();
  for (const edge of edges.values()) {
    if (edge.label === "upstream" || edge.label === "downstream") {
      treeDegree.set(edge.from, (treeDegree.get(edge.from) ?? 0) + 1);
      treeDegree.set(edge.to, (treeDegree.get(edge.to) ?? 0) + 1);
    }
  }
  let orphanCount = 0;
  for (const node of nodes.values()) {
    if (node.kind !== "doc") {
      continue;
    }
    if (!treeDegree.get(node.id)) {
      node.isOrphan = true;
      orphanCount += 1;
      issues.push({ kind: "orphan", nodeId: node.id });
    }
  }

  // Ciclos: el árbol upstream/downstream debe ser acíclico.
  for (const cycleNodeId of findCycleNodes(edges)) {
    issues.push({ kind: "cycle", nodeId: cycleNodeId });
  }

  if (truncated) {
    issues.push({
      kind: "truncated",
      nodeId: "__workspace__",
      detail: `Scanned ${files.length} of more .md/.mdx files. Increase cortex.mdxGraphMaxFiles to scan more.`
    });
  }

  if (cache) {
    const currentKeys = new Set(files.map((u) => u.fsPath));
    for (const key of cache.keys()) {
      if (!currentKeys.has(key)) cache.delete(key);
    }
  }

  return {
    rootPath: rootUri.fsPath,
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    issues,
    stats: {
      fileCount: docs.length,
      tagCount: [...nodes.values()].filter((node) => node.kind === "tag").length,
      accountCount: [...nodes.values()].filter((node) => node.kind === "account").length,
      orphanCount,
      unresolvedCount: unresolved.size,
      elapsedMs: Date.now() - startedAt,
      workspaceMode
    }
  };
}

function parseDocument(
  rootUri: vscode.Uri,
  uri: vscode.Uri,
  source: string,
  accountPattern: RegExp | null
): ParsedDoc {
  const relativePath = normalizePath(path.relative(rootUri.fsPath, uri.fsPath));
  const route = starlightRouteFromFsPath(uri.fsPath) ?? routeFromRelativePath(relativePath);
  const frontmatter = parseFrontmatter(source);
  const headingTitle = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = frontmatter.title ?? headingTitle ?? titleFromPath(uri.fsPath);
  const explicitTags = frontmatter.tags;
  const tags = unique(explicitTags);
  const bodyForLinks = stripCodeBlocks(source);

  return {
    id: `doc:${relativePath}`,
    uri,
    route,
    title,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    ...(frontmatter.domain ? { domain: frontmatter.domain } : {}),
    ...(frontmatter.layer ? { layer: frontmatter.layer } : {}),
    ...(frontmatter.docKind ? { docKind: frontmatter.docKind } : {}),
    ...(frontmatter.badge ? { badge: frontmatter.badge } : {}),
    tags,
    links: uniqueLinks([...frontmatter.related, ...extractLinks(bodyForLinks).map((href) => ({ href, relation: "link" as const }))]),
    accounts: unique([...frontmatter.accounts, ...extractAccounts(bodyForLinks, accountPattern)])
  };
}

export function parseFrontmatter(source: string): {
  title?: string;
  description?: string;
  domain?: string;
  layer?: string;
  docKind?: string;
  badge?: string;
  tags: string[];
  related: LinkRef[];
  accounts: string[];
} {
  if (!source.startsWith("---")) {
    return { tags: [], related: [], accounts: [] };
  }
  const closing = source.slice(3).match(/\r?\n---(\r?\n|$)/);
  if (!closing || closing.index === undefined) {
    return { tags: [], related: [], accounts: [] };
  }
  const body = source.slice(3, 3 + closing.index);
  let doc: unknown;
  try {
    doc = parseYaml(body, { prettyErrors: false });
  } catch {
    return { tags: [], related: [], accounts: [] };
  }
  if (!isPlainObject(doc)) {
    return { tags: [], related: [], accounts: [] };
  }
  const record = doc as Record<string, unknown>;

  const title = coerceString(record.title);
  const description = coerceString(record.description);
  const domain = normalizeTag(coerceString(record.domain) ?? "");
  const layer = normalizeTag(coerceString(record.layer) ?? "");
  const docKind = normalizeTag(coerceString(record.kind) ?? "");
  const badge = coerceString(record.badge);

  const tags = unique(coerceStringList(record.tags).map(normalizeTag).filter(Boolean));
  const { links: related, accounts } = parseRelatedBlock(record.related);

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(domain ? { domain } : {}),
    ...(layer ? { layer } : {}),
    ...(docKind ? { docKind } : {}),
    ...(badge ? { badge } : {}),
    tags,
    related,
    accounts
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function coerceStringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => coerceString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  const single = coerceString(value);
  if (!single) return [];
  return single.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseRelatedBlock(value: unknown): { links: LinkRef[]; accounts: string[] } {
  if (!isPlainObject(value)) {
    return { links: [], accounts: [] };
  }
  const links: LinkRef[] = [];
  const accounts: string[] = [];
  const linkSections: ReadonlyArray<{ key: string; relation: LinkRef["relation"] }> = [
    { key: "references", relation: "references" },
    { key: "standards", relation: "standards" },
  ];
  for (const section of linkSections) {
    for (const raw of coerceStringList(value[section.key])) {
      const clean = raw.replace(/^["']|["']$/g, "");
      if (isRoutableLink(clean)) {
        links.push({ href: clean, relation: section.relation });
      }
    }
  }
  for (const raw of coerceStringList(value.accounts)) {
    const clean = raw.replace(/^["']|["']$/g, "");
    if (/^\d{4,}$/.test(clean)) {
      accounts.push(clean);
    }
  }
  return { links: uniqueLinks(links), accounts: unique(accounts) };
}

function extractLinks(source: string) {
  return unique([
    ...extractRegexGroup(source, MARKDOWN_LINK_RE),
    ...extractRegexGroup(source, HREF_RE),
    ...extractRegexGroup(source, WIKILINK_RE)
  ]).filter((link) => !isIgnoredLink(link));
}

function extractAccounts(source: string, pattern: RegExp | null) {
  if (!pattern) return [];
  return unique(extractRegexGroup(source, pattern));
}

async function detectStarlight(rootUri: vscode.Uri): Promise<boolean> {
  const contentDocs = vscode.Uri.joinPath(rootUri, "src", "content", "docs");
  try {
    const stat = await vscode.workspace.fs.stat(contentDocs);
    if (stat.type === vscode.FileType.Directory) return true;
  } catch { /* not present */ }
  for (const name of ["astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.cjs"]) {
    const candidate = vscode.Uri.joinPath(rootUri, name);
    try {
      await vscode.workspace.fs.stat(candidate);
      return true;
    } catch { /* not present */ }
  }
  return false;
}

function extractRegexGroup(source: string, regex: RegExp, group = 1) {
  regex.lastIndex = 0;
  const values: string[] = [];
  for (const match of source.matchAll(regex)) {
    const value = match[group]?.trim();
    if (value) {
      values.push(value);
    }
  }
  return values;
}

function stripCodeBlocks(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]+`/g, "");
}

function resolveLink(
  link: string,
  fromUri: vscode.Uri,
  rootUri: vscode.Uri,
  routeToDocId: ReadonlyMap<string, string>,
  stemToDocIds: ReadonlyMap<string, string[]>
) {
  const clean = link.split("#")[0]?.split("?")[0]?.trim();
  if (!clean || /^[a-z]+:/i.test(clean)) {
    return undefined;
  }

  if (clean.startsWith("/")) {
    return routeToDocId.get(clean.replace(/\/$/, "")) ?? routeToDocId.get(clean);
  }

  if (clean.endsWith(".md") || clean.endsWith(".mdx")) {
    const absolute = path.resolve(path.dirname(fromUri.fsPath), clean);
    const relative = normalizePath(path.relative(rootUri.fsPath, absolute));
    return routeToDocId.get(routeFromRelativePath(relative));
  }

  const direct = routeToDocId.get(clean.startsWith("/") ? clean : `/${clean}`);
  if (direct) {
    return direct;
  }

  const stem = clean.replace(/\/$/, "").split(/[\\/]/).pop()?.toLowerCase();
  const candidates = stem ? stemToDocIds.get(stem) : undefined;
  return candidates?.length === 1 ? candidates[0] : undefined;
}

function addEdge(edges: Map<string, MdxGraphEdge>, from: string, to: string, kind: MdxGraphEdge["kind"], label: string) {
  if (from === to) {
    return;
  }
  const id = `${kind}:${label}:${from}:${to}`;
  if (!edges.has(id)) {
    edges.set(id, { id, from, to, kind, label });
  }
}

function edgeEndpoints(from: string, to: string, relation: LinkRef["relation"]): [string, string] {
  return relation === "upstream" ? [to, from] : [from, to];
}

// Sintetiza aristas upstream/downstream desde la estructura de carpetas,
// replicando la regla de jean_d_arc/scripts/normalize-related.mjs: para cada
// doc, el padre es el index.{md,mdx} más cercano hacia arriba dentro de la
// misma "zona" (primer segmento bajo content/docs/). Es acíclico por
// construcción y se ejecuta después del loop de links del frontmatter.
function synthesizeTreeEdges(docs: ParsedDoc[], edges: Map<string, MdxGraphEdge>) {
  type Location = {
    doc: ParsedDoc;
    absPath: string;
    dir: string;
    isIndex: boolean;
    docsRoot: string | null;
    zone: string | null;
  };

  function locate(doc: ParsedDoc): Location {
    const absPath = normalizePath(doc.uri.fsPath);
    const isIndex = /\/index\.(md|mdx)$/i.test(absPath);
    const lastSlash = absPath.lastIndexOf("/");
    const dir = lastSlash >= 0 ? absPath.slice(0, lastSlash) : absPath;
    const match = absPath.match(/^(.*?\/(?:src\/)?content\/docs)\/(.+)$/i);
    if (!match) {
      return { doc, absPath, dir, isIndex, docsRoot: null, zone: null };
    }
    const docsRoot = match[1];
    const firstSeg = match[2].split("/")[0] ?? "";
    const zone = /^index\.(md|mdx)$/i.test(firstSeg) || !firstSeg ? null : firstSeg;
    return { doc, absPath, dir, isIndex, docsRoot, zone };
  }

  const locations = docs.map(locate);
  const indexByDir = new Map<string, Location>();
  for (const loc of locations) {
    if (loc.isIndex) {
      indexByDir.set(loc.dir, loc);
    }
  }

  function parentIndex(loc: Location): Location | null {
    if (!loc.zone || !loc.docsRoot) return null;
    const zoneRoot = `${loc.docsRoot}/${loc.zone}`;
    let dir = loc.dir;
    if (loc.isIndex) {
      if (dir === zoneRoot || !dir.includes("/")) return null;
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
    while (dir === zoneRoot || dir.startsWith(`${zoneRoot}/`)) {
      const parent = indexByDir.get(dir);
      if (parent && parent.doc.id !== loc.doc.id) return parent;
      if (dir === zoneRoot || !dir.includes("/")) break;
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
    return null;
  }

  function ancestorChain(loc: Location): Location[] {
    const out: Location[] = [];
    let current: Location | null = parentIndex(loc);
    let guard = 0;
    while (current && guard < 20) {
      out.push(current);
      current = parentIndex(current);
      guard += 1;
    }
    return out;
  }

  const childrenByParent = new Map<string, Location[]>();
  for (const loc of locations) {
    const parent = parentIndex(loc);
    if (!parent) continue;
    const bucket = childrenByParent.get(parent.doc.id) ?? [];
    bucket.push(loc);
    childrenByParent.set(parent.doc.id, bucket);
  }

  for (const loc of locations) {
    for (const ancestor of ancestorChain(loc)) {
      const [from, to] = edgeEndpoints(loc.doc.id, ancestor.doc.id, "upstream");
      addEdge(edges, from, to, "link", "upstream");
    }
  }
  for (const [parentId, children] of childrenByParent) {
    for (const child of children) {
      const [from, to] = edgeEndpoints(parentId, child.doc.id, "downstream");
      addEdge(edges, from, to, "link", "downstream");
    }
  }
}

// Nodos que participan en un ciclo del subgrafo de árbol (upstream/downstream).
function findCycleNodes(edges: Map<string, MdxGraphEdge>): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (edge.label !== "upstream" && edge.label !== "downstream") {
      continue;
    }
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const inCycle = new Set<string>();

  function visit(node: string) {
    state.set(node, "visiting");
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const status = state.get(next);
      if (status === "visiting") {
        const start = stack.lastIndexOf(next);
        for (let index = start; index < stack.length; index += 1) {
          inCycle.add(stack[index]);
        }
      } else if (!status) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, "done");
  }

  for (const node of adjacency.keys()) {
    if (!state.get(node)) {
      visit(node);
    }
  }
  return inCycle;
}

function routeFromRelativePath(relativePath: string) {
  const withoutExt = relativePath.replace(/\.(md|mdx)$/i, "");
  const route = withoutExt.endsWith("/index") ? withoutExt.slice(0, -"/index".length) : withoutExt;
  return `/${route}`.replace(/\/+/g, "/");
}

function routeAliasesForFile(rootUri: vscode.Uri, uri: vscode.Uri) {
  const relativePath = normalizePath(path.relative(rootUri.fsPath, uri.fsPath));
  const aliases = [routeFromRelativePath(relativePath)];
  const starlightRoute = starlightRouteFromFsPath(uri.fsPath);
  if (starlightRoute) {
    aliases.push(starlightRoute);
  }
  return unique(aliases);
}

function starlightRouteFromFsPath(fsPath: string) {
  const normalized = normalizePath(fsPath);
  const match = normalized.match(/(?:^|\/)(?:src\/)?content\/docs\/(.+)$/i);
  return match?.[1] ? routeFromRelativePath(match[1]) : undefined;
}

function addRouteAlias(routeToDocId: Map<string, string>, route: string, docId: string) {
  if (!routeToDocId.has(route)) {
    routeToDocId.set(route, docId);
  }
  const routeWithSlash = `${route}/`;
  if (!routeToDocId.has(routeWithSlash)) {
    routeToDocId.set(routeWithSlash, docId);
  }
}

function titleFromPath(filePath: string) {
  return path
    .basename(filePath)
    .replace(/\.(md|mdx)$/i, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueLinks(values: LinkRef[]) {
  const seen = new Set<string>();
  return values
    .filter((value) => value.href)
    .filter((value) => {
      const key = `${value.relation}:${value.href}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.relation.localeCompare(right.relation) || left.href.localeCompare(right.href));
}

function isRoutableLink(value: string) {
  return value.startsWith("/") || value.startsWith("./") || value.endsWith(".md") || value.endsWith(".mdx");
}

function isIgnoredLink(link: string) {
  return /^(https?:|mailto:|tel:|#)/i.test(link) || link.startsWith("@");
}

function normalizeExternalId(link: string) {
  return link.toLowerCase().replace(/[^a-z0-9/_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "unknown";
}

function trimLabel(link: string) {
  const clean = link.replace(/^\/+/, "").replace(/\/$/, "");
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean || "unresolved";
}
