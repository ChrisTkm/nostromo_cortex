import type { ReactNode } from "react";
import "./Footer.css";

interface FooterProps {
  children?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export function Footer({ children, left, center, right }: FooterProps) {
  return (
    <footer className="molecule-footer">
      <div className="molecule-footer__left">{left ?? children}</div>
      <div className="molecule-footer__center">{center}</div>
      <div className="molecule-footer__right">{right}</div>
    </footer>
  );
}
