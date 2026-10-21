"use client";

import { Bar, BarChart, Cell, ErrorBar, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useChartColors, type Dimension } from "@/lib/report";

const ROW_H = 34;
const pct = (v: number) => Math.round(100 * v);

/** One horizontal bar chart per capability: score with a 95% interval whisker, best first, coloured by provider. */
export default function RankedBars({ dimensions, baseline }: { dimensions: Record<string, Dimension>; baseline: string }) {
  const colors = useChartColors();
  const dims = Object.entries(dimensions);
  if (!dims.length) return null;
  return (
    <section className="card" aria-labelledby="bars-h">
      <h2 id="bars-h">Score by capability</h2>
      <p className="muted small">Bars show the average score on the cases both models share; whiskers are the 95% interval. Incomplete models (too many errors) are hatched and not ranked on trust. Best first.</p>
      <div className="charts">
        {dims.map(([dim, info]) => {
          const rows = Object.entries(info.targets)
            .flatMap(([name, t]) => (t.quality == null || t.quality_ci[0] == null || t.quality_ci[1] == null ? [] : [{ name, t, q: t.quality, ci: [t.quality_ci[0], t.quality_ci[1]] as const }]))
            .map(({ name, t, q, ci }) => ({
              name, vendor: t.vendor, incomplete: t.incomplete, raw: q, score: pct(q), lo: pct(ci[0]), hi: pct(ci[1]),
              label: `${name}${name === baseline ? " (baseline)" : ""}${t.incomplete ? " (incomplete)" : ""}`,
              err: t.incomplete ? undefined : [pct(q) - pct(ci[0]), pct(ci[1]) - pct(q)],
            }))
            .sort((a, b) => b.raw - a.raw || a.name.localeCompare(b.name));
          if (!rows.length) {
            return (
              <figure key={dim} className="chart" data-chart="ranked-bars" data-dimension={dim}>
                <figcaption><strong>{info.label}</strong> <span className="muted small">0 shared cases</span></figcaption>
                <p className="muted">No scored cases — every call errored. Fix the errors and re-run.</p>
              </figure>
            );
          }
          const hatch = `hatch-${dim}`;
          const summary = `${info.label}: ${rows.map((r) => `${r.name} ${r.score}%${r.incomplete ? " incomplete, too many errors" : ` (${r.lo} to ${r.hi})`}`).join(", ")}`;
          return (
            <figure key={dim} className="chart" data-chart="ranked-bars" data-dimension={dim}>
              <figcaption><strong>{info.label}</strong> <span className="muted small">{info.n_cases} shared cases</span></figcaption>
              <div role="img" aria-label={summary} style={{ height: rows.length * ROW_H + 40 }}>
                {colors && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
                      <defs>
                        <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="6" height="6" fill={colors.surface} /><line x1="0" y1="0" x2="0" y2="6" stroke={colors.muted} strokeWidth="3" />
                        </pattern>
                      </defs>
                      <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" tick={{ fill: colors.muted, fontSize: 12 }} stroke={colors.border} />
                      <YAxis type="category" dataKey="label" width={108} tick={{ fill: colors.text, fontSize: 12 }} stroke={colors.border} interval={0} />
                      <Bar dataKey="score" isAnimationActive={false}>
                        {rows.map((r) => <Cell key={r.name} fill={r.incomplete ? `url(#${hatch})` : colors.provider(r.vendor)} stroke={r.incomplete ? colors.muted : undefined} />)}
                        <ErrorBar dataKey="err" direction="x" width={6} isAnimationActive={false} stroke={colors.text} strokeWidth={1.5} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="sr-only"><table>
                <caption>{info.label}</caption>
                <thead><tr><th>Model</th><th>Score</th><th>95% interval</th><th>Provider</th><th>Incomplete</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.name}><td>{r.label}</td><td>{r.score}%</td><td>{r.incomplete ? "not shown" : `${r.lo}% to ${r.hi}%`}</td><td>{r.vendor}</td><td>{r.incomplete ? "Incomplete" : "no"}</td></tr>)}</tbody>
              </table></div>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
