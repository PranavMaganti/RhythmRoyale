import { ReactNode } from "react";
import { Link } from "react-router-dom";

export default function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden>
            ♪
          </span>
          Rhythm Royale
        </Link>
      </header>
      <main className={`content${wide ? " content--wide" : ""}`}>{children}</main>
    </div>
  );
}
