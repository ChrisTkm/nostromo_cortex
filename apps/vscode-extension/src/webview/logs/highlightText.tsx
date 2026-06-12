import { Fragment, type ReactNode } from "react";

export function highlightLogText(text: string, query: string): ReactNode {
  const terms = query.trim().split(/\s+/).filter(Boolean).sort((left, right) => right.length - left.length);
  if (terms.length === 0) return text;
  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const segments = text.split(matcher);
  return segments.map((segment, index) => {
    if (!segment) return null;
    const isMatch = terms.some((term) => segment.toLowerCase() === term.toLowerCase());
    return isMatch ? (
      <mark className="logs-highlight" key={`${segment}-${index}`}>{segment}</mark>
    ) : (
      <Fragment key={`${segment}-${index}`}>{segment}</Fragment>
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
