export type Bar = { label: string; value: number; display?: string; color?: string };

/** Horizontal bar chart in plain CSS. Bars scale to the largest value; `sorted` puts the largest first. */
export default function BarList({ items, label, sorted = false }: { items: Bar[]; label: string; sorted?: boolean }) {
  const rows = sorted ? [...items].sort((a, b) => b.value - a.value) : items;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span className="track"><span className="fill" style={{ width: `${(100 * Math.max(r.value, 0)) / max}%`, background: r.color }} /></span>
          <span className="value">{r.display ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}
