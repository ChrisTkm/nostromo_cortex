import path from "node:path";

import * as vscode from "vscode";

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
const ACCOUNT_ROUTE_RE = /\/manual-cuentas\/[^)\s"']+\/(\d{4,})\/?/g;
export async function buildMdxGraphSnapshot(rootUri: vscode.Uri, maxFiles = 800): Promise<MdxGraphSnapshot> {
  const startedAt = Date.now();
  const pattern = new vscode.RelativePattern(rootUri, "**/*.{md,mdx}");
  const files = (await vscode.workspace.findFiles(pattern, "**/{node_modules,.git,dist,build,.astro,.next}/**", maxFiles)).sort((left, right) =>
    left.fsPath.localeCompare(right.fsPath)
  );

  const docs: ParsedDoc[] = [];
  const routeToDocId = new Map<string, string>();
  const stemToDocIds = new Map<string, string[]>();

  for (const uri of files) {
    const source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const doc = parseDocument(rootUri, uri, source);
    docs.push(doc);
    for (const route of routeAliasesForFile(rootUri, uri)) {
      addRouteAlias(routeToDocId, route, doc.id);
    }
    const stem = path.basename(uri.fsPath).replace(/\.(mdx?|MDX?)$/, "").toLowerCase();
    const bucket = stemToDocIds.get(stem) ?? [];
    bucket.push(doc.id);
    stemToDocIds.set(stem, bucket);
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
      elapsedMs: Date.now() - startedAt
    }
  };
}

function parseDocument(rootUri: vscode.Uri, uri: vscode.Uri, source: string): ParsedDoc {
  const relativePath = normalizePath(path.relative(rootUri.fsPath, uri.fsPath));
  const route = starlightRouteFromFsPath(uri.fsPath) ?? routeFromRelativePath(relativePath);
  const frontmatter = parseFrontmatter(source);
  const headingTitle = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = frontmatter.title ?? headingTitle ?? titleFromPath(uri.fsPath);
  const explicitTags = frontmatter.tags;
  const tags = unique(explicitTags);

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
    links: uniqueLinks([...frontmatter.related, ...extractLinks(source).map((href) => ({ href, relation: "link" as const }))]),
    accounts: unique([...frontmatter.accounts, ...extractAccounts(source)])
  };
}

function parseFrontmatter(source: string): {
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
  const end = source.indexOf("\n---", 3);
  if (end === -1) {
    return { tags: [], related: [], accounts: [] };
  }
  const body = source.slice(3, end);
  const title = scalarFrontmatterValue(body, "title");
  const description = scalarFrontmatterValue(body, "description");
  const domain = normalizeTag(scalarFrontmatterValue(body, "domain") ?? "");
  const layer = normalizeTag(scalarFrontmatterValue(body, "layer") ?? "");
  const docKind = normalizeTag(scalarFrontmatterValue(body, "kind") ?? "");
  const badge = scalarFrontmatterValue(body, "badge");
  const tags: string[] = [];
  const inlineTags = body.match(/^tags:\s*\[(.+)\]\s*$/m)?.[1];
  if (inlineTags) {
    tags.push(...inlineTags.split(",").map((tag) => tag.trim().replace(/^["']|["']$/g, "")));
  }
  const tagBlock = body.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m)?.[1];
  if (tagBlock) {
    tags.push(...tagBlock.split(/\r?\n/).map((line) => line.replace(/^\s*-\s*/, "").trim()).filter(Boolean));
  }
  const relatedBlock = body.match(/^related:\s*\n((?:\s{2,}.+\n?)+)/m)?.[1] ?? "";
  const related = extractRelatedRefs(relatedBlock);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(domain ? { domain } : {}),
    ...(layer ? { layer } : {}),
    ...(docKind ? { docKind } : {}),
    ...(badge ? { badge } : {}),
    tags: unique(tags.map(normalizeTag).filter(Boolean)),
    related: related.links,
    accounts: related.accounts
  };
}

function scalarFrontmatterValue(body: string, key: string) {
  return body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
}

function extractRelatedRefs(block: string) {
  const links: LinkRef[] = [];
  const accounts: string[] = [];
  let relation: LinkRef["relation"] | "accounts" = "link";

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^(upstream|downstream|references|standards|accounts):\s*$/);
    if (section?.[1]) {
      relation = section[1] as LinkRef["relation"] | "accounts";
      continue;
    }
    if (!line.startsWith("- ")) {
      continue;
    }
    const value = line.slice(2).trim().replace(/^["']|["']$/g, "");
    if (relation === "accounts") {
      if (/^\d{4,}$/.test(value)) {
        accounts.push(value);
      }
      continue;
    }
    if (isRoutableLink(value)) {
      links.push({ href: value, relation });
    }
  }

  return {
    links: uniqueLinks(links),
    accounts: unique(accounts)
  };
}

function extractLinks(source: string) {
  return unique([
    ...extractRegexGroup(source, MARKDOWN_LINK_RE),
    ...extractRegexGroup(source, HREF_RE),
    ...extractRegexGroup(source, WIKILINK_RE)
  ]).filter((link) => !isIgnoredLink(link));
}

function extractAccounts(source: string) {
  return unique(extractRegexGroup(source, ACCOUNT_ROUTE_RE));
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
