import Link from "next/link";

type Tab = { href: string; label: string };
const COMPARE_TABS: Tab[] = [{ href: "/compare/", label: "New comparison" }, { href: "/history/", label: "History" }];

/** Tab row under a page title. Defaults to Compare › New comparison / History; pass `tabs` (e.g. `#anchors`) for other sections. */
export default function SectionTabs({ active, tabs = COMPARE_TABS, label = "Compare sections", crumb = "Compare" }: { active: string; tabs?: Tab[]; label?: string; crumb?: string }) {
  return (
    <nav aria-label={label} className="subtabs">
      {crumb && <span className="crumb" aria-hidden="true">{crumb} ›</span>}
      {tabs.map(({ href, label: text }) => (
        <Link key={href} href={href} prefetch={false} aria-current={href === active ? "page" : undefined}>{text}</Link>
      ))}
    </nav>
  );
}
