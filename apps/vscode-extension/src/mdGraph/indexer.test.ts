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
});
