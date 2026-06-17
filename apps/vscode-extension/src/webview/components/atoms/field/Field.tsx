import type { ReactNode } from "react";
import "./Field.css";

export function Field(props: {
  children: ReactNode;
  hint?: ReactNode;
  label: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="atom-field">
      <span className="atom-field__label">
        {props.label}
        {props.required ? <span className="atom-field__required">*</span> : null}
      </span>
      {props.children}
      {props.hint ? <span className="atom-field__hint">{props.hint}</span> : null}
    </label>
  );
}
