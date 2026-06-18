import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./Button.css";

export type ButtonIntent = "action" | "refresh" | "new" | "change" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  intent?: ButtonIntent;
  size?: "default" | "small";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      intent = "action",
      size = "default",
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        className={[
          "atom-button",
          `atom-button--${intent}`,
          `atom-button--${size}`,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
        type="button"
        {...buttonProps}
      >
        {children}
      </button>
    );
  },
);
