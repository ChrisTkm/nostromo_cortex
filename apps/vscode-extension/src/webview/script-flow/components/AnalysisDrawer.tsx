import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  SCRIPT_FLOW_NODE_KINDS,
  type ScriptFlowAutoObservation,
  type ScriptFlowNode,
  type ScriptFlowNodeKind,
} from "../../../scriptFlow/types.js";
import { Button } from "../../components/atoms";
import { DrawerShell } from "../../components/molecules";
import { getScriptFlowFixHint } from "../messageHints";
import { KIND_LABELS } from "./FlowNode";

type AnalysisDrawerProps = {
  nodes: ScriptFlowNode[];
  activeNodeId: string | null;
  isOpen: boolean;
  mode: "messages" | "nodes";
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
};

type NodeGroup = {
  kind: ScriptFlowNodeKind;
  label: string;
  items: ScriptFlowNode[];
};

type MessageItem = {
  key: string;
  node: ScriptFlowNode;
  observation: ScriptFlowAutoObservation;
};

type MessageGroup = {
  kind: ScriptFlowAutoObservation["kind"];
  label: string;
  items: MessageItem[];
};

type MessageFilter =
  | "all"
  | "error"
  | "warning"
  | "flow-gap"
  | "diagnostic"
  | "inline";

type MessageFilterStats = Record<MessageFilter, number>;

const MESSAGE_FILTERS: Array<{ value: MessageFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "error", label: "Errores" },
  { value: "warning", label: "Warnings" },
  { value: "flow-gap", label: "Flow gaps" },
  { value: "diagnostic", label: "Diagnósticos" },
  { value: "inline", label: "Inline" },
];

