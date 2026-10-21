"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtTime, getJSON, usd, type Job, type RunRow } from "@/lib/api";
import { vendorColor } from "@/lib/vendor";
import JobView from "./JobView";
import SectionTabs from "./SectionTabs";
import { Empty, ErrorState, Loading } from "./States";
import VerdictChip, { statusInfo } from "./ui/VerdictChip";

const LIMIT = 25;
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; jobs: Job[]; runs: RunRow[] };

const FILTERS = [{ id: "all", label: "All" }, { id: "done", label: "Complete" }, { id: "partial", label: "Partial or failed" }] as const;
type Filter = (typeof FILTERS)[number]["id"];

/** What a comparison produced, from its status alone (the list has no report). */
const OUTCOME: Record<string, { label: string; tone: "better" | "worse" | "neutral" | "warning" }> = {
  done: { label: "Report ready", tone: "neutral" },
  interrupted: { label: "Partial report", tone: "warning" },
  cancelled: { label: "Partial report", tone: "warning" },
  failed: { label: "No report", tone: "worse" },
};
const outcome = (status: string) => OUTCOME[status] ?? { label: "In progress", tone: "neutral" as const };
const spend = (j: Job) => j.runs.reduce((sum, r) => sum + r.cost_usd, 0);

function Past() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState({ jobs: LIMIT, runs: LIMIT });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([getJSON<Job[]>("/jobs"), getJSON<RunRow[]>("/runs")])
      .then(([jobs, runs]) => live && setState({ status: "ready", jobs, runs }))
      .catch((e: Error) => live && setState({ status: "error", message: e.message }));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  const jobs = useMemo(() => {
    if (state.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    return state.jobs.filter((j) =>
      (filter === "all" || (filter === "done") === (j.status === "done")) &&
      (!q || [...j.targets, ...j.benchmarks].some((x) => x.toLowerCase().includes(q))));
  }, [state, filter, query]);

  if (state.status === "loading") return <Loading label="Loading history" />;
  if (state.status === "error") return <ErrorState message={`Could not load history (${state.message}).`} onRetry={retry} />;
  const { runs } = state;
  if (!state.jobs.length && !runs.length) {
    return <Empty title="No comparisons yet" action={<Link href="/compare/" className="btn" prefetch={false}>Start a comparison</Link>}>Your first comparison shows up here, with its status and what it cost.</Empty>;
  }
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search comparisons</span>
          <input type="search" placeholder="Search by model or benchmark" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {FILTERS.map((f) => <button key={f.id} type="button" className="pill" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <section className="card table-card" aria-labelledby="jobs-h">
        <h2 id="jobs-h" className="sr-only">Comparisons</h2>
        {jobs.length === 0 ? <p className="muted state">No comparisons match.</p> : (
          <div className="table-wrap" tabIndex={0}><table className="list">
            <thead><tr><th>When</th><th>Models (baseline first)</th><th className="hide-sm">Tested</th><th>Outcome</th><th className="num hide-sm">Spend</th><th className="hide-sm">Status</th></tr></thead>
            <tbody>{jobs.slice(0, limit.jobs).map((j) => {
              const o = outcome(j.status), st = statusInfo(j.status);
              return (
                <tr key={j.id}>
                  <td className="nowrap"><Link className="row-link" href={`/compare/?job=${j.id}`} prefetch={false}>{fmtTime(j.started_at)}</Link></td>
                  <td><div className="models-cell">{j.targets.map((t) => <span key={t}><span className="dot" style={{ background: vendorColor(t) }} />{t}</span>)}</div></td>
                  <td className="hide-sm">{j.benchmarks.length} {j.benchmarks.length === 1 ? "benchmark" : "benchmarks"}</td>
                  <td><VerdictChip tone={o.tone}>{o.label}</VerdictChip><div className="cell-note">{j.error ?? (j.baseline ? `Baseline ${j.baseline}` : "")}</div></td>
                  <td className="num hide-sm">{usd(spend(j))}</td>
                  <td className="hide-sm"><span className={`status status-${st.tone}`}>{st.label}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <More shown={limit.jobs} total={jobs.length} onAll={() => setLimit((l) => ({ ...l, jobs: Infinity }))} />
      </section>
      {state.jobs.some((j) => j.status === "interrupted") && (
        <p className="muted">Interrupted comparisons (the server restarted mid-run) still open with whatever finished. Run them again to complete them; cached answers are free.</p>
      )}
      <section className="card" aria-labelledby="runs-h">
        <h2 id="runs-h">Runs</h2>
        <div className="table-wrap" tabIndex={0}><table>
          <thead><tr><th>Model</th><th>Benchmark</th><th className="hide-sm">Status</th><th className="num hide-sm">Passed</th><th className="num hide-sm">Errors</th><th className="num hide-sm">Cost</th></tr></thead>
          <tbody>{runs.slice(0, limit.runs).map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{r.target_name}<div className="show-sm"><VerdictChip status={r.status} /></div></td><td className="nowrap">{r.benchmark_name}</td><td className="hide-sm"><VerdictChip status={r.status} /></td>
              <td className="num nowrap hide-sm">{r.passed}/{r.n_results}</td>
              <td className="num hide-sm">{r.n_errors}</td><td className="num hide-sm">${r.cost_usd.toFixed(3)}</td>
            </tr>))}</tbody>
        </table></div>
        <More shown={limit.runs} total={runs.length} onAll={() => setLimit((l) => ({ ...l, runs: Infinity }))} />
      </section>
    </>
  );
}

function More({ shown, total, onAll }: { shown: number; total: number; onAll: () => void }) {
  if (total <= shown) return null;
  return <p className="muted">Showing the latest {shown} of {total}. <button type="button" className="link-btn" onClick={onAll}>Show all</button></p>;
}

/** /history/ lists past jobs and runs; /history/?job=<id> opens one job's report. */
export default function HistoryView() {
  const job = useSearchParams().get("job");
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Past comparisons</h1>
          <p className="muted lede">Every report stays here. Re-opening one costs nothing.</p>
        </div>
        <Link href="/compare/" className="btn" prefetch={false}>New comparison</Link>
      </div>
      <SectionTabs active="/history/" />
      {job ? <JobView key={job} id={job} /> : <Past />}
    </main>
  );
}
