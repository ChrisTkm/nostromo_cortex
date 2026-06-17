import { useCallback, useEffect, useRef, useState } from "react";

import { AiAgentAvatar } from "../ai-agent-avatar";
import "./AgentSelect.css";

export type CatalogAgent = {
  slug: string;
  displayName: string;
  iconUri: string;
};

function AgentIcon({ agent }: { agent: CatalogAgent }) {
  return (
    <AiAgentAvatar
      displayName={agent.displayName}
      iconPath={agent.iconUri}
      slug={agent.slug}
      size={18}
    />
  );
}

export function AgentSelect(props: {
  agents: CatalogAgent[];
  value: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = props.agents.find((a) => a.slug === props.value);
  const displayName = selected?.displayName ?? props.value;

  const handleSelect = useCallback(
    (slug: string) => {
      props.onChange(slug);
      setOpen(false);
    },
    [props.onChange],
  );

  return (
    <div className="as" ref={ref}>
      <button
        className="as__trigger"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {selected ? <AgentIcon agent={selected} /> : null}
        <span className="as__trigger-label">{displayName}</span>
        <span className={`as__arrow${open ? " as__arrow--open" : ""}`}>
          &#9662;
        </span>
      </button>
      {open ? (
        <ul className="as__menu">
          {props.agents.map((agent) => (
            <li
              className={`as__option${agent.slug === props.value ? " as__option--selected" : ""}`}
              key={agent.slug}
              onClick={() => handleSelect(agent.slug)}
              role="option"
            >
              <AgentIcon agent={agent} />
              <span>{agent.displayName}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
