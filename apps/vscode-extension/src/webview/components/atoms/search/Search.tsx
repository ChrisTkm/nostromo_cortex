import type { KeyboardEventHandler, MutableRefObject } from "react";
import "./Search.css";

interface SearchProps {
  className?: string;
  inputRef?: MutableRefObject<HTMLInputElement | null>;
  onChange(value: string): void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  value: string;
}

export function Search({
  className,
  inputRef,
  onChange,
  onKeyDown,
  placeholder = "Search...",
  value,
}: SearchProps) {
  return (
    <div className={["atom-search", className].filter(Boolean).join(" ")}>
      <svg
        aria-hidden="true"
        className="atom-search__icon"
        fill="none"
        height="14"
        viewBox="0 0 16 16"
        width="14"
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
        <line
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
          x1="10.5"
          x2="14"
          y1="10.5"
          y2="14"
        />
      </svg>
      <input
        className="atom-search__input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={(element) => {
          if (inputRef) {
            inputRef.current = element;
          }
        }}
        spellCheck={false}
        type="search"
        value={value}
      />
    </div>
  );
}
