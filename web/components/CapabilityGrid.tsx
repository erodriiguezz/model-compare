import { vendorColor } from "@/lib/vendor";
import type { Decision, Dimension } from "@/lib/report";
import BarList from "./ui/BarList";
import VerdictChip, { VERDICT } from "./ui/VerdictChip";

const LEGEND = [
  ["better", "clearly ahead of the baseline"], ["worse", "clearly behind the baseline"], ["equivalent", "equivalent, within 3 points"],
  ["inconclusive", "no measurable difference yet"], ["incomplete", "too many errors to trust"],
] as const;
const points = (v: number) => { const r = Math.round(v) || 0; return r > 0 ? `+${r}` : String(r); };
const pct = (v: number) => `${Math.round(100 * v)}%`;

/** One card per dimension: a bar per model with its 95% interval, best first, and a verdict chip per candidate. */
export default function CapabilityGrid({ dimensions, baseline, decisions }: { dimensions: Record<string, Dimension>; baseline: string; decisions: Decision[] }) {
  const dims = Object.entries(dimensions);
  if (!dims.length) return null;
  return (
    <section id="capabilities" className="report-section" aria-labelledby="capabilities-h">
      <div>
        <h2 id="capabilities-h" className="sec">Capabilities</h2>
        <p className="muted">Average score on the cases every model shares; whiskers are the 95% interval. Incomplete models are hatched and not ranked. The chips say whether each candidate&apos;s change against the baseline is real or noise.</p>
      </div>
      <ul className="legend" aria-label="Verdict legend">
        {LEGEND.map(([v, text]) => <li key={v}><VerdictChip tone={VERDICT[v].tone}>{VERDICT[v].label}</VerdictChip><span className="muted small">{text}</span></li>)}
      </ul>
      <div className="cap-grid">
        {dims.map(([dim, info]) => {
          const bars = Object.entries(info.targets).flatMap(([name, t]) => (t.quality == null || t.quality_ci[0] == null || t.quality_ci[1] == null ? [] : [{
            label: `${name}${name === baseline ? " (baseline)" : ""}${t.incomplete ? " (incomplete)" : ""}`, value: t.quality, display: pct(t.quality),
            color: t.incomplete ? undefined : vendorColor(name), hatched: t.incomplete, ci: t.incomplete ? undefined : [t.quality_ci[0], t.quality_ci[1]] as [number, number],
          }]));
          return (
            <article key={dim} className="card" aria-labelledby={`cap-${dim}`}>
              <div className="between"><h3 id={`cap-${dim}`}>{info.label}</h3><span className="muted small">{info.n_cases} shared cases</span></div>
              {bars.length ? <BarList label={`${info.label} score`} sorted max={1} items={bars} /> : <p className="muted">No scored cases — every call errored. Fix the errors and re-run.</p>}
              <ul className="verdicts" aria-label={`${info.label} verdicts`}>
                {decisions.map((d) => {
                  const c = d.capabilities.find((x) => x.dimension === dim);
                  return (
                    <li key={d.candidate}>
                      <span className="dot" style={{ background: vendorColor(d.candidate) }} />{d.candidate}
                      {c ? <VerdictChip verdict={c.verdict} /> : <VerdictChip tone="neutral">No data</VerdictChip>}
                      {c && <span className="muted small">{c.verdict === "insufficient_data" ? "n<10" : c.delta_points == null ? "—" : `${points(c.delta_points)} pts`}</span>}
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
