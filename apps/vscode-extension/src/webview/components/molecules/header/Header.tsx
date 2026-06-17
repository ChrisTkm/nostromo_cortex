import type { ReactNode } from "react";
import "./Header.css";

export interface HeaderProps {
  actions?: ReactNode;
  children?: ReactNode;
  /**
   * Whether this module reads data from outside the DB (BR, SC, LG). Only
   * external modules render `route`; internal ones (GR, PL, NT, AR, LD) hide
   * it regardless of whether a route is passed.
   */
  external?: boolean;
  name?: string;
  prefix?: string;
  route?: ReactNode;
  subtitle?: ReactNode;
  title?: string;
}

export function Header({
  actions,
  children,
  external = false,
  name,
  prefix = "/// ",
  route,
  subtitle,
  title,
}: HeaderProps) {
  const label = title ?? name ?? "";
  const showRoute = external && route != null;
  const routeNode =
    typeof route === "string" ? (
      <span className="page-header__route-chip">
        <svg
          aria-hidden="true"
          className="page-header__route-icon"
          height="13"
          viewBox="0 0 16 16"
          width="13"
        >
          <path
            d="M1.5 3.75A1.25 1.25 0 0 1 2.75 2.5h3.06c.33 0 .65.13.88.37l.94.93h5.12A1.25 1.25 0 0 1 14 6.08v5.67a1.25 1.25 0 0 1-1.25 1.25h-10A1.25 1.25 0 0 1 1.5 11.75v-8Z"
            fill="currentColor"
          />
        </svg>
        {route}
      </span>
    ) : (
      route
    );

  return (
    <header className="page-header">
      <div className="page-header__row">
        <div className="page-header__brand">
          {prefix && <span className="page-header__prefix">{prefix}</span>}
          {label}
          {subtitle && (
            <span className="page-header__subtitle">{subtitle}</span>
          )}
        </div>
        {(showRoute || actions) && (
          <div className="page-header__right">
            {showRoute && <div className="page-header__route">{routeNode}</div>}
            {actions && <div className="page-header__actions">{actions}</div>}
          </div>
        )}
      </div>
      {children && <div className="page-header__content">{children}</div>}
    </header>
  );
}
