"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; also?: string }[] = [
  { href: "/compare/", label: "Compare", also: "/history/" }, // History is a sub-tab of Compare
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
        <Link href="/" prefetch={false} className="brand">
          <svg viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="11" width="5" height="10" rx="1.5" fill="var(--vendor-anthropic)" /><rect x="8.5" y="4" width="5" height="17" rx="1.5" fill="var(--vendor-openai)" /><rect x="16" y="8" width="5" height="13" rx="1.5" fill="var(--vendor-google)" /></svg>
          ModelCompare
        </Link>
        <nav aria-label="Main">
          <ul className="nav-list">
            {ITEMS.map(({ href, label, also }) => (
              <li key={href}>
                <Link href={href} prefetch={false} className="nav-link" aria-current={active.startsWith(href) || (also && active.startsWith(also)) ? "page" : undefined}>
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