export function AnalysisDrawer(props: AnalysisDrawerProps) {
  const { activeNodeId, isOpen, mode, nodes, onClose, onSelectNode } = props;
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");

  const groups = useMemo<NodeGroup[]>(() => {
    const byKind = new Map<ScriptFlowNodeKind, ScriptFlowNode[]>();
    for (const node of nodes) {
      const list = byKind.get(node.kind) ?? [];
      list.push(node);
      byKind.set(node.kind, list);
    }
    return SCRIPT_FLOW_NODE_KINDS.filter((kind) => byKind.has(kind)).map(
      (kind) => ({
        kind,
        label: KIND_LABELS[kind],
        items: byKind.get(kind) ?? [],
      }),
    );
  }, [nodes]);

  const messageGroups = useMemo<MessageGroup[]>(() => {
    const byKind = new Map<ScriptFlowAutoObservation["kind"], MessageItem[]>();
    for (const node of nodes) {
      const observations = readNodeObservations(node);
      observations.forEach((observation, index) => {
        const list = byKind.get(observation.kind) ?? [];
        list.push({
          key: `${node.id}::${observation.kind}::${index}`,
          node,
          observation,
        });
        byKind.set(observation.kind, list);
      });
    }

    return (["flow-gap", "diagnostic", "inline"] as const)
      .filter((kind) => byKind.has(kind))
      .map((kind) => ({
        kind,
        label: messageKindLabel(kind),
        items: byKind.get(kind) ?? [],
      }));
  }, [nodes]);

  const messageStats = useMemo(
    () => countMessageFilters(flattenMessageGroups(messageGroups)),
    [messageGroups],
  );

  const filteredMessageGroups = useMemo(
    () =>
      messageGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            messageMatchesFilter(item, messageFilter),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [messageFilter, messageGroups],
  );

  useEffect(() => {
    if (!isOpen || !activeNodeId) {
      return;
    }
    const target =
      itemRefs.current.get(activeNodeId) ??
      [...itemRefs.current.entries()].find(([key]) =>
        key.startsWith(`${activeNodeId}::`),
      )?.[1];
    target?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeNodeId, isOpen, mode]);

  const header = (
    <>
      <div className="drawer-header__code">
        {mode === "messages" ? "MESSAGES" : "OUTLINE"}
      </div>
      <h2 className="drawer-header__title">
        {mode === "messages"
          ? `${messageStats.all} mensajes`
          : `${nodes.length} nodos`}
      </h2>
    </>
  );

  const actions = (
    <Button className="is-active" intent="change" size="small">
      {mode === "messages" ? "Mensajes" : "Nodos"}
    </Button>
  );

  const hasMessages = messageGroups.length > 0;
  const hasFilteredMessages = filteredMessageGroups.length > 0;

  return (
    <DrawerShell actions={actions} header={header} isOpen={isOpen} onClose={onClose}>
      {mode === "messages" ? (
        hasMessages ? (
          <>
            <MessageFilters
              stats={messageStats}
              value={messageFilter}
              onChange={setMessageFilter}
            />
            {hasFilteredMessages ? (
              <MessageGroups
                activeNodeId={activeNodeId}
                groups={filteredMessageGroups}
                itemRefs={itemRefs}
                onSelectNode={onSelectNode}
              />
            ) : (
              <div className="drawer-empty">
                No hay mensajes para este filtro.
              </div>
            )}
          </>
        ) : (
          <div className="drawer-empty">Este script no tiene mensajes.</div>
        )
      ) : groups.length === 0 ? (
        <div className="drawer-empty">El script no tiene nodos.</div>
      ) : (
        <div className="drawer-panel">
          {groups.map((group, index) => (
            <Fragment key={group.kind}>
              {index > 0 ? <div className="drawer-divider" /> : null}
              <section className="drawer-section drawer-section--spacious">
                <div className="drawer-section__label">
                  {group.label} · {group.items.length}
                </div>
                <div className="drawer-list drawer-list--stack">
                  {group.items.map((node) => (
                    <button
                      className={`drawer-link${
                        activeNodeId === node.id ? " is-active" : ""
                      }`}
                      key={node.id}
                      onClick={() => onSelectNode(node.id)}
                      ref={bindItemRef(itemRefs, node.id)}
                      title={node.label}
                      type="button"
                    >
                      <span>{node.label}</span>
                      <NodeSignalSummary node={node} />
                    </button>
                  ))}
                </div>
              </section>
            </Fragment>
          ))}
        </div>
      )}
    </DrawerShell>
  );
}

function MessageFilters(props: {
  stats: MessageFilterStats;
  value: MessageFilter;
  onChange: (value: MessageFilter) => void;
}) {
  return (
    <div className="sf-message-filters" aria-label="Filtrar mensajes">
      {MESSAGE_FILTERS.map((filter) => (
        <button
          className={`sf-message-filter${
            props.value === filter.value ? " is-active" : ""
          } sf-message-filter--${filter.value}`}
          disabled={props.stats[filter.value] === 0}
          key={filter.value}
          onClick={() => props.onChange(filter.value)}
          type="button"
        >
          <span>{filter.label}</span>
          <strong>{props.stats[filter.value]}</strong>
        </button>
      ))}
    </div>
  );
}

function MessageGroups(props: {
  activeNodeId: string | null;
  groups: MessageGroup[];
  itemRefs: { current: Map<string, HTMLButtonElement> };
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <div className="drawer-panel sf-message-panel">
      {props.groups.map((group, index) => (
        <Fragment key={group.kind}>
          {index > 0 ? <div className="drawer-divider" /> : null}
          <section className="drawer-section drawer-section--spacious">
            <div className="drawer-section__label">
              {group.label} · {group.items.length}
            </div>
            <div className="drawer-list drawer-list--stack">
              {group.items.map((item) => (
                <MessageButton
                  activeNodeId={props.activeNodeId}
                  item={item}
                  itemRefs={props.itemRefs}
                  key={item.key}
                  onSelectNode={props.onSelectNode}
                />
              ))}
            </div>
          </section>
        </Fragment>
      ))}
    </div>
  );
}

