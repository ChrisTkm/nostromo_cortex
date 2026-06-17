import type { InputHTMLAttributes } from "react";
import "./TextInput.css";

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={["atom-text-input", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
