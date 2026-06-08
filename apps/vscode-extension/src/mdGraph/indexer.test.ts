import { beforeEach, describe, expect, it, vi } from "vitest";

const { filesRef, sourcesRef, starlightDirRef } = vi.hoisted(() => ({
  filesRef: { current: [] as Array<{ fsPath: string }> },
  sourcesRef: { current: new Map<string, string>() },
  starlightDirRef: { current: false }
}));

vi.mock("vscode", () => ({
  RelativePattern: class RelativePattern {
    constructor(
      public readonly base: { fsPath: string },
      public readonly pattern: string
    ) {}
  },
  FileType: { Directory: 2, File: 1 },
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath.replace(/\\/g, "/"), ...segments].join("/").replace(/\//g, "\\")
    })
  },
  workspace: {
    findFiles: vi.fn(async () => filesRef.current),
    fs: {
      readFile: vi.fn(async (uri: { fsPath: string }) => Buffer.from(sourcesRef.current.get(uri.fsPath) ?? "", "utf8")),
      stat: vi.fn(async (uri: { fsPath: string }) => {
        if (starlightDirRef.current && uri.fsPath.includes("src\\content\\docs")) return { type: 2 };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      })
    }
  }
}));

import { buildMdxGraphSnapshot, LEGACY_ACCOUNT_PATTERN, parseFrontmatter } from "./indexer.js";