function MessageButton(props: {
  activeNodeId: string | null;
  item: MessageItem;
  itemRefs: { current: Map<string, HTMLButtonElement> };
  onSelectNode: (nodeId: string) => void;
}) {
  const { item } = props;
  const fixHint = getScriptFlowFixHint(item.observation);
  return (
    <button
      className={`drawer-link sf-message-link${
        props.activeNodeId === item.node.id ? " is-active" : ""
      } sf-message-link--${item.observation.severity}`}
      onClick={() => props.onSelectNode(item.node.id)}
      ref={bindItemRef(props.itemRefs, item.key)}
      title={`${item.node.label}\n${item.observation.message}`}
      type="button"
    >
      <span className="sf-message-link__meta">
        <span className="sf-message-link__kind">
          {KIND_LABELS[item.node.kind]}
        </span>
        {typeof item.observation.line === "number" ? (
          <span>L{item.observation.line}</span>
        ) : null}
      </span>
      <span className="sf-message-link__message">
        {item.observation.message}
      </span>
      {fixHint ? (
        <span className="sf-message-link__hint">
          <span className="sf-message-link__hint-label">Hint</span>
          {fixHint}
        </span>
      ) : null}
      <span className="sf-message-link__node">{item.node.label}</span>
    </button>
  );
}

function flattenMessageGroups(groups: MessageGroup[]) {
  return groups.flatMap((group) => group.items);
}

function countMessageFilters(items: MessageItem[]): MessageFilterStats {
  return items.reduce<MessageFilterStats>(
    (counts, item) => {
      counts.all += 1;
      if (item.observation.severity === "error") {
        counts.error += 1;
      }
      if (item.observation.severity === "warning") {
        counts.warning += 1;
      }
      if (item.observation.kind === "flow-gap") {
        counts["flow-gap"] += 1;
      }
      if (item.observation.kind === "diagnostic") {
        counts.diagnostic += 1;
      }
      if (item.observation.kind === "inline") {
        counts.inline += 1;
      }
      return counts;
    },
    {
      all: 0,
      error: 0,
      warning: 0,
      "flow-gap": 0,
      diagnostic: 0,
      inline: 0,
    },
  );
}

function messageMatchesFilter(item: MessageItem, filter: MessageFilter) {
  switch (filter) {
    case "all":
      return true;
    case "error":
    case "warning":
      return item.observation.severity === filter;
    case "flow-gap":
    case "diagnostic":
    case "inline":
      return item.observation.kind === filter;
  }
}

function NodeSignalSummary(props: { node: ScriptFlowNode }) {
  const observations = readNodeObservations(props.node);
  if (observations.length === 0) {
    return null;
  }
  const hasError = observations.some((item) => item.severity === "error");
  const hasWarning = observations.some((item) => item.severity === "warning");
  return (
    <span
      className={`drawer-link__signals${
        hasError ? " drawer-link__signals--error" : hasWarning ? " drawer-link__signals--warning" : ""
      }`}
      title={observations.map((item) => item.message).join("\n")}
    >
      {observations.length}
    </span>
  );
}

function bindItemRef(
  refs: { current: Map<string, HTMLButtonElement> },
  key: string,
) {
  return (element: HTMLButtonElement | null) => {
    if (element) {
      refs.current.set(key, element);
      return;
    }
    refs.current.delete(key);
  };
}

function readNodeObservations(node: ScriptFlowNode) {
  return Array.isArray(node.meta?.autoObservations)
    ? (node.meta.autoObservations as ScriptFlowAutoObservation[])
    : [];
}

function messageKindLabel(kind: ScriptFlowAutoObservation["kind"]) {
  switch (kind) {
    case "flow-gap":
      return "Flow gaps";
    case "diagnostic":
      return "Diagnósticos";
    case "inline":
      return "Inline notes";
  }
}
