import { beforeEach, describe, expect, it, vi } from "vitest";

const { filesRef, sourcesRef } = vi.hoisted(() => ({
  filesRef: { current: [] as Array<{ fsPath: string }> },
  sourcesRef: { current: new Map<string, string>() }
}));

vi.mock("vscode", () => ({
  RelativePattern: class RelativePattern {
    constructor(
      public readonly base: { fsPath: string },
      public readonly pattern: string
    ) {}
  },
  workspace: {
    findFiles: vi.fn(async () => filesRef.current),
    fs: {
      readFile: vi.fn(async (uri: { fsPath: string }) => Buffer.from(sourcesRef.current.get(uri.fsPath) ?? "", "utf8"))
    }
  }
}));

import { buildMdxGraphSnapshot } from "./indexer.js";

describe("buildMdxGraphSnapshot", () => {
  beforeEach(() => {
    filesRef.current = [];
    sourcesRef.current = new Map<string, string>();
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

  it("keeps frontmatter related sections as selectable edge labels", async () => {
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
        "    - /accounting/",
        "  downstream:",
        "    - /accounting/activos-fijos/contabilizacion-activo-fijo/",
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
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "doc:activos-fijos/index.mdx",
          kind: "unresolved",
          label: "downstream"
        })
      ])
    );
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

  it("flags documents with no upstream/downstream edges as orphans", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const rootPath = "C:\\site\\src\\content\\docs\\accounting\\index.mdx";
    const childPath = "C:\\site\\src\\content\\docs\\accounting\\activos-fijos\\index.mdx";
    const orphanPath = "C:\\site\\src\\content\\docs\\accounting\\suelto.mdx";
    filesRef.current = [{ fsPath: rootPath }, { fsPath: childPath }, { fsPath: orphanPath }];
    sourcesRef.current.set(rootPath, ["---", "title: Accounting", "---", "", "# Accounting"].join("\n"));
    sourcesRef.current.set(
      childPath,
      ["---", "title: Activos fijos", "related:", "  upstream:", "    - /accounting/", "---", "", "# Activos fijos"].join("\n")
    );
    sourcesRef.current.set(orphanPath, ["---", "title: Suelto", "---", "", "# Suelto"].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.stats.orphanCount).toBe(1);
    expect(snapshot.nodes.find((node) => node.title === "Suelto")?.isOrphan).toBe(true);
    expect(snapshot.nodes.find((node) => node.title === "Activos fijos")?.isOrphan).toBeFalsy();
    expect(snapshot.nodes.find((node) => node.title === "Accounting")?.isOrphan).toBeFalsy();
  });

  it("reports a cycle when upstream references loop", async () => {
    const rootUri = { fsPath: "C:\\site\\src\\content\\docs" } as any;
    const aPath = "C:\\site\\src\\content\\docs\\loop\\a.mdx";
    const bPath = "C:\\site\\src\\content\\docs\\loop\\b.mdx";
    filesRef.current = [{ fsPath: aPath }, { fsPath: bPath }];
    sourcesRef.current.set(aPath, ["---", "title: A", "related:", "  upstream:", "    - /loop/b/", "---", "", "# A"].join("\n"));
    sourcesRef.current.set(bPath, ["---", "title: B", "related:", "  upstream:", "    - /loop/a/", "---", "", "# B"].join("\n"));

    const snapshot = await buildMdxGraphSnapshot(rootUri);

    expect(snapshot.issues.filter((issue) => issue.kind === "cycle")).toHaveLength(2);
  });
});
