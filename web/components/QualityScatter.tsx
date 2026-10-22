"use client";

import { CartesianGrid, LabelList, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
import { paretoFront, useChartColors, type Marker } from "@/lib/report";

const usd = (v: number) => `$${v >= 10 ? v.toFixed(0) : v.toFixed(2)}`;
const SPEC = {
  cost: { key: "cost_per_1k_tasks", fmt: usd, axis: "$ per 1k tasks", title: "Quality vs cost", chart: "cost-scatter", note: "Quality is the overall pass rate across every case a model ran. The line joins the models no other model beats on both.", sr: "Overall pass rate and cost per model" },
  latency: { key: "latency_p50", fmt: (v: number) => `${v.toFixed(1)} s`, axis: "Median latency (s)", title: "Quality vs latency", chart: "latency-scatter", note: "Quality is the overall pass rate across every case a model ran. The line joins the models no other model beats on both quality and speed.", sr: "Overall pass rate and median latency per model" },
} as const;
type LabelProps = { x?: number | string; y?: number | string; index?: number };
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
  // Models at (nearly) the same spot would print their names on top of each other: each gets its own line,
  // frontier names stacked upward and the rest downward.
  const maxX = Math.max(...points.map((p) => p.x));
  const near = (a: (typeof points)[number], b: (typeof points)[number]) => Math.abs(a.x - b.x) <= 0.08 * maxX && Math.abs(a.quality - b.quality) < 8;
  const placed = points.map((p, i) => ({ ...p, slot: points.slice(0, i).filter((q) => onFront.has(q.name) === onFront.has(p.name) && near(p, q)).length }));
  const slotOf = new Map(placed.map((p) => [p.name, p.slot]));
  const withSlot = (list: typeof points) => list.map((p) => ({ ...p, slot: slotOf.get(p.name) ?? 0 }));
  const labelAt = (dir: 1 | -1, fill: string, weight: number, size: number, data: { label: string; slot: number }[]) =>
    function Label({ x, y, index }: LabelProps) {
      const d = data[index ?? 0];
      if (d == null || x == null || y == null) return null;
      return <text x={Number(x)} y={Number(y) + dir * (14 + d.slot * (size + 3))} textAnchor="middle" fill={fill} fontSize={size} fontWeight={weight}>{d.label}</text>;
    };
  const incomplete = points.filter((p) => p.incomplete);
  const rest = points.filter((p) => !onFront.has(p.name) && !p.incomplete);
  const restData = withSlot(rest), incompleteData = withSlot(incomplete), frontData = withSlot(front);
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
                <Scatter data={restData} isAnimationActive={false} shape={(p: Shape) => (
                  <circle cx={p.cx} cy={p.cy} r={5} fill={colors.provider(p.payload?.vendor ?? "")} fillOpacity={0.35} />)}>
                  <LabelList dataKey="label" content={labelAt(1, colors.muted, 400, 11, restData)} />
                </Scatter>
                <Scatter data={incompleteData} isAnimationActive={false} shape={(p: Shape) => (
                  <circle cx={p.cx} cy={p.cy} r={5} fill={colors.surface} stroke={colors.muted} strokeWidth={2} strokeDasharray="3 2" />)}>
                  <LabelList dataKey="label" content={labelAt(1, colors.muted, 400, 11, incompleteData)} />
                </Scatter>
                <Scatter data={frontData} isAnimationActive={false} line={{ stroke: colors.accent, strokeWidth: 2 }} lineType="joint" shape={(p: Shape) => (
                  <circle cx={p.cx} cy={p.cy} r={8} fill={colors.provider(p.payload?.vendor ?? "")} stroke={colors.text} strokeWidth={2} />)}>
                  <LabelList dataKey="label" content={labelAt(-1, colors.text, 600, 12, frontData)} />
                </Scatter>
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
