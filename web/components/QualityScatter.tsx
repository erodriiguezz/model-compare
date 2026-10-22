"use client";

import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, usePlotArea, XAxis, useXAxisScale, YAxis, useYAxisScale } from "recharts";
import { paretoFront, useChartColors, type Marker } from "@/lib/report";

const usd = (v: number) => `$${v >= 10 ? v.toFixed(0) : v.toFixed(2)}`;
const SPEC = {
  cost: { key: "cost_per_1k_tasks", fmt: usd, axis: "$ per 1k tasks", title: "Quality vs cost", chart: "cost-scatter", note: "Quality is the overall pass rate across every case a model ran. The line joins the models no other model beats on both.", sr: "Overall pass rate and cost per model" },
  latency: { key: "latency_p50", fmt: (v: number) => `${v.toFixed(1)} s`, axis: "Median latency (s)", title: "Quality vs latency", chart: "latency-scatter", note: "Quality is the overall pass rate across every case a model ran. The line joins the models no other model beats on both quality and speed.", sr: "Overall pass rate and median latency per model" },
} as const;
type Pt = { name: string; x: number; quality: number; label: string };
const LINE = 17, GAP = 14, CHAR = 6.6;

/**
 * One label per cluster of neighbouring models, so names never pile up: the names sit as lines beside the
 * cluster's rightmost dot (leftmost when the right edge is too close), best model first, kept inside the plot area.
 */
function ClusterLabels({ clusters, front, fill, accent }: { clusters: Pt[][]; front: Set<string>; fill: string; accent: string }) {
  const area = usePlotArea(), sx = useXAxisScale(), sy = useYAxisScale();
  if (!area || !sx || !sy) return null;
  return (
    <g className="scatter-labels" fontSize={12}>
      {clusters.map((c) => {
        const px = c.map((p) => Number(sx(p.x))), py = c.map((p) => Number(sy(p.quality)));
        const h = c.length * LINE, wide = Math.max(...c.map((p) => p.label.length)) * CHAR;
        const right = Math.max(...px) + GAP + wide <= area.x + area.width;
        const x = right ? Math.max(...px) + GAP : Math.min(...px) - GAP;
        const mid = (Math.min(...py) + Math.max(...py)) / 2;
        const top = Math.min(Math.max(mid - h / 2, area.y), area.y + area.height - h);
        return (
          <text key={c.map((p) => p.name).join("|")} x={x} y={top} textAnchor={right ? "start" : "end"} fill={fill}>
            {c.map((p, i) => <tspan key={p.name} x={x} dy={i === 0 ? LINE - 3 : LINE} fontWeight={front.has(p.name) ? 600 : 400} fill={front.has(p.name) ? accent : fill}>{p.label}</tspan>)}
          </text>
        );
      })}
    </g>
  );
}
type Shape = { cx?: number; cy?: number; payload?: { vendor: string } };

/**
 * Overall pass rate (cases passed of every case a model ran) against list-price cost per 1k tasks, or median latency (`x="latency"`).
 * Models on the Pareto front (nothing is both better and cheaper) are emphasised; incomplete models
 * (too many errors to trust) are drawn hollow, labelled, and neither join the front nor beat anyone.
 */
