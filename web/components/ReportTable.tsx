"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getJSON } from "@/lib/api";
import { ErrorState, Loading } from "./States";
import DecisionPanel from "./DecisionPanel";
import KeyMetrics, { slowestP95 } from "./KeyMetrics";
import QualityScatter from "./QualityScatter";
import SectionTabs from "./SectionTabs";
import BarList from "./ui/BarList";
import CapabilityGrid from "./CapabilityGrid";
import CostSpeed from "./CostSpeed";
import Evidence from "./Evidence";
import Regressions from "./Regressions";
import { vendorColor } from "@/lib/vendor";
import type { Bench, Decision, Dimension, FlaggedItem, Marker, Profile, Suggestion } from "@/lib/report";

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

type Report = {
  baseline: string; warnings: string[]; benchmarks: Bench[];
  errors: Record<string, Record<string, { reasons: { reason: string; count: number }[] }>>;
  dimensions: Record<string, Dimension>;
  summary?: { decisions: Decision[]; markers: Record<string, Marker> };
  suggestions?: Suggestion[];
  flagged?: Record<string, { items: FlaggedItem[] }>;
  profiles?: Profile[];
  total_cost_usd?: Record<string, number>;
};
const TABS = [["decision", "Decision"], ["overview", "Key metrics"], ["quality", "Quality"], ["capabilities", "Capabilities"], ["cost", "Cost"], ["speed", "Speed"], ["regressions", "Regressions"], ["evidence", "Evidence"]]
  .map(([id, label]) => ({ href: `#${id}`, label }));
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; report: Report };

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
  const candidates = r.summary ? Object.keys(r.summary.markers).filter((t) => t !== r.baseline) : Object.keys(r.flagged ?? {});
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
      <CapabilityGrid dimensions={r.dimensions} baseline={r.baseline} decisions={r.summary?.decisions ?? []} />
      {r.summary && <CostSpeed markers={r.summary.markers} costs={r.total_cost_usd ?? {}} slowestP95={slowestP95(r.benchmarks)} vendors={vendors} />}
      {r.flagged && candidates.length > 0 && <Regressions flagged={r.flagged} baseline={r.baseline} candidates={candidates} />}
      <Evidence benchmarks={r.benchmarks} baseline={r.baseline} errors={r.errors} />
      {children}
    </>
  );
}
