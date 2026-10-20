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
      <p className="muted small">Bars show the share of cases passed; whiskers are the 95% interval. Best first.</p>
      <div className="charts">
        {dims.map(([dim, info]) => {
          const rows = Object.entries(info.targets)
            .map(([name, t]) => ({
              name, vendor: t.vendor, score: pct(t.quality), lo: pct(t.quality_ci[0]), hi: pct(t.quality_ci[1]),
              label: `${name}${name === baseline ? " (baseline)" : ""}`,
              err: [pct(t.quality) - pct(t.quality_ci[0]), pct(t.quality_ci[1]) - pct(t.quality)],
            }))
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
          const summary = `${info.label}: ${rows.map((r) => `${r.name} ${r.score}% (${r.lo} to ${r.hi})`).join(", ")}`;
          return (
            <figure key={dim} className="chart" data-chart="ranked-bars" data-dimension={dim}>
              <figcaption><strong>{info.label}</strong> <span className="muted small">{info.n_cases} shared cases</span></figcaption>
              <div role="img" aria-label={summary} style={{ height: rows.length * ROW_H + 40 }}>
                {colors && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
                      <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" tick={{ fill: colors.muted, fontSize: 12 }} stroke={colors.border} />
                      <YAxis type="category" dataKey="label" width={108} tick={{ fill: colors.text, fontSize: 12 }} stroke={colors.border} interval={0} />
                      <Bar dataKey="score" isAnimationActive={false}>
                        {rows.map((r) => <Cell key={r.name} fill={colors.provider(r.vendor)} />)}
                        <ErrorBar dataKey="err" direction="x" width={6} stroke={colors.text} strokeWidth={1.5} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="sr-only"><table>
                <caption>{info.label}</caption>
                <thead><tr><th>Model</th><th>Score</th><th>95% interval</th><th>Provider</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.name}><td>{r.label}</td><td>{r.score}%</td><td>{r.lo}% to {r.hi}%</td><td>{r.vendor}</td></tr>)}</tbody>
              </table></div>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
