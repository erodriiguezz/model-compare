import type { Decision } from "@/lib/report";

const CELLS: Record<string, [string, string]> = {
  better: ["Better", "ok"], worse: ["Worse", "bad"], equivalent: ["Tie", "info"], inconclusive: ["Inconclusive", "muted"],
  insufficient_data: ["Inconclusive", "muted"], incomplete: ["Incomplete", "warn"],
};
const LEGEND = [
  ["Better", "ok", "clearly ahead of the baseline"], ["Worse", "bad", "clearly behind the baseline"], ["Tie", "info", "equivalent, within 3 points"],
  ["Inconclusive", "muted", "no measurable difference yet"], ["Incomplete", "warn", "too many errors to trust"],
];

/** Candidate by capability. Every cell spells out its verdict; the colour only repeats it. */
export default function VerdictMatrix({ baseline, decisions }: { baseline: string; decisions: Decision[] }) {
  const caps = new Map<string, string>();
  decisions.forEach((d) => d.capabilities.forEach((c) => caps.set(c.dimension, c.label)));
  const dims = [...caps.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  if (!dims.length) return null;
  return (
    <section className="card" aria-labelledby="matrix-h">
      <h2 id="matrix-h">Verdict matrix</h2>
      <div className="table-wrap" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Model</th>{dims.map(([d, label]) => <th key={d} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            <tr>
              <th scope="row">{baseline} <span className="muted">(baseline)</span></th>
              {dims.map(([d]) => <td key={d} className="muted">Baseline</td>)}
            </tr>
            {decisions.map((dec) => (
              <tr key={dec.candidate}>
                <th scope="row">{dec.candidate}</th>
                {dims.map(([d]) => {
                  const c = dec.capabilities.find((x) => x.dimension === d);
                  if (!c) return <td key={d} className="muted">No data</td>;
                  const [label, tone] = CELLS[c.verdict] ?? [c.verdict, "muted"];
                  return (
                    <td key={d} data-verdict={c.verdict}>
                      <span className={`chip ${tone}`}>{label}</span>
                      <span className="muted small"> {c.delta_points >= 0 ? "+" : ""}{c.delta_points.toFixed(0)} pts</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="legend" aria-label="Legend">
        {LEGEND.map(([label, tone, text]) => <li key={label}><span className={`chip ${tone}`}>{label}</span><span className="muted small">{text}</span></li>)}
      </ul>
    </section>
  );
}
