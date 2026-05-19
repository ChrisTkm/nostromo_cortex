export type MdxGraphNodeKind = "doc" | "tag" | "account" | "external";

export type MdxGraphEdgeKind = "link" | "tag" | "account" | "unresolved";

export type MdxGraphNode = {
  id: string;
  kind: MdxGraphNodeKind;
  label: string;
  path?: string;
  route?: string;
  title?: string;
  description?: string;
  domain?: string;
  layer?: string;
  docKind?: string;
  badge?: string;
  tags?: string[];
};

export type MdxGraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: MdxGraphEdgeKind;
  label?: string;
};

export type MdxGraphSnapshot = {
  rootPath: string;
  generatedAt: string;
  nodes: MdxGraphNode[];
  edges: MdxGraphEdge[];
  stats: {
    fileCount: number;
    tagCount: number;
    accountCount: number;
    unresolvedCount: number;
    elapsedMs: number;
  };
};

export type MdxGraphHostMessage =
  | {
      type: "mdxGraph:snapshot";
      snapshot: MdxGraphSnapshot;
    }
  | {
      type: "mdxGraph:error";
      error: string;
    };

export type MdxGraphWebviewMessage =
  | { type: "ready" }
  | { type: "mdxGraph:refresh" }
  | { type: "mdxGraph:pickFolder" }
  | { type: "mdxGraph:openNode"; nodeId: string };
