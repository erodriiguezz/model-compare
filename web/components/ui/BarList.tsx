export type Bar = { label: string; value: number; display?: string; color?: string; ci?: [number, number]; hatched?: boolean };

/** Horizontal bar chart in plain CSS. Bars scale to `max` (default: the largest value); `sorted` puts the largest first. `ci` draws a whisker; `hatched` marks an untrusted bar. */
export default function BarList({ items, label, sorted = false, max: fixedMax }: { items: Bar[]; label: string; sorted?: boolean; max?: number }) {
  const rows = sorted ? [...items].sort((a, b) => b.value - a.value) : items;
  const max = fixedMax ?? (Math.max(...rows.map((r) => r.value), 0) || 1);
  const at = (v: number) => `${(100 * Math.min(Math.max(v, 0), max)) / max}%`;
  return (
    <ul className="barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span className="track">
            <span className={r.hatched ? "fill hatched" : "fill"} style={{ width: at(r.value), background: r.color }} />
            {r.ci && <span className="whisker" style={{ left: at(r.ci[0]), width: `calc(${at(r.ci[1])} - ${at(r.ci[0])})` }} />}
          </span>
          <span className="value">{r.display ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}