describe("buildMdxGraphSnapshot", () => {
  beforeEach(() => {
    filesRef.current = [];
    sourcesRef.current = new Map<string, string>();
    starlightDirRef.current = true;
  });

  it("resolves Starlight absolute href routes when scanning the project root", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const accountingPath = "C:\\site\\src\\content\\docs\\accounting\\index.mdx";
    const fixedAssetsPath = "C:\\site\\src\\content\\docs\\accounting\\activos-fijos\\index.mdx";
    filesRef.current = [{ fsPath: accountingPath }, { fsPath: fixedAssetsPath }];
    sourcesRef.current.set(
      accountingPath,
      [
        "---",
        "title: Accounting",
        "---",
        "",
        '<Card title="Activos fijos" href="/accounting/activos-fijos/" />'
      ].join("\n")
    );
    sourcesRef.current.set(
      fixedAssetsPath,
      [
        "---",
        "title: Activos fijos",
        "---",
        "",
        "# Activos fijos"
      ].join("\n")
    );

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "doc:src/content/docs/accounting/index.mdx",
          to: "doc:src/content/docs/accounting/activos-fijos/index.mdx",
          kind: "link"
        })
      ])
    );
    expect(snapshot.stats.unresolvedCount).toBe(0);
  });

  it("resolves Starlight absolute href routes when scanning a docs subsection", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs\\accounting" } as any;
    const accountingPath = "C:\\site\\src\\content\\docs\\accounting\\index.mdx";
    const fixedAssetsPath = "C:\\site\\src\\content\\docs\\accounting\\activos-fijos\\index.mdx";
    filesRef.current = [{ fsPath: accountingPath }, { fsPath: fixedAssetsPath }];
    sourcesRef.current.set(
      accountingPath,
      [
        "---",
        "title: Accounting",
        "---",
        "",
        '<LinkCard title="Activos fijos" href="/accounting/activos-fijos/" />'
      ].join("\n")
    );
    sourcesRef.current.set(
      fixedAssetsPath,
      [
        "---",
        "title: Activos fijos",
        "---",
        "",
        "# Activos fijos"
      ].join("\n")
    );

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "doc:index.mdx",
          route: "/accounting"
        }),
        expect.objectContaining({
          id: "doc:activos-fijos/index.mdx",
          route: "/accounting/activos-fijos"
        })
      ])
    );
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "doc:index.mdx",
          to: "doc:activos-fijos/index.mdx",
          kind: "link"
        })
      ])
    );
    expect(snapshot.stats.unresolvedCount).toBe(0);
  });

  it("derives upstream/downstream from folder structure and keeps references/standards/accounts from frontmatter", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs\\accounting" } as any;
    const accountingPath = "C:\\site\\src\\content\\docs\\accounting\\index.mdx";
    const fixedAssetsPath = "C:\\site\\src\\content\\docs\\accounting\\activos-fijos\\index.mdx";
    const standardPath = "C:\\site\\src\\content\\docs\\accounting\\ifrs\\nic-16.mdx";
    filesRef.current = [{ fsPath: accountingPath }, { fsPath: fixedAssetsPath }, { fsPath: standardPath }];
    sourcesRef.current.set(
      accountingPath,
      [
        "---",
        "title: Accounting",
        "---",
        "",
        "# Accounting"
      ].join("\n")
    );
    sourcesRef.current.set(
      fixedAssetsPath,
      [
        "---",
        "title: Activos fijos",
        "related:",
        "  upstream:",
        "    - /should-be-ignored/",
        "  downstream:",
        "    - /should-also-be-ignored/",
        "  references:",
        "    - /accounting/ifrs/nic-16/",
        "  standards:",
        "    - /accounting/ifrs/nic-16/",
        "  accounts:",
        "    - 1201500",
        "---",
        "",
        "# Activos fijos"
      ].join("\n")
    );
    sourcesRef.current.set(
      standardPath,
      [
        "---",
        "title: NIC 16",
        "---",
        "",
        "# NIC 16"
      ].join("\n")
    );

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "doc:index.mdx",
          to: "doc:activos-fijos/index.mdx",
          kind: "link",
          label: "upstream"
        }),
        expect.objectContaining({
          from: "doc:index.mdx",
          to: "doc:activos-fijos/index.mdx",
          kind: "link",
          label: "downstream"
        }),
        expect.objectContaining({
          from: "doc:activos-fijos/index.mdx",
          to: "doc:ifrs/nic-16.mdx",
          kind: "link",
          label: "references"
        }),
        expect.objectContaining({
          from: "doc:activos-fijos/index.mdx",
          to: "doc:ifrs/nic-16.mdx",
          kind: "link",
          label: "standards"
        }),
        expect.objectContaining({
          from: "doc:activos-fijos/index.mdx",
          to: "account:1201500",
          kind: "account",
          label: "account"
        })
      ])
    );
    expect(
      snapshot.edges.some(
        (edge) =>
          (edge.label === "upstream" || edge.label === "downstream") &&
          (edge.to.includes("should-be-ignored") || edge.to.includes("should-also-be-ignored"))
      )
    ).toBe(false);
  });

  it("reads tags from frontmatter without extracting inline body hashtags", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const docPath = "C:\\site\\src\\content\\docs\\accounting\\tags.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(
      docPath,
      [
        "---",
        "title: Tags",
        "tags:",
        "  - contabilidad",
        "---",
        "",
        "Este texto menciona #no-deberia-ser-tag en el cuerpo."
      ].join("\n")
    );

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tag:contabilidad" })]));
    expect(snapshot.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "tag:no-deberia-ser-tag" })]));
  });

  it("flags documents outside any indexed folder as orphans", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const rootPath = "C:\\site\\src\\content\\docs\\accounting\\index.mdx";
    const childPath = "C:\\site\\src\\content\\docs\\accounting\\activos-fijos\\index.mdx";
    const orphanPath = "C:\\site\\src\\content\\docs\\huerfano\\suelto.mdx";
    filesRef.current = [{ fsPath: rootPath }, { fsPath: childPath }, { fsPath: orphanPath }];
    sourcesRef.current.set(rootPath, ["---", "title: Accounting", "---", "", "# Accounting"].join("\n"));
    sourcesRef.current.set(childPath, ["---", "title: Activos fijos", "---", "", "# Activos fijos"].join("\n"));
    sourcesRef.current.set(orphanPath, ["---", "title: Suelto", "---", "", "# Suelto"].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.stats.orphanCount).toBe(1);
    expect(snapshot.nodes.find((node) => node.title === "Suelto")?.isOrphan).toBe(true);
    expect(snapshot.nodes.find((node) => node.title === "Activos fijos")?.isOrphan).toBeFalsy();
    expect(snapshot.nodes.find((node) => node.title === "Accounting")?.isOrphan).toBeFalsy();
  });

  it("does not produce cycles since upstream/downstream come from the filesystem", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const aPath = "C:\\site\\src\\content\\docs\\loop\\a.mdx";
    const bPath = "C:\\site\\src\\content\\docs\\loop\\b.mdx";
    filesRef.current = [{ fsPath: aPath }, { fsPath: bPath }];
    sourcesRef.current.set(aPath, ["---", "title: A", "related:", "  upstream:", "    - /loop/b/", "---", "", "# A"].join("\n"));
    sourcesRef.current.set(bPath, ["---", "title: B", "related:", "  upstream:", "    - /loop/a/", "---", "", "# B"].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.issues.filter((issue) => issue.kind === "cycle")).toHaveLength(0);
  });

  it("does not resolve wikilink when stem is ambiguous", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const aPath = "C:\\site\\src\\content\\docs\\a\\foo.mdx";
    const bPath = "C:\\site\\src\\content\\docs\\b\\foo.mdx";
    const linkerPath = "C:\\site\\src\\content\\docs\\linker.mdx";
    filesRef.current = [{ fsPath: aPath }, { fsPath: bPath }, { fsPath: linkerPath }];
    sourcesRef.current.set(aPath, ["---", "title: Foo A", "---", "", "# Foo A"].join("\n"));
    sourcesRef.current.set(bPath, ["---", "title: Foo B", "---", "", "# Foo B"].join("\n"));
    sourcesRef.current.set(linkerPath, ["---", "title: Linker", "---", "", "See [[foo]] for details."].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges.some((e) => e.kind === "link" && e.to === "doc:a/foo.mdx")).toBe(false);
    expect(snapshot.edges.some((e) => e.kind === "link" && e.to === "doc:b/foo.mdx")).toBe(false);
  });

  it("resolves wikilink when stem is unique", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const uniquePath = "C:\\site\\src\\content\\docs\\unic.mdx";
    const linkerPath = "C:\\site\\src\\content\\docs\\linker2.mdx";
    filesRef.current = [{ fsPath: uniquePath }, { fsPath: linkerPath }];
    sourcesRef.current.set(uniquePath, ["---", "title: Unique", "---", "", "# Unique"].join("\n"));
    sourcesRef.current.set(linkerPath, ["---", "title: Linker 2", "---", "", "See [[unic]] for details."].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges.some((e) => e.to === "doc:unic.mdx" && e.from === "doc:linker2.mdx")).toBe(true);
    expect(snapshot.issues.filter((i) => i.kind === "broken-ref")).toHaveLength(0);
  });

  it("does not resolve markdown link when stem is ambiguous", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const aPath = "C:\\site\\src\\content\\docs\\x\\bar.mdx";
    const bPath = "C:\\site\\src\\content\\docs\\y\\bar.mdx";
    const linkerPath = "C:\\site\\src\\content\\docs\\linker3.mdx";
    filesRef.current = [{ fsPath: aPath }, { fsPath: bPath }, { fsPath: linkerPath }];
    sourcesRef.current.set(aPath, ["---", "title: Bar A", "---", "", "# Bar A"].join("\n"));
    sourcesRef.current.set(bPath, ["---", "title: Bar B", "---", "", "# Bar B"].join("\n"));
    sourcesRef.current.set(linkerPath, ["---", "title: Linker 3", "---", "", 'See [bar](bar) for details.'].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges.some((e) => e.kind === "link" && e.to === "doc:x/bar.mdx")).toBe(false);
    expect(snapshot.edges.some((e) => e.kind === "link" && e.to === "doc:y/bar.mdx")).toBe(false);
  });

  it("flags all docs as orphans in non-Starlight workspace", async () => {
    const rootUri = { fsPath: "C:\\project" } as any;
    const page1 = "C:\\project\\pages\\page1.mdx";
    const page2 = "C:\\project\\pages\\page2.mdx";
    filesRef.current = [{ fsPath: page1 }, { fsPath: page2 }];
    sourcesRef.current.set(page1, ["---", "title: Page 1", "---", "", "# Page 1"].join("\n"));
    sourcesRef.current.set(page2, ["---", "title: Page 2", "---", "", "# Page 2"].join("\n"));
    starlightDirRef.current = false;

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.stats.orphanCount).toBe(2);
    expect(snapshot.issues.filter((i) => i.kind === "orphan")).toHaveLength(2);
  });

  it("resolves explicit relative refs even when docs are orphans", async () => {
    const rootUri = { fsPath: "C:\\project" } as any;
    const aPath = "C:\\project\\pages\\a.mdx";
    const bPath = "C:\\project\\pages\\b.mdx";
    filesRef.current = [{ fsPath: aPath }, { fsPath: bPath }];
    sourcesRef.current.set(aPath, ["---", "title: A", "---", "", "# A"].join("\n"));
    sourcesRef.current.set(bPath, ["---", "title: B", "---", "", "See [A](./a.mdx)"].join("\n"));
    starlightDirRef.current = false;

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges.some((e) => e.to === "doc:pages/a.mdx" && e.from === "doc:pages/b.mdx")).toBe(true);
    expect(snapshot.issues.filter((i) => i.kind === "orphan")).toHaveLength(2);
  });

  it("formats broken-ref detail as '<relation>: <href>'", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const docPath = "C:\\site\\src\\content\\docs\\test-br.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, [
      "---",
      "title: Test",
      "related:",
      "  references:",
      "    - /does-not-exist/",
      "---",
      "",
      "# Test",
    ].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    const br = snapshot.issues.find((i) => i.kind === "broken-ref");
    expect(br?.detail).toBe("references: /does-not-exist/");
  });

  it("detects self-reference via frontmatter", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const docPath = "C:\\site\\src\\content\\docs\\selftest.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, [
      "---",
      "title: Self Test",
      "related:",
      "  references:",
      "    - /selftest/",
      "---",
      "",
      "# Self Test",
    ].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.issues.some((i) => i.kind === "self-reference" && i.nodeId === "doc:selftest.mdx")).toBe(true);
    expect(snapshot.issues.find((i) => i.kind === "self-reference")?.detail).toBe("references");
  });

  it("ignores http and https links", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const docPath = "C:\\site\\docs\\test-http.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, [
      "---",
      "title: Test",
      "---",
      "",
      "See [Example](https://example.com) and [HTTP](http://httpbin.org).",
    ].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.edges.every((e) => !e.to.includes("example.com") && !e.to.includes("httpbin"))).toBe(true);
    expect(snapshot.issues.filter((i) => i.kind === "broken-ref")).toHaveLength(0);
  });

  it("passing accountPattern extracts accounts from body text", async () => {
    const rootUri = { fsPath: "C:\\project" } as any;
    const docPath = "C:\\project\\docs\\page.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, [
      "---",
      "title: Page",
      "---",
      "",
      "Account reference at /manual-cuentas/x/1201500/.",
    ].join("\n"));
    starlightDirRef.current = false;

    const snapshot = await buildMdxGraphSnapshot(rootUri, { accountPattern: LEGACY_ACCOUNT_PATTERN });

    expect(snapshot.nodes.some((n) => n.id === "account:1201500")).toBe(true);
  });

  it("default null accountPattern skips body account extraction", async () => {
    const rootUri = { fsPath: "C:\\project" } as any;
    const docPath = "C:\\project\\docs\\page.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, [
      "---",
      "title: Page",
      "---",
      "",
      "Account reference at /manual-cuentas/x/1201500/.",
    ].join("\n"));
    starlightDirRef.current = false;

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.nodes.some((n) => n.id === "account:1201500")).toBe(false);
  });

  it("synthesizeTree: on forces tree edges in flat workspace", async () => {
    const rootUri = { fsPath: "C:\\flat-project" } as any;
    const parentPath = "C:\\flat-project\\src\\content\\docs\\section\\index.mdx";
    const childPath = "C:\\flat-project\\src\\content\\docs\\section\\child\\index.mdx";
    filesRef.current = [{ fsPath: parentPath }, { fsPath: childPath }];
    sourcesRef.current.set(parentPath, ["---", "title: Section", "---", "", "# Section"].join("\n"));
    sourcesRef.current.set(childPath, ["---", "title: Child", "---", "", "# Child"].join("\n"));
    starlightDirRef.current = false;

    const snapshot = await buildMdxGraphSnapshot(rootUri, { synthesizeTree: "on" });

    expect(snapshot.stats.workspaceMode).toBe("starlight");
    expect(snapshot.edges.some((e) => e.label === "upstream")).toBe(true);
    expect(snapshot.edges.some((e) => e.label === "downstream")).toBe(true);
  });

  it("synthesizeTree: off suppresses tree edges in Starlight workspace", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const parentPath = "C:\\site\\src\\content\\docs\\parent.mdx";
    const childPath = "C:\\site\\src\\content\\docs\\parent\\child.mdx";
    filesRef.current = [{ fsPath: parentPath }, { fsPath: childPath }];
    sourcesRef.current.set(parentPath, ["---", "title: Parent", "---", "", "# Parent"].join("\n"));
    sourcesRef.current.set(childPath, ["---", "title: Child", "---", "", "# Child"].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri, { synthesizeTree: "off" });

    expect(snapshot.stats.workspaceMode).toBe("flat");
    expect(snapshot.edges.some((e) => e.label === "upstream")).toBe(false);
    expect(snapshot.edges.some((e) => e.label === "downstream")).toBe(false);
  });

  it("workspaceMode is starlight when tree synthesis runs", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const docPath = "C:\\site\\src\\content\\docs\\page.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, ["---", "title: Page", "---", "", "# Page"].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.stats.workspaceMode).toBe("starlight");
  });

  it("workspaceMode is flat when tree synthesis does not run", async () => {
    const rootUri = { fsPath: "C:\\not-starlight" } as any;
    const docPath = "C:\\not-starlight\\page.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, ["---", "title: Page", "---", "", "# Page"].join("\n"));
    starlightDirRef.current = false;

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.stats.workspaceMode).toBe("flat");
  });
});

