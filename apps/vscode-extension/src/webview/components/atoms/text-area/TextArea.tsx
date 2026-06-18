import type { TextareaHTMLAttributes } from "react";
import "./TextArea.css";

export function TextArea({
  className,
  tall = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { tall?: boolean }) {
  return (
    <textarea
      className={[
        "atom-text-area",
        tall ? "atom-text-area--tall" : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
