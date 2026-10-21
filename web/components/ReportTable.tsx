"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/api";
import { ErrorState, Loading } from "./States";
import CostScatter from "./CostScatter";
import RankedBars from "./RankedBars";
import Regressions from "./Regressions";
import Suggestions from "./Suggestions";
import VerdictMatrix from "./VerdictMatrix";
import type { Decision, Dimension, FlaggedItem, Marker, Suggestion } from "@/lib/report";

const TONES: Record<string, [string, string]> = {
  better: ["Better", "ok"], mixed: ["Mixed", "warn"], worse: ["Worse", "bad"], equivalent: ["Equivalent", "info"], inconclusive: ["Inconclusive", "muted"],
  insufficient_data: ["Not enough data", "muted"], incomplete: ["Incomplete", "warn"],
  done: ["done", "ok"], failed: ["failed", "bad"], interrupted: ["interrupted", "bad"], cancelled: ["cancelled", "warn"],
  running: ["running", "info"], queued: ["queued", "muted"], budget_exceeded: ["budget exceeded", "warn"],
};

/** A status or verdict chip; a value we do not know renders as a muted chip showing the raw text. */
export function Chip({ text }: { text: string }) {
  const known = TONES[text];
  return known ? <span className={`chip ${known[1]}`} data-verdict={text}>{known[0]}</span> : <span className="chip muted" data-verdict={text}>{text}</span>;
}

type Summary = { mean_score: number; pass_rate: number; n_errors: number; n_calls: number };
type Comparison = { candidate: string; verdict: string; delta: number; ci: [number, number]; n: number };
type Bench = { name: string; dimension: string; summaries: Record<string, Summary>; comparisons: Comparison[]; saturated: boolean; saturation_message: string | null };
type Report = {
  baseline: string; warnings: string[]; benchmarks: Bench[];
  errors: Record<string, Record<string, { reasons: { reason: string; count: number }[] }>>;
  headline: { candidate: string; baseline: string; overall: string }[];
  dimensions: Record<string, Dimension>;
  summary?: { decisions: Decision[]; markers: Record<string, Marker> };
  suggestions?: Suggestion[];
  flagged?: Record<string, { items: FlaggedItem[] }>;
};
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; report: Report };

const pts = (v: number) => `${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}`;
export function ReportTable({ jobId, children }: { jobId: string; children?: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    getJSON<Report>(`/jobs/${jobId}/report`)
      .then((report) => live && setState({ status: "ready", report }))
      .catch((e: Error) => live && setState({ status: "error", message: `Could not load the report (${e.message}).` }));
    return () => { live = false; };
  }, [jobId, attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  if (state.status === "loading") return <Loading label="Loading report" />;
  if (state.status === "error") return <><ErrorState message={state.message} onRetry={retry} />{children}</>;
  const { report: r } = state;
  const vendors = Object.fromEntries(Object.values(r.dimensions).flatMap((d) => Object.entries(d.targets).map(([t, v]) => [t, v.vendor])));
  return (
    <>
      <section className="card" aria-labelledby="report-h">
        <div className="between">
          <h2 id="report-h">Report · baseline {r.baseline}</h2>
          <span className="links"><a href={`/api/jobs/${jobId}/report.html`} target="_blank" rel="noopener">Open report</a><a href={`/api/jobs/${jobId}/report`} target="_blank" rel="noopener">JSON</a></span>
        </div>
        {r.headline.length === 0 && <p className="muted">One model gives a scorecard; add a second for a verdict.</p>}
        {r.warnings.length > 0 && <ul className="warnings">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </section>
      {r.suggestions && <Suggestions items={r.suggestions} />}
      {r.summary && <VerdictMatrix baseline={r.baseline} decisions={r.summary.decisions} />}
      <RankedBars dimensions={r.dimensions} baseline={r.baseline} />
      {r.summary && <CostScatter markers={r.summary.markers} vendors={vendors} />}
      {r.flagged && <Regressions flagged={r.flagged} baseline={r.baseline} />}
      <details className="details">
        <summary>Details</summary>
        <div className="details-body">
      {r.headline.length > 0 && (
        <section className="card" aria-labelledby="plain-h">
          <h2 id="plain-h">In plain words</h2>
          {r.headline.map((h) => <p key={h.candidate}>{h.candidate} vs {h.baseline}: <Chip text={h.overall} /></p>)}
          {r.summary?.decisions.map((d) => <p key={d.candidate} className="muted">{d.line}</p>)}
        </section>
      )}
      {r.benchmarks.map((b) => (
        <section key={b.name} className="card" aria-labelledby={`bench-${b.name}`}>
          <h2 id={`bench-${b.name}`}>{b.name} <span className="muted">{b.dimension}</span></h2>
          {b.saturated && <p className="note">{b.saturation_message}</p>}
          <div className="table-wrap" tabIndex={0}><table>
            <thead><tr><th>Model</th><th className="num">Score</th><th className="num">Pass rate</th><th className="num">Errors</th><th>Verdict</th><th className="num">Change vs baseline (pts)</th></tr></thead>
            <tbody>{Object.entries(b.summaries).map(([t, s]) => {
              const c = b.comparisons.find((x) => x.candidate === t);
              const reasons = r.errors[t]?.[b.name]?.reasons ?? [];
              return (
                <tr key={t}>
                  <td>{t}{t === r.baseline && <span className="muted"> (baseline)</span>}</td>
                  <td className="num">{(100 * s.mean_score).toFixed(0)}%</td>
                  <td className="num">{(100 * s.pass_rate).toFixed(0)}%</td>
                  <td className="num">{s.n_errors}/{s.n_calls}{reasons.map((e) => <div key={e.reason} className="muted">{e.reason} ×{e.count}</div>)}</td>
                  <td>{c ? <Chip text={c.verdict} /> : <span className="muted">—</span>}</td>
                  <td className="num">{c ? <>{pts(c.delta)} <span className="muted">({pts(c.ci[0])} to {pts(c.ci[1])}, n={c.n})</span></> : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      ))}
        </div>
      </details>
      {children}
    </>
  );
}