describe("parseFrontmatter", () => {
  const fm = (body: string) => `---\n${body}\n---\n`;

  it("parses happy path with all fields", () => {
    const result = parseFrontmatter(fm([
      'title: Manual de Contabilidad',
      'description: Descripción completa',
      'domain: Finanzas',
      'layer: core',
      'kind: guide',
      'badge: new',
      'tags: [contabilidad, niff]',
      'related:',
      '  references:',
      '    - /manual/referencia/',
      '  standards:',
      '    - /normas/ifrs/',
      '  accounts:',
      '    - 1201500',
    ].join("\n")));
    expect(result.title).toBe("Manual de Contabilidad");
    expect(result.description).toBe("Descripción completa");
    expect(result.domain).toBe("finanzas");
    expect(result.layer).toBe("core");
    expect(result.docKind).toBe("guide");
    expect(result.badge).toBe("new");
    expect(result.tags).toEqual(["contabilidad", "niff"]);
    expect(result.related).toHaveLength(2);
    expect(result.related.find((r) => r.relation === "references")?.href).toBe("/manual/referencia/");
    expect(result.related.find((r) => r.relation === "standards")?.href).toBe("/normas/ifrs/");
    expect(result.accounts).toEqual(["1201500"]);
  });

  it("returns empty when no opening ---", () => {
    const result = parseFrontmatter("title: foo\n");
    expect(result).toEqual({ tags: [], related: [], accounts: [] });
  });

  it("returns empty when no closing ---", () => {
    const result = parseFrontmatter("---\ntitle: foo\n");
    expect(result).toEqual({ tags: [], related: [], accounts: [] });
  });

  it("returns empty on invalid YAML without throwing", () => {
    const result = parseFrontmatter("---\ntitle: \"unclosed\n---\n");
    expect(result).toEqual({ tags: [], related: [], accounts: [] });
  });

  it("preserves multi-line description with literal block", () => {
    const result = parseFrontmatter(fm([
      'title: Test',
      'description: |',
      '  Línea uno',
      '  Línea dos',
    ].join("\n")));
    expect(result.description).toBe("Línea uno\nLínea dos");
  });

  it("ignores YAML inline comments in scalar values", () => {
    const result = parseFrontmatter(fm('title: foo  # comentario'));
    expect(result.title).toBe("foo");
  });

  it("handles tags with commas inside quoted strings", () => {
    const result = parseFrontmatter(fm('tags: ["a,b", "c"]'));
    expect(result.tags).toEqual(["a,b", "c"]);
  });

  it("ignores related.upstream and related.downstream", () => {
    const result = parseFrontmatter(fm([
      'title: Test',
      'related:',
      '  upstream:',
      '    - /should-ignore/',
      '  downstream:',
      '    - /also-ignore/',
    ].join("\n")));
    expect(result.related).toHaveLength(0);
  });

  it("filters accounts by pattern \\d{4,}", () => {
    const result = parseFrontmatter(fm([
      'title: Test',
      'related:',
      '  accounts:',
      '    - 1100',
      '    - 12',
      '    - 9999',
    ].join("\n")));
    expect(result.accounts).toEqual(["1100", "9999"]);
  });

  it("handles null tags and null related without throwing", () => {
    const result = parseFrontmatter(fm([
      'title: Test',
      'tags: null',
      'related: null',
    ].join("\n")));
    expect(result.title).toBe("Test");
    expect(result.tags).toEqual([]);
    expect(result.related).toEqual([]);
    expect(result.accounts).toEqual([]);
  });

  it("parses folded description block", () => {
    const result = parseFrontmatter(fm([
      'title: Test',
      'description: >',
      '  This is a',
      '  folded block',
    ].join("\n")));
    expect(result.description).toBe("This is a folded block");
  });

  it("parses title with escaped quotes", () => {
    const result = parseFrontmatter(fm('title: "Manual de \\"Contabilidad\\""'));
    expect(result.title).toBe('Manual de "Contabilidad"');
  });
});

