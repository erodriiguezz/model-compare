"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, getJSON, type Job, type RunRow } from "@/lib/api";
import JobView from "./JobView";
import SectionTabs from "./SectionTabs";
import { Chip } from "./ReportTable";
import { Empty, ErrorState, Loading } from "./States";

const LIMIT = 25;
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; jobs: Job[]; runs: RunRow[] };

function Past() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState({ jobs: LIMIT, runs: LIMIT });
  useEffect(() => {
    let live = true;
    Promise.all([getJSON<Job[]>("/jobs"), getJSON<RunRow[]>("/runs")])
      .then(([jobs, runs]) => live && setState({ status: "ready", jobs, runs }))
      .catch((e: Error) => live && setState({ status: "error", message: e.message }));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  if (state.status === "loading") return <Loading label="Loading history" />;
  if (state.status === "error") return <ErrorState message={`Could not load history (${state.message}).`} onRetry={retry} />;
  const { jobs, runs } = state;
  if (!jobs.length && !runs.length) return <Empty title="No runs yet"><Link href="/compare/" prefetch={false}>Start your first comparison</Link></Empty>;
  return (
    <>
      <section className="card" aria-labelledby="jobs-h">
        <h2 id="jobs-h">Comparisons</h2>
        <div className="table-wrap" tabIndex={0}><table>
          <thead><tr><th>Started</th><th>Models</th><th className="hide-sm">Baseline</th><th className="num hide-sm">Calls</th><th className="hide-sm">Status</th></tr></thead>
          <tbody>{jobs.slice(0, limit.jobs).map((j) => (
            <tr key={j.id}>
              <td className="nowrap"><Link href={`/history/?job=${j.id}`} prefetch={false}>{fmtTime(j.started_at)}</Link><div className="show-sm"><Chip text={j.status} /></div></td>
              <td>{j.targets.map((t, i) => <span key={t}>{i > 0 && ", "}<span className="nowrap">{t}</span></span>)}</td>
              <td className="hide-sm">{j.baseline}</td>
              <td className="num hide-sm">{j.done_calls}/{j.total_calls}</td><td className="hide-sm"><Chip text={j.status} /></td>
            </tr>))}</tbody>
        </table></div>
        <More shown={limit.jobs} total={jobs.length} onAll={() => setLimit((l) => ({ ...l, jobs: Infinity }))} />
      </section>
      {jobs.some((j) => j.status === "interrupted") && (
        <p className="muted">Interrupted comparisons (the server restarted mid-run) still open with whatever finished. Run them again to complete them; cached answers are free.</p>
      )}
      <section className="card" aria-labelledby="runs-h">
        <h2 id="runs-h">Runs</h2>
        <div className="table-wrap" tabIndex={0}><table>
          <thead><tr><th>Model</th><th>Benchmark</th><th className="hide-sm">Status</th><th className="num hide-sm">Passed</th><th className="num hide-sm">Errors</th><th className="num hide-sm">Cost</th></tr></thead>
          <tbody>{runs.slice(0, limit.runs).map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{r.target_name}<div className="show-sm"><Chip text={r.status} /></div></td><td className="nowrap">{r.benchmark_name}</td><td className="hide-sm"><Chip text={r.status} /></td>
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
      <h1>History</h1>
      <p className="muted lede">Past comparisons and the runs behind them.</p>
      <SectionTabs active="/history/" />
      {job ? <JobView key={job} id={job} /> : <Past />}
    </main>
  );
}
