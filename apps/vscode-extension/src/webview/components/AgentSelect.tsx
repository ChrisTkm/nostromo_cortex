import { useCallback, useEffect, useRef, useState } from "react";

export type CatalogAgent = {
  slug: string;
  displayName: string;
  iconUri: string;
};

function AgentIcon({ agent }: { agent: CatalogAgent }) {
  if (agent.iconUri) {
    return <img alt="" className="as__icon-img" src={agent.iconUri} />;
  }
  const hue = [...agent.slug].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const initial = agent.displayName.charAt(0).toUpperCase();
  return (
    <span className="as__icon-letter" style={{ background: `hsl(${hue}, 55%, 50%)` }}>
      {initial}
    </span>
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
      <button className="as__trigger" onClick={() => setOpen((o) => !o)} type="button">
        {selected ? <AgentIcon agent={selected} /> : null}
        <span className="as__trigger-label">{displayName}</span>
        <span className={`as__arrow${open ? " as__arrow--open" : ""}`}>&#9662;</span>
      </button>
      {open ? (
        <ul className="as__menu">
          {props.agents.map((a) => (
            <li
              className={`as__option${a.slug === props.value ? " as__option--selected" : ""}`}
              key={a.slug}
              onClick={() => handleSelect(a.slug)}
              role="option"
            >
              <AgentIcon agent={a} />
              <span>{a.displayName}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