describe("stripCodeBlocks", () => {
  function doc(body: string) {
    return ["---", "title: Test", "---", "", body].join("\n");
  }

  beforeEach(() => {
    filesRef.current = [];
    sourcesRef.current = new Map<string, string>();
  });

  it("ignores markdown links inside fenced code blocks", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const docPath = "C:\\site\\docs\\test.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, doc([
      "```md",
      "[foo](/foo-fake)",
      "```",
    ].join("\n")));

    const snapshot = await buildMdxGraphSnapshot(rootUri);
    expect(snapshot.edges.some((e) => e.to.includes("foo-fake"))).toBe(false);
  });

  it("ignores links inside inline code spans", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const docPath = "C:\\site\\docs\\test.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, doc('Some text `[a](/b)` here.'));

    const snapshot = await buildMdxGraphSnapshot(rootUri);
    expect(snapshot.edges.some((e) => e.to.includes("/b"))).toBe(false);
  });

  it("ignores accounts inside fenced code blocks", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const docPath = "C:\\site\\docs\\test.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, doc([
      "```",
      "/manual-cuentas/x/1100/",
      "```",
    ].join("\n")));

    const snapshot = await buildMdxGraphSnapshot(rootUri, { accountPattern: LEGACY_ACCOUNT_PATTERN });
    expect(snapshot.nodes.some((n) => n.id === "account:1100")).toBe(false);
  });

  it("detects only real links outside fenced blocks, not fake ones inside", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const docPath = "C:\\site\\src\\content\\docs\\section\\test.mdx";
    const targetPath = "C:\\site\\src\\content\\docs\\section\\actual.mdx";
    filesRef.current = [{ fsPath: docPath }, { fsPath: targetPath }];
    sourcesRef.current.set(docPath, doc([
      "```",
      "[bad](/bad)",
      "```",
      "",
      "[good](/section/actual/)",
    ].join("\n")));
    sourcesRef.current.set(targetPath, doc(""));

    const snapshot = await buildMdxGraphSnapshot(rootUri);
    expect(snapshot.edges.some((e) => e.to.includes("bad"))).toBe(false);
    expect(snapshot.edges.some((e) => e.to.includes("actual"))).toBe(true);
  });

  it("ignores links inside tilde-fenced code blocks", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const docPath = "C:\\site\\docs\\test.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, doc([
      "~~~",
      "[a](/b)",
      "~~~",
    ].join("\n")));

    const snapshot = await buildMdxGraphSnapshot(rootUri);
    expect(snapshot.edges.some((e) => e.to.includes("/b"))).toBe(false);
  });

  it("still detects real links and accounts outside code blocks", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const docPath = "C:\\site\\src\\content\\docs\\section\\test.mdx";
    const targetPath = "C:\\site\\src\\content\\docs\\section\\actual.mdx";
    filesRef.current = [{ fsPath: docPath }, { fsPath: targetPath }];
    sourcesRef.current.set(docPath, doc([
      "See [this](/section/actual/) and the account at /manual-cuentas/x/1201500/.",
    ].join("\n")));
    sourcesRef.current.set(targetPath, doc(""));
    const snapshot = await buildMdxGraphSnapshot(rootUri, { accountPattern: LEGACY_ACCOUNT_PATTERN });
    expect(snapshot.edges.some((e) => e.to.includes("actual"))).toBe(true);
    expect(snapshot.nodes.some((n) => n.id === "account:1201500")).toBe(true);
  });

  it("ignores HTML href inside fenced code blocks", async () => {
    const rootUri = { fsPath: "C:\\site" } as any;
    const docPath = "C:\\site\\docs\\test-html-in-code.mdx";
    filesRef.current = [{ fsPath: docPath }];
    sourcesRef.current.set(docPath, doc([
      "```html",
      '<a href="/inside-code">Ignored</a>',
      "```",
    ].join("\n")));
    const snapshot = await buildMdxGraphSnapshot(rootUri);
    expect(snapshot.edges.some((e) => e.to.includes("inside-code"))).toBe(false);
  });
});

