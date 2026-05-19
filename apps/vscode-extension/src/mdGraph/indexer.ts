import path from "node:path";

import * as vscode from "vscode";

import type { MdxGraphEdge, MdxGraphNode, MdxGraphSnapshot } from "./types.js";

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
  links: string[];
  accounts: string[];
};

const MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const ACCOUNT_ROUTE_RE = /\/manual-cuentas\/[^)\s"']+\/(\d{4,})\/?/g;
const HASH_TAG_RE = /(^|[\s([,{])#([A-Za-z0-9_-][\w-]*)/g;

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
    routeToDocId.set(doc.route, doc.id);
    routeToDocId.set(`${doc.route}/`, doc.id);
    const stem = path.basename(uri.fsPath).replace(/\.(mdx?|MDX?)$/, "").toLowerCase();
    const bucket = stemToDocIds.get(stem) ?? [];
    bucket.push(doc.id);
    stemToDocIds.set(stem, bucket);
  }

  const nodes = new Map<string, MdxGraphNode>();
  const edges = new Map<string, MdxGraphEdge>();
  const unresolved = new Set<string>();

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
      const targetId = resolveLink(link, doc.uri, rootUri, routeToDocId, stemToDocIds);
      if (targetId) {
        addEdge(edges, doc.id, targetId, "link", "link");
        continue;
      }

      const unresolvedId = `external:${normalizeExternalId(link)}`;
      unresolved.add(unresolvedId);
      nodes.set(unresolvedId, {
        id: unresolvedId,
        kind: "external",
        label: trimLabel(link),
        route: link
      });
      addEdge(edges, doc.id, unresolvedId, "unresolved", "unresolved");
    }
  }

  return {
    rootPath: rootUri.fsPath,
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    stats: {
      fileCount: docs.length,
      tagCount: [...nodes.values()].filter((node) => node.kind === "tag").length,
      accountCount: [...nodes.values()].filter((node) => node.kind === "account").length,
      unresolvedCount: unresolved.size,
      elapsedMs: Date.now() - startedAt
    }
  };
}

function parseDocument(rootUri: vscode.Uri, uri: vscode.Uri, source: string): ParsedDoc {
  const relativePath = normalizePath(path.relative(rootUri.fsPath, uri.fsPath));
  const route = routeFromRelativePath(relativePath);
  const frontmatter = parseFrontmatter(source);
  const headingTitle = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = frontmatter.title ?? headingTitle ?? titleFromPath(uri.fsPath);
  const explicitTags = frontmatter.tags;
  const folderTags = relativePath.split("/").slice(0, -1).map(normalizeTag).filter(Boolean);
  const inlineTags = extractInlineTags(source);
  const structuralTags = [frontmatter.domain, frontmatter.layer, frontmatter.docKind].map((value) => (value ? normalizeTag(value) : "")).filter(Boolean);
  const tags = unique([...folderTags, ...explicitTags, ...inlineTags, ...structuralTags]);

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
    links: unique([...frontmatter.related, ...extractLinks(source)]),
    accounts: extractAccounts(source)
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
  related: string[];
} {
  if (!source.startsWith("---")) {
    return { tags: [], related: [] };
  }
  const end = source.indexOf("\n---", 3);
  if (end === -1) {
    return { tags: [], related: [] };
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
  const related = extractRelatedLinks(relatedBlock);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(domain ? { domain } : {}),
    ...(layer ? { layer } : {}),
    ...(docKind ? { docKind } : {}),
    ...(badge ? { badge } : {}),
    tags: unique(tags.map(normalizeTag).filter(Boolean)),
    related
  };
}

function scalarFrontmatterValue(body: string, key: string) {
  return body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
}

function extractRelatedLinks(block: string) {
  return unique(
    block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((value) => value.startsWith("/") || value.startsWith("./") || value.endsWith(".md") || value.endsWith(".mdx"))
  );
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

function extractInlineTags(source: string) {
  return unique(extractRegexGroup(source, HASH_TAG_RE, 2).map(normalizeTag).filter(Boolean));
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
  const id = `${kind}:${from}:${to}`;
  if (!edges.has(id)) {
    edges.set(id, { id, from, to, kind, label });
  }
}

function routeFromRelativePath(relativePath: string) {
  const withoutExt = relativePath.replace(/\.(md|mdx)$/i, "");
  const route = withoutExt.endsWith("/index") ? withoutExt.slice(0, -"/index".length) : withoutExt;
  return `/${route}`.replace(/\/+/g, "/");
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
