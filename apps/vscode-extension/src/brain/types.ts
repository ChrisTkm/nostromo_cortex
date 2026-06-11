export type BrainNodeKind = "doc" | "tag" | "account" | "external";

export type BrainEdgeKind = "link" | "tag" | "account" | "unresolved";

export type BrainIssueKind = "orphan" | "cycle" | "self-reference" | "broken-ref" | "truncated";

export type BrainIssue = {
  kind: BrainIssueKind;
  nodeId: string;
  detail?: string;
};

export type BrainNode = {
  id: string;
  kind: BrainNodeKind;
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
  isOrphan?: boolean;
};

export type BrainEdge = {
  id: string;
  from: string;
  to: string;
  kind: BrainEdgeKind;
  label?: string;
};

export type BrainSnapshot = {
  rootPath: string;
  generatedAt: string;
  nodes: BrainNode[];
  edges: BrainEdge[];
  issues: BrainIssue[];
  stats: {
    fileCount: number;
    tagCount: number;
    accountCount: number;
    orphanCount: number;
    unresolvedCount: number;
    elapsedMs: number;
  };
};

export type BrainHostMessage =
  | {
      type: "brain:snapshot";
      snapshot: BrainSnapshot;
    }
  | {
      type: "brain:error";
      error: string;
    };

export type BrainWebviewMessage =
  | { type: "ready" }
  | { type: "brain:refresh" }
  | { type: "brain:pickFolder" }
  | { type: "brain:openNode"; nodeId: string };