export default function QualityScatter({ markers, vendors, x = "cost" }: { markers: Record<string, Marker>; vendors: Record<string, string>; x?: keyof typeof SPEC }) {
  const colors = useChartColors();
  const spec = SPEC[x];
  const fmtX = spec.fmt;
  const points = Object.entries(markers).flatMap(([name, m]) => (m.task_success == null || m[spec.key] == null ? [] : [{
    name, vendor: vendors[name] ?? "", quality: 100 * m.task_success, x: m[spec.key] as number, incomplete: m.incomplete,
    label: m.incomplete ? `${name} (incomplete)` : name,
  }]));
  if (points.length < 2) return null;
  const front = paretoFront(points);
  const onFront = new Set(front.map((p) => p.name));
  // Models that sit close together (a chain of near neighbours) share one label.
  const maxX = Math.max(...points.map((p) => p.x));
  const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) <= 0.08 * maxX && Math.abs(a.quality - b.quality) < 14;
  const clusters: Pt[][] = [];
  for (const p of [...points].sort((a, b) => b.quality - a.quality)) {
    const hits = clusters.filter((c) => c.some((q) => near(p, q)));
    const merged = [p, ...hits.flat()].sort((a, b) => b.quality - a.quality);
    clusters.splice(0, clusters.length, ...clusters.filter((c) => !hits.includes(c)), merged);
  }
  const incomplete = points.filter((p) => p.incomplete);
  const rest = points.filter((p) => !onFront.has(p.name) && !p.incomplete);
  const fmt = (p: (typeof points)[number]) => `${p.name} ${Math.round(p.quality)}% at ${fmtX(p.x)}`;
  const summary = `Overall pass rate against ${spec.axis}. On the Pareto front: ${front.map(fmt).join(", ")}. Others: ${rest.map(fmt).join(", ") || "none"}.${incomplete.length ? ` Incomplete, too many errors to rank: ${incomplete.map(fmt).join(", ")} (incomplete).` : ""}`;
  const vendorList = [...new Set(points.map((p) => p.vendor))];
  return (
    <section className="card" aria-labelledby={`${spec.chart}-h`}>
      <h3 id={`${spec.chart}-h`}>{spec.title}</h3>
      <p className="muted small">Up and to the left is better. {spec.note}</p>
      <figure className="chart" data-chart={spec.chart}>
        <div role="img" aria-label={summary} className="scatter">
          {colors && (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 0 }}>
                <CartesianGrid stroke={colors.border} />
                <XAxis type="number" dataKey="x" name={spec.axis} domain={[0, (max: number) => max * 1.15]} tickFormatter={fmtX} tick={{ fill: colors.muted, fontSize: 12 }} stroke={colors.border}
                  label={{ value: spec.axis, position: "insideBottom", offset: -16, fill: colors.muted, fontSize: 12 }} />
                <YAxis type="number" dataKey="quality" name="Overall pass rate" domain={[0, 100]} unit="%" width={64} tick={{ fill: colors.muted, fontSize: 12 }} stroke={colors.border}
                  label={{ value: "Overall pass rate", angle: -90, position: "insideLeft", offset: 4, fill: colors.muted, fontSize: 12 }} />
                <Scatter data={rest} isAnimationActive={false} shape={(p: Shape) => (
                  <circle cx={p.cx} cy={p.cy} r={5} fill={colors.provider(p.payload?.vendor ?? "")} fillOpacity={0.35} />)}>
                </Scatter>
                <Scatter data={incomplete} isAnimationActive={false} shape={(p: Shape) => (
                  <circle cx={p.cx} cy={p.cy} r={5} fill={colors.surface} stroke={colors.muted} strokeWidth={2} strokeDasharray="3 2" />)}>
                </Scatter>
                <Scatter data={front} isAnimationActive={false} line={{ stroke: colors.accent, strokeWidth: 2 }} lineType="joint" shape={(p: Shape) => (
                  <circle cx={p.cx} cy={p.cy} r={8} fill={colors.provider(p.payload?.vendor ?? "")} stroke={colors.text} strokeWidth={2} />)}>
                </Scatter>
                <ClusterLabels clusters={clusters} front={onFront} fill={colors.muted} accent={colors.text} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
        <ul className="legend" aria-label="Providers">
          {vendorList.map((v) => <li key={v}><span className="provider-dot" style={{ background: colors?.provider(v) }} />{v}</li>)}
        </ul>
        <div className="sr-only">
          <table>
            <caption>{spec.sr}</caption>
            <thead><tr><th>Model</th><th>Pass rate</th><th>{spec.axis}</th><th>Pareto front</th><th>Incomplete</th></tr></thead>
            <tbody>{points.map((p) => (
              <tr key={p.name} data-target={p.name} data-pareto={onFront.has(p.name)} data-incomplete={p.incomplete}>
                <td>{p.name}</td><td>{Math.round(p.quality)}%</td><td>{fmtX(p.x)}</td><td>{onFront.has(p.name) ? "yes" : "no"}</td><td>{p.incomplete ? "Incomplete" : "no"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </figure>
    </section>
  );
}
