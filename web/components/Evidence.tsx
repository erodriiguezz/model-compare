import type { Bench } from "@/lib/report";
import VerdictChip from "./ui/VerdictChip";

const pts = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}`);
const p = (v: number | null) => (v == null ? "—" : v < 0.001 ? "<0.001" : v.toFixed(3));

/** Per-benchmark paired statistics for engineers, one row per model: baseline-relative change, interval, tests and verdict. */
export default function Evidence({ benchmarks, baseline, errors }: { benchmarks: Bench[]; baseline: string; errors: Record<string, Record<string, { reasons: { reason: string; count: number }[] }>> }) {
  return (
    <section id="evidence" className="report-section" aria-labelledby="evidence-h">
      <div>
        <h2 id="evidence-h" className="sec">Evidence</h2>
        <p className="muted">Per-benchmark paired statistics for engineers. Runs whose benchmark fingerprint differs are never compared.</p>
      </div>
      <div className="card table-card"><div className="table-wrap" tabIndex={0}>
        <table className="metrics">
          <thead><tr><th scope="col">Model</th><th scope="col" className="num">Pass rate</th><th scope="col" className="num">n</th><th scope="col" className="num">Score change (pts)</th><th scope="col" className="num">95% CI (pts)</th>
            <th scope="col" className="num">p</th><th scope="col" className="num">McNemar p</th><th scope="col" className="num">W/T/L</th><th scope="col">Verdict</th></tr></thead>
          {benchmarks.map((b) => (
            <tbody key={b.name} aria-labelledby={`bench-${b.name}`}>
              <tr className="group"><th scope="rowgroup" colSpan={9} id={`bench-${b.name}`}>{b.name} <span className="muted">{b.dimension}</span> <span className="mono small muted">{b.fingerprint}</span>{b.saturated && <div className="note">{b.saturation_message}</div>}</th></tr>
              {Object.entries(b.summaries).map(([t, s]) => {
                const c = b.comparisons.find((x) => x.candidate === t);
                const allErrored = s.n_calls > 0 && s.n_errors === s.n_calls;
                const reasons = errors[t]?.[b.name]?.reasons ?? [];
                return (
                  <tr key={t}>
                    <th scope="row">{t}{t === baseline && <span className="muted"> (baseline)</span>}{reasons.map((e) => <div key={e.reason} className="muted small">{e.reason} ×{e.count}</div>)}</th>
                    <td className="num">{allErrored ? "—" : `${(100 * s.pass_rate).toFixed(0)}%`}<div className="muted small">{s.n_errors}/{s.n_calls} errors</div></td>
                    {c && c.delta != null ? <>
                      <td className="num">{c.n}</td><td className="num">{pts(c.delta)}</td><td className="num">{pts(c.ci[0])} to {pts(c.ci[1])}</td>
                      <td className="num">{p(c.p_value)}</td><td className="num">{p(c.mcnemar_p)}</td><td className="num">{c.wins}/{c.ties}/{c.losses}</td>
                    </> : <td colSpan={6} className="muted">{c ? "No paired cases — every call errored" : "—"}</td>}
                    <td>{c ? <VerdictChip verdict={c.verdict} /> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div></div>
      <p className="muted small">Method: bootstrap CI on per-case score deltas plus McNemar on pass/fail. Better means the CI is above 0, worse means below 0. Fewer than 10 shared cases gives no verdict.</p>
    </section>
  );
}
