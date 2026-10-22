import { vendorColor } from "@/lib/vendor";
import type { Decision, Marker } from "@/lib/report";
import VerdictChip, { VERDICT_NOTE } from "./ui/VerdictChip";

type Row = { kind?: "verdict"; label: string; hint: string; values: (number | null)[]; fmt: (v: number) => string; best?: "high" | "low" };
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
export default function KeyMetrics({ baseline, markers, decisions, costs, slowestP95 }: {
  baseline: string; markers: Record<string, Marker>; decisions: Decision[]; costs: Record<string, number>; slowestP95: Record<string, number>;
}) {
  const models = Object.keys(markers);
  const col = (get: (m: string) => number | null | undefined) => models.map((m) => get(m) ?? null);
  const rows: Row[] = [
    { label: "Overall pass rate", hint: "Share of cases passed", values: col((m) => markers[m].task_success), fmt: pct(1), best: "high" },
    { kind: "verdict", label: "Verdict vs baseline", hint: "Paired bootstrap, 95% CI", values: [], fmt: String },
    { label: "Regressions", hint: "Cases the baseline passed and the candidate failed", values: col((m) => markers[m].regressions), fmt: String, best: "low" },
    { label: "Consistency", hint: "Same answer across repeats", values: col((m) => markers[m].consistency), fmt: pct(0), best: "high" },
    { label: "Cost per 1,000 tasks", hint: "List price", values: col((m) => markers[m].cost_per_1k_tasks), fmt: usd, best: "low" },
    { label: "Cost of this run", hint: "Actual spend; cached calls are free", values: col((m) => costs[m]), fmt: usd },
    { label: "Median latency (p50)", hint: "Seconds per call, from the run", values: col((m) => markers[m].latency_p50), fmt: secs, best: "low" },
    { label: "Slowest benchmark p95", hint: "Highest p95 across benchmarks, seconds per call", values: col((m) => slowestP95[m]), fmt: secs, best: "low" },
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
                  if (r.kind === "verdict") {
                    const d = decisions.find((x) => x.candidate === m);
                    return <td key={m} className="num">{d ? <><VerdictChip verdict={d.overall_verdict} />{VERDICT_NOTE[d.overall_verdict] && <div className="muted small">{VERDICT_NOTE[d.overall_verdict]}</div>}</> : <span className="muted">Baseline</span>}</td>;
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

/** Highest p95 per model across benchmarks, skipping benchmarks where every call failed. */
export function slowestP95(benchmarks: { summaries: Record<string, { n_calls: number; n_errors: number; latency_p95?: number | null }> }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of benchmarks) {
    for (const [t, s] of Object.entries(b.summaries)) if (s.latency_p95 != null && s.n_calls > s.n_errors) out[t] = Math.max(out[t] ?? 0, s.latency_p95);
  }
  return out;
}
