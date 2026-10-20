"use client";

import { CartesianGrid, LabelList, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
import { paretoFront, useChartColors, type Marker } from "@/lib/report";

const usd = (v: number) => `$${v >= 10 ? v.toFixed(0) : v.toFixed(2)}`;

/** Quality against cost per 1k tasks. Models on the Pareto front (nothing is both better and cheaper) are emphasised. */
export default function CostScatter({ markers, vendors }: { markers: Record<string, Marker>; vendors: Record<string, string> }) {
  const colors = useChartColors();
  const points = Object.entries(markers).map(([name, m]) => ({ name, vendor: vendors[name] ?? "", quality: Math.round(100 * m.task_success), cost: m.cost_per_1k_tasks }));
  if (points.length < 2) return null;
  const front = paretoFront(points);
  const onFront = new Set(front.map((p) => p.name));
  const rest = points.filter((p) => !onFront.has(p.name));
  const summary = `Quality against $ per 1k tasks. On the Pareto front: ${front.map((p) => `${p.name} ${p.quality}% at ${usd(p.cost)}`).join(", ")}. Others: ${rest.map((p) => `${p.name} ${p.quality}% at ${usd(p.cost)}`).join(", ") || "none"}.`;
  const vendorList = [...new Set(points.map((p) => p.vendor))];
  return (
    <section className="card" aria-labelledby="scatter-h">
      <h2 id="scatter-h">Quality vs cost</h2>
      <p className="muted small">Up and to the left is better. The line joins the models no other model beats on both.</p>
      <figure className="chart" data-chart="cost-scatter">
        <div role="img" aria-label={summary} className="scatter">
          {colors && (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 0 }}>
                <CartesianGrid stroke={colors.border} />
                <XAxis type="number" dataKey="cost" name="$ per 1k tasks" domain={[0, (max: number) => max * 1.15]} tickFormatter={usd} tick={{ fill: colors.muted, fontSize: 12 }} stroke={colors.border}
                  label={{ value: "$ per 1k tasks", position: "insideBottom", offset: -16, fill: colors.muted, fontSize: 12 }} />
                <YAxis type="number" dataKey="quality" name="Quality" domain={[0, 100]} unit="%" width={64} tick={{ fill: colors.muted, fontSize: 12 }} stroke={colors.border}
                  label={{ value: "Quality", angle: -90, position: "insideLeft", offset: 4, fill: colors.muted, fontSize: 12 }} />
                <Scatter data={rest} isAnimationActive={false} shape={(p: { cx?: number; cy?: number; payload?: { vendor: string } }) => (
                  <circle cx={p.cx} cy={p.cy} r={5} fill={colors.provider(p.payload?.vendor ?? "")} fillOpacity={0.35} />)}>
                  <LabelList dataKey="name" position="bottom" fill={colors.muted} fontSize={11} offset={10} />
                </Scatter>
                <Scatter data={front} isAnimationActive={false} line={{ stroke: colors.accent, strokeWidth: 2 }} lineType="joint" shape={(p: { cx?: number; cy?: number; payload?: { vendor: string } }) => (
                  <circle cx={p.cx} cy={p.cy} r={8} fill={colors.provider(p.payload?.vendor ?? "")} stroke={colors.text} strokeWidth={2} />)}>
                  <LabelList dataKey="name" position="top" fill={colors.text} fontSize={12} fontWeight={600} offset={12} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
        <ul className="legend" aria-label="Providers">
          {vendorList.map((v) => <li key={v}><span className="provider-dot" style={{ background: colors?.provider(v) }} />{v}</li>)}
        </ul>
        <div className="sr-only"><table>
          <caption>Quality and cost per model</caption>
          <thead><tr><th>Model</th><th>Quality</th><th>$ per 1k tasks</th><th>Pareto front</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.name} data-target={p.name} data-pareto={onFront.has(p.name)}><td>{p.name}</td><td>{p.quality}%</td><td>{usd(p.cost)}</td><td>{onFront.has(p.name) ? "yes" : "no"}</td></tr>)}</tbody>
        </table></div>
      </figure>
    </section>
  );
}
