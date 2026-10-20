import Link from "next/link";

const TABS = [{ href: "/compare/", label: "New run" }, { href: "/history/", label: "History" }];

export default function SectionTabs({ active }: { active: "/compare/" | "/history/" }) {
  return (
    <nav aria-label="Compare sections" className="subtabs">
      {TABS.map(({ href, label }) => (
        <Link key={href} href={href} prefetch={false} aria-current={href === active ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
