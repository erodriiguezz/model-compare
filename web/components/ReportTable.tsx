"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/api";
import { ErrorState, Loading } from "./States";
import DecisionPanel from "./DecisionPanel";
import KeyMetrics, { slowestP95 } from "./KeyMetrics";
import QualityScatter from "./QualityScatter";
import SectionTabs from "./SectionTabs";
import BarList from "./ui/BarList";
import RankedBars from "./RankedBars";
import Regressions from "./Regressions";
import VerdictMatrix from "./VerdictMatrix";
import { vendorColor } from "@/lib/vendor";
import type { Decision, Dimension, FlaggedItem, Marker, Profile, Suggestion } from "@/lib/report";

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

type Summary = { mean_score: number; pass_rate: number; n_errors: number; n_calls: number; latency_p50?: number | null; latency_p95?: number | null };
type Comparison = { candidate: string; verdict: string; delta: number | null; ci: [number | null, number | null]; n: number };
type Bench = { name: string; dimension: string; summaries: Record<string, Summary>; comparisons: Comparison[]; saturated: boolean; saturation_message: string | null };
type Report = {
  baseline: string; warnings: string[]; benchmarks: Bench[];
  errors: Record<string, Record<string, { reasons: { reason: string; count: number }[] }>>;
  headline: { candidate: string; baseline: string; overall: string }[];
  dimensions: Record<string, Dimension>;
  summary?: { decisions: Decision[]; markers: Record<string, Marker> };
  suggestions?: Suggestion[];
  flagged?: Record<string, { items: FlaggedItem[] }>;
  profiles?: Profile[];
  total_cost_usd?: Record<string, number>;
};
const TABS = [{ href: "#decision", label: "Decision" }, { href: "#overview", label: "Key metrics" }, { href: "#quality", label: "Quality" }];
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; report: Report };

const pts = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}`);
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
      <DecisionPanel jobId={jobId} baseline={r.baseline} decisions={r.summary?.decisions ?? []} suggestions={r.suggestions ?? []} profiles={r.profiles ?? []} warnings={r.warnings} markers={r.summary?.markers ?? {}} />
      {r.summary && (
        <>
          <div className="report-tabs"><SectionTabs active="" tabs={TABS} label="Report sections" crumb="" /></div>
          <KeyMetrics baseline={r.baseline} markers={r.summary.markers} decisions={r.summary.decisions} costs={r.total_cost_usd ?? {}} slowestP95={slowestP95(r.benchmarks)}
            />
          <section id="quality" className="report-section" aria-labelledby="quality-h">
            <h2 id="quality-h" className="sec">Quality</h2>
            <div className="split">
              <QualityScatter markers={r.summary.markers} vendors={vendors} />
              <section className="card" aria-labelledby="passrate-h">
                <h3 id="passrate-h">Overall pass rate <span className="muted small">Higher is better</span></h3>
                <p className="muted small">Share of every case each model ran that it passed.</p>
                <BarList label="Overall pass rate" sorted items={Object.entries(r.summary.markers).flatMap(([t, m]) => (m.task_success == null ? [] : [{
                  label: m.incomplete ? `${t} (incomplete)` : t, value: m.task_success, display: `${(100 * m.task_success).toFixed(1)}%`, color: vendorColor(t) }]))} />
              </section>
            </div>
          </section>
        </>
      )}
      {r.summary && <VerdictMatrix baseline={r.baseline} decisions={r.summary.decisions} />}
      <RankedBars dimensions={r.dimensions} baseline={r.baseline} />
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
              const allErrored = s.n_calls > 0 && s.n_errors === s.n_calls;
              const reasons = r.errors[t]?.[b.name]?.reasons ?? [];
              return (
                <tr key={t}>
                  <td>{t}{t === r.baseline && <span className="muted"> (baseline)</span>}</td>
                  <td className="num">{allErrored ? "—" : `${(100 * s.mean_score).toFixed(0)}%`}</td>
                  <td className="num">{allErrored ? "—" : `${(100 * s.pass_rate).toFixed(0)}%`}</td>
                  <td className="num">{s.n_errors}/{s.n_calls}{reasons.map((e) => <div key={e.reason} className="muted">{e.reason} ×{e.count}</div>)}</td>
                  <td>{c ? <Chip text={c.verdict} /> : <span className="muted">—</span>}</td>
                  <td className="num">{!c ? "—" : c.delta == null ? <span className="muted">No paired cases — every call errored</span> : <>{pts(c.delta)} <span className="muted">({pts(c.ci[0])} to {pts(c.ci[1])}, n={c.n})</span></>}</td>
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
