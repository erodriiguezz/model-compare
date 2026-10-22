import { vendorColor } from "@/lib/vendor";
import type { Decision, Marker } from "@/lib/report";
import VerdictChip from "./ui/VerdictChip";

export type Latency = Record<string, { p50: number | null; p95: number | null }>;
type Row = { label: string; hint: string; values: (number | null)[]; fmt: (v: number) => string; best?: "high" | "low" };
const pct = (digits: number) => (v: number) => `${(100 * v).toFixed(digits)}%`;
const usd = (v: number) => `$${v.toFixed(v >= 10 ? 0 : 2)}`;
const secs = (v: number) => `${v.toFixed(1)} s`;

/** Indices of the best value in a row. Nothing is best when fewer than two values compare or they are all equal. */
function bestOf(values: (number | null)[], eligible: boolean[], dir?: "high" | "low"): Set<number> {
  const ok = values.flatMap((v, i) => (v != null && eligible[i] ? [{ v, i }] : []));
  if (!dir || ok.length < 2 || ok.every((o) => o.v === ok[0].v)) return new Set();
  const best = (dir === "high" ? Math.max : Math.min)(...ok.map((o) => o.v));
  return new Set(ok.filter((o) => o.v === best).map((o) => o.i));
}

/** Metric by model table. The best value in each row is tinted; incomplete models never win a row, and a missing value shows a dash. */
export default function KeyMetrics({ baseline, markers, decisions, regressions, costs, latency }: {
  baseline: string; markers: Record<string, Marker>; decisions: Decision[]; regressions: Record<string, number | null>; costs: Record<string, number>; latency: Latency;
}) {
  const models = Object.keys(markers);
  const col = (get: (m: string) => number | null | undefined) => models.map((m) => get(m) ?? null);
  const rows: Row[] = [
    { label: "Overall pass rate", hint: "Share of cases passed", values: col((m) => markers[m].task_success), fmt: pct(1), best: "high" },
    { label: "Verdict vs baseline", hint: "Paired bootstrap, 95% CI", values: [], fmt: String },
    { label: "Regressions", hint: "Cases the baseline passed and the candidate failed", values: col((m) => regressions[m]), fmt: String, best: "low" },
    { label: "Consistency", hint: "Same answer across repeats", values: col((m) => markers[m].consistency), fmt: pct(0), best: "high" },
    { label: "Cost per 1,000 tasks", hint: "List price", values: col((m) => markers[m].cost_per_1k_tasks), fmt: usd, best: "low" },
    { label: "Cost of this run", hint: "List price, all cases", values: col((m) => costs[m]), fmt: usd, best: "low" },
    { label: "Median latency (p50)", hint: "Seconds per call, averaged over benchmarks", values: col((m) => latency[m]?.p50), fmt: secs, best: "low" },
    { label: "Slow tail (p95)", hint: "Seconds per call, averaged over benchmarks", values: col((m) => latency[m]?.p95), fmt: secs, best: "low" },
    { label: "Error rate", hint: "Calls that failed and were not scored", values: col((m) => markers[m].error_rate), fmt: pct(1), best: "low" },
  ];
  const eligible = models.map((m) => !markers[m].incomplete);
  return (
    <section id="overview" className="report-section" aria-labelledby="metrics-h">
      <h2 id="metrics-h" className="sec">Key metrics</h2>
      <div className="card table-card"><div className="table-wrap" tabIndex={0}>
        <table className="metrics">
          <thead><tr><th scope="col">Metric</th>{models.map((m) => (
            <th key={m} scope="col" className="num"><span className="dot" style={{ background: vendorColor(m) }} /> {m}<div className="muted small">{m === baseline ? "Baseline" : "Candidate"}</div></th>
          ))}</tr></thead>
          <tbody>{rows.map((r) => {
            const best = bestOf(r.values, eligible, r.best);
            return (
              <tr key={r.label}>
                <th scope="row"><div>{r.label}</div><div className="muted small">{r.hint}</div></th>
                {models.map((m, i) => {
                  if (r.label.startsWith("Verdict")) {
                    const d = decisions.find((x) => x.candidate === m);
                    return <td key={m} className="num">{d ? <VerdictChip verdict={d.overall_verdict}>{d.overall_verdict_text}</VerdictChip> : <span className="muted">Baseline</span>}</td>;
                  }
                  const v = r.values[i];
                  return <td key={m} className="num">{v == null ? <span className="muted">—</span> : <span className={best.has(i) ? "best" : undefined} data-best={best.has(i) || undefined}>{r.fmt(v)}</span>}</td>;
                })}
              </tr>
            );
          })}</tbody>
        </table>
      </div></div>
      <p className="muted small">Tinted and bold marks the best value in each row. Incomplete models are not ranked.</p>
    </section>
  );
}

/** Mean latency per model across benchmarks, weighted by calls; null when no benchmark reports it. */
export function aggregateLatency(benchmarks: { summaries: Record<string, { n_calls: number; latency_p50?: number | null; latency_p95?: number | null }> }[]): Latency {
  const acc: Record<string, Record<"p50" | "p95", [number, number]>> = {};
  for (const b of benchmarks) {
    for (const [t, s] of Object.entries(b.summaries)) {
      const a = (acc[t] ??= { p50: [0, 0], p95: [0, 0] });
      for (const [k, v] of [["p50", s.latency_p50], ["p95", s.latency_p95]] as const) if (v != null && s.n_calls > 0) { a[k][0] += v * s.n_calls; a[k][1] += s.n_calls; }
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([t, a]) => [t, { p50: a.p50[1] ? a.p50[0] / a.p50[1] : null, p95: a.p95[1] ? a.p95[0] / a.p95[1] : null }]));
}