function makeFiles(count: number, dir: string) {
  return Array.from({ length: count }, (_, i) => ({ fsPath: `${dir}\\file${i}.mdx` }));
}

describe("truncation", () => {
  const rootUri = { fsPath: "C:\\site" } as any;

  beforeEach(() => {
    filesRef.current = [];
    sourcesRef.current = new Map<string, string>();
  });

  it("does not add truncated issue when files < maxFiles", async () => {
    filesRef.current = makeFiles(5, "C:\\site\\docs");
    for (const f of filesRef.current) {
      sourcesRef.current.set(f.fsPath, ["---", "title: test", "---", "", "# Test"].join("\n"));
    }
    const snapshot = await buildMdxGraphSnapshot(rootUri, 10);
    expect(snapshot.issues.filter((i) => i.kind === "truncated")).toHaveLength(0);
    expect(snapshot.stats.fileCount).toBe(5);
  });

  it("does not add truncated issue when files exactly equal maxFiles", async () => {
    filesRef.current = makeFiles(10, "C:\\site\\docs");
    for (const f of filesRef.current) {
      sourcesRef.current.set(f.fsPath, ["---", "title: test", "---", "", "# Test"].join("\n"));
    }
    const snapshot = await buildMdxGraphSnapshot(rootUri, 10);
    expect(snapshot.issues.filter((i) => i.kind === "truncated")).toHaveLength(0);
    expect(snapshot.stats.fileCount).toBe(10);
  });

  it("adds truncated issue and caps fileCount when files exceed maxFiles", async () => {
    filesRef.current = makeFiles(15, "C:\\site\\docs");
    for (const f of filesRef.current) {
      sourcesRef.current.set(f.fsPath, ["---", "title: test", "---", "", "# Test"].join("\n"));
    }
    const snapshot = await buildMdxGraphSnapshot(rootUri, 10);
    expect(snapshot.issues.filter((i) => i.kind === "truncated")).toHaveLength(1);
    expect(snapshot.issues.find((i) => i.kind === "truncated")?.nodeId).toBe("__workspace__");
    expect(snapshot.issues.find((i) => i.kind === "truncated")?.detail).toContain("10");
    expect(snapshot.stats.fileCount).toBe(10);
  });

  it("only produces one truncated issue even when mixed with other issue kinds", async () => {
    filesRef.current = makeFiles(15, "C:\\site\\docs");
    for (let i = 0; i < filesRef.current.length; i++) {
      const f = filesRef.current[i];
      if (i === 0) {
        sourcesRef.current.set(f.fsPath, [
          "---",
          "title: Broken",
          "related:",
          "  references:",
          "    - /non-existent/",
          "---",
          "",
          "# Broken",
        ].join("\n"));
      } else {
        sourcesRef.current.set(f.fsPath, ["---", "title: test", "---", "", "# Test"].join("\n"));
      }
    }
    const snapshot = await buildMdxGraphSnapshot(rootUri, 10);
    const truncatedIssues = snapshot.issues.filter((i) => i.kind === "truncated");
    expect(truncatedIssues).toHaveLength(1);
    expect(truncatedIssues[0].nodeId).toBe("__workspace__");
    expect(snapshot.issues.some((i) => i.kind === "broken-ref")).toBe(true);
  });
});
