import { useEffect, useMemo, useState } from "react";

import type { SnapshotNode } from "../types";

type PromptTab = "prompt" | "acceptance" | "out_of_scope";

const TAB_LABELS: Record<PromptTab, string> = {
  prompt: "Prompt",
  acceptance: "Acceptance",
  out_of_scope: "Out of Scope"
};

export function PromptPanel(props: {
  node: SnapshotNode;
  onClose(): void;
}) {
  const [activeTab, setActiveTab] = useState<PromptTab>("prompt");
  const [copiedTab, setCopiedTab] = useState<PromptTab | null>(null);

  const tabContent = useMemo<Record<PromptTab, string>>(
    () => ({
      prompt: props.node.prompt ?? "",
      acceptance: props.node.acceptance ?? "",
      out_of_scope: props.node.outOfScope ?? ""
    }),
    [props.node.acceptance, props.node.outOfScope, props.node.prompt]
  );

  useEffect(() => {
    setActiveTab("prompt");
    setCopiedTab(null);
  }, [props.node.code]);

  useEffect(() => {
    if (!copiedTab) {
      return;
    }

    const handle = window.setTimeout(() => setCopiedTab(null), 1000);
    return () => window.clearTimeout(handle);
  }, [copiedTab]);

  async function handleCopy(tab: PromptTab) {
    await navigator.clipboard.writeText(tabContent[tab]);
    setCopiedTab(tab);
  }

  return (
    <section className="prompt-panel" id="prompt-panel">
      <div className="prompt-panel__header">
        <div>
          <div className="drawer-panel__code">{props.node.code}</div>
          <h2 className="drawer-panel__title">Prompt panel</h2>
        </div>
        <div className="prompt-panel__actions">
          <button className="app-toolbar__button" onClick={props.onClose} type="button">
            Close
          </button>
        </div>
      </div>

      <div className="prompt-panel__tabs" role="tablist" aria-label="Prompt sections">
        {(Object.keys(TAB_LABELS) as PromptTab[]).map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={`prompt-panel__tab${activeTab === tab ? " prompt-panel__tab--active" : ""}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            type="button"
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="prompt-panel__toolbar">
        <div className="drawer-section__label">{TAB_LABELS[activeTab]}</div>
        <button className="app-toolbar__button" onClick={() => void handleCopy(activeTab)} type="button">
          {copiedTab === activeTab ? "Copied!" : "Copy"}
        </button>
      </div>

      <pre className="prompt-panel__content">{tabContent[activeTab] || `No ${TAB_LABELS[activeTab].toLowerCase()} provided.`}</pre>
    </section>
  );
}
