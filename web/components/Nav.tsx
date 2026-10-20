"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/compare/", label: "Compare" },
  { href: "/models/", label: "Models" },
  { href: "/projects/", label: "Projects" },
  { href: "/settings/", label: "Settings" },
];

export default function Nav() {
  const path = (usePathname() || "/").replace(/\/?$/, "/");
  const active = path === "/" ? "/compare/" : path;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" prefetch={false} className="brand">ModelCompare</Link>
        <nav aria-label="Main">
          <ul className="nav-list">
            {ITEMS.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} prefetch={false} className="nav-link" aria-current={active.startsWith(href) ? "page" : undefined}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
