import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  prefix?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ title, prefix = "/// ", subtitle, actions, children }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__row">
        <div className="page-header__brand">
          {prefix && <span className="page-header__prefix">{prefix}</span>}
          {title}
          {subtitle && <span className="page-header__subtitle">{subtitle}</span>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {children && <div className="page-header__content">{children}</div>}
    </header>
  );
}
