"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, pct, postJSON, TERMINAL, type Job } from "@/lib/api";
import CaseExplorer from "./CaseExplorer";
import { Chip, ReportTable } from "./ReportTable";
import { Empty, ErrorState, Loading } from "./States";

const POLL_MS = 1000;
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; job: Job; retrying?: boolean };

/** Polls a job until it ends, then shows its report. */
export default function JobView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let fails = 0;
    let loaded = false;
    const tick = () => getJSON<Job>(`/jobs/${id}`)
      .then((job) => {
        if (!live) return;
        fails = 0; loaded = true;
        setState({ status: "ready", job });
        if (!TERMINAL.includes(job.status)) timer = setTimeout(tick, POLL_MS);
      })
      .catch((e: Error) => {
        if (!live) return;
        if (!loaded) return setState({ status: "error", message: `Could not load this comparison (${e.message}).` });
        setState((s) => (s.status === "ready" ? { ...s, retrying: true } : s));
        timer = setTimeout(tick, Math.min(POLL_MS * 2 ** ++fails, 15_000));
      });
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, [id, attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  async function cancel() {
    setStopping(true); setCancelError("");
    try { await postJSON(`/jobs/${id}/cancel`); }
    catch (e) {
      setStopping(false);
      if ((e as { status?: number }).status === 409) setAttempt((n) => n + 1); // it ended meanwhile: refresh now
      else setCancelError((e as Error).message);
    }
  }

  if (state.status === "loading") return <Loading label="Loading job" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={retry} />;
  const { job } = state;
  const active = !TERMINAL.includes(job.status);
  const rows = [
    ...job.runs.map((r) => ({ key: `${r.target}/${r.benchmark}`, target: r.target, benchmark: r.benchmark, done: r.n_results, total: r.n_results, passed: r.passed, errors: r.n_errors })),
    ...job.live.filter((l) => !job.runs.some((r) => r.target === l.target && r.benchmark === l.benchmark)).map((l) => ({ key: `${l.target}/${l.benchmark}`, ...l })),
  ];
  const done = rows.reduce((n, r) => n + r.done, 0);
  const errs = rows.reduce((n, r) => n + r.errors, 0);
  const dims = new Set(job.runs.map((r) => r.dimension));
  const capabilities = dims.has(undefined) ? job.benchmarks.length : dims.size;
  const firstError = job.runs.find((r) => r.first_error)?.first_error;

  return (
    <>
      <section className="card" aria-labelledby="job-h">
        <div className="between">
          <h2 id="job-h">Comparison {job.id} <Chip text={job.status} />{!active && job.status !== "done" && <span className="muted"> (partial results)</span>}</h2>
          {active && <button type="button" className="btn secondary" onClick={cancel} disabled={stopping}>{stopping ? "Stopping…" : "Cancel"}</button>}
        </div>
        <div className="bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={job.total_calls} aria-valuenow={job.done_calls}>
          <div style={{ width: `${job.total_calls ? (100 * job.done_calls) / job.total_calls : 0}%` }} />
        </div>
        {active
          ? <p className="muted">{job.done_calls}/{job.total_calls} calls · {job.targets.join(", ")}</p>
          : (
            <p className="muted" data-job-summary>
              {job.status} · {job.done_calls}/{job.total_calls} calls · {job.targets.length} model{job.targets.length === 1 ? "" : "s"} · {capabilities} capabilit{capabilities === 1 ? "y" : "ies"}{" "}
              <button type="button" className="link-btn" aria-expanded={showProgress} onClick={() => setShowProgress((v) => !v)}>{showProgress ? "Hide progress" : "Show progress"}</button>
            </p>
          )}
        {state.retrying && <p className="muted" role="status">Reconnecting…</p>}
        {job.error && <p role="alert" className="danger">{job.error}</p>}
        {cancelError && <p role="alert" className="danger">{cancelError}</p>}
        {done >= 30 && errs / done > 0.2 && (
          <p className="danger">{pct(errs, done)} of calls are failing, so scores will be meaningless.{firstError && <> First error: <code>{firstError.slice(0, 200)}</code></>} Consider stopping.</p>
        )}
        {rows.length > 0 && (active || showProgress) && (
          <div className="table-wrap" tabIndex={0}><table>
            <thead><tr><th>Model</th><th>Benchmark</th><th className="num">Progress</th><th className="num">Passed</th><th className="num">Errors</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key}><td>{r.target}</td><td>{r.benchmark}</td><td className="num">{r.done}/{r.total}</td>
                <td className="num">{r.passed}/{r.done}</td><td className="num">{r.errors}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
      {!active && (job.run_ids.length ? <ReportTable jobId={job.id}><CaseExplorer runs={job.runs} /></ReportTable> : <Empty title="No finished runs">This comparison ended ({job.status}) before any run completed.</Empty>)}
    </>
  );
}
