"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fmtTime, getJSON, pct, postJSON, TERMINAL, usd, type Job } from "@/lib/api";
import { vendorColor } from "@/lib/vendor";
import CaseExplorer from "./CaseExplorer";
import { Chip, ReportTable } from "./ReportTable";
import { Empty, ErrorState, Loading } from "./States";

const POLL_MS = 1000;
const GLYPH = { done: "✓", running: "•", queued: "–", error: "!" };
type Cell = { state: keyof typeof GLYPH; text: string; share: number };

function timeLeft(job: Job) {
  const elapsed = (Date.now() - new Date(/Z|\+/.test(job.started_at) ? job.started_at : `${job.started_at}Z`).getTime()) / 1000;
  if (!job.done_calls || elapsed <= 0) return "—";
  const s = Math.round((elapsed * (job.total_calls - job.done_calls)) / job.done_calls);
  return s < 90 ? `~${Math.max(s, 1)} s` : `~${Math.round(s / 60)} min`;
}
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

  const names = job.benchmarks.length ? job.benchmarks : [...new Set(rows.map((r) => r.benchmark))];
  const per = job.targets.length ? job.total_calls / job.targets.length : 0;
  const spent = job.runs.reduce((n, r) => n + r.cost_usd, 0);
  const cell = (target: string, benchmark: string): Cell => {
    const done = job.runs.find((r) => r.target === target && r.benchmark === benchmark);
    if (done) return done.n_errors ? { state: "error", text: `${done.n_errors} error${done.n_errors === 1 ? "" : "s"}`, share: 1 } : { state: "done", text: pct(done.passed, done.n_results), share: 1 };
    const l = job.live.find((x) => x.target === target && x.benchmark === benchmark);
    return l ? { state: "running", text: `Running ${l.done}/${l.total}`, share: l.total ? l.done / l.total : 0 } : { state: "queued", text: "Queued", share: 0 };
  };
  const percent = job.total_calls ? Math.round((100 * job.done_calls) / job.total_calls) : 0;
  const stat = (label: string, value: ReactNode, big = false) => <div><dt className="small muted">{label}</dt><dd className={big ? "stat-big" : "stat"}>{value}</dd></div>;

  return (
    <>
      <section className="card run-head" aria-labelledby="job-h">
        <div className="between">
          <div>
            <h2 id="job-h">Comparison {job.id} <Chip text={job.status} />{!active && job.status !== "done" && <span className="muted"> (partial results)</span>}</h2>
            <p className="muted small">Started {fmtTime(job.started_at)} · baseline {job.baseline ?? "none"}</p>
          </div>
          {active && <button type="button" className="btn secondary destructive-text" onClick={cancel} disabled={stopping}>{stopping ? "Stopping…" : "Cancel"}</button>}
        </div>
        <dl className="stats">
          {stat("Progress", `${percent}%`, true)}
          {stat("Calls", <>{job.done_calls} <span className="muted">of {job.total_calls}</span></>)}
          {stat("Spent", usd(spent))}
          {stat("Time left", active ? timeLeft(job) : "—")}
        </dl>
        <div className="bar big" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={job.total_calls} aria-valuenow={job.done_calls}>
          <div style={{ width: `${job.total_calls ? (100 * job.done_calls) / job.total_calls : 0}%` }} />
        </div>
        {!active && (
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
      </section>
      {rows.length > 0 && (active || showProgress) && (
        <div className="run-cols">
          <section className="card" aria-labelledby="h-grid">
            <h2 id="h-grid">By benchmark</h2>
            <p className="muted">Pass rate so far. Numbers settle as runs finish.</p>
            <div className="table-wrap" tabIndex={0}>
              <table className="grid">
                <thead><tr><th>Benchmark</th>{job.targets.map((t) => <th key={t}><span className="models-cell"><span className="dot" style={{ background: vendorColor(t) }} />{t}</span></th>)}</tr></thead>
                <tbody>{names.map((b) => (
                  <tr key={b}><th scope="row">{b}</th>{job.targets.map((t) => {
                    const c = cell(t, b);
                    return (
                      <td key={t} data-state={c.state}>
                        <span className="cell"><span className="cell-icon" aria-hidden="true">{GLYPH[c.state]}</span><span>{c.state === "done" && <span className="sr-only">Done </span>}{c.text}</span></span>
                        {c.state === "running" && <div className="bar mini"><div style={{ width: `${100 * c.share}%`, background: vendorColor(t) }} /></div>}
                      </td>
                    );
                  })}</tr>))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card" aria-labelledby="h-models">
            <h2 id="h-models">By model</h2>
            {job.targets.map((t) => {
              const mine = rows.filter((r) => r.target === t);
              const d = mine.reduce((n, r) => n + r.done, 0);
              const e = mine.reduce((n, r) => n + r.errors, 0);
              return (
                <div key={t} className="model-prog">
                  <div className="between"><span className="models-cell"><span className="dot" style={{ background: vendorColor(t) }} />{t}</span><span className="muted num">{d} / {Math.round(per)}</span></div>
                  <div className="bar"><div style={{ width: `${per ? Math.min(100, (100 * d) / per) : 0}%`, background: vendorColor(t) }} /></div>
                  <p className="muted small">Pass rate so far {pct(mine.reduce((n, r) => n + r.passed, 0), d)} · {e} error{e === 1 ? "" : "s"}</p>
                </div>
              );
            })}
          </section>
        </div>
      )}
      {!active && (job.run_ids.length ? <ReportTable jobId={job.id}><CaseExplorer runs={job.runs} /></ReportTable> : <Empty title="No finished runs">This comparison ended ({job.status}) before any run completed.</Empty>)}
    </>
  );
}
