"use client";

import { useEffect, useState } from "react";
import { getJSON, pct, type JobRun } from "@/lib/api";
import { Chip } from "./ReportTable";
import { ErrorState, Loading } from "./States";

type CaseResult = {
  case_id: string; repeat: number; passed: boolean; score: number; error: string | null; text: string; cached: boolean; latency_s: number;
  tool_calls: unknown[]; scores: { type: string; score: number; reason?: string }[];
};
type Detail = { run: { target_name: string; benchmark_name: string; benchmark_version: string }; results: CaseResult[] };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: Detail };

function RunDetail({ id }: { id: number }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    getJSON<Detail>(`/runs/${id}`)
      .then((detail) => live && setState({ status: "ready", detail }))
      .catch((e: Error) => live && setState({ status: "error", message: `Could not load this run (${e.message}).` }));
    return () => { live = false; };
  }, [id, attempt]);
  if (state.status === "loading") return <Loading label="Loading cases" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }} />;
  const { run, results } = state.detail;
  return (
    <div className="table-wrap" tabIndex={0} aria-label={`Cases for ${run.target_name} on ${run.benchmark_name}`}><table>
      <thead><tr><th>Case</th><th>Result</th><th>Output</th><th>Why</th><th className="num">Time</th></tr></thead>
      <tbody>{results.map((r) => (
        <tr key={`${r.case_id}-${r.repeat}`}>
          <td>{r.case_id}{r.repeat > 0 && <div className="muted">repeat {r.repeat + 1}</div>}</td>
          <td><span className={`chip ${r.passed ? "ok" : "bad"}`}>{r.passed ? "pass" : "fail"}</span><div className="muted">score {r.score.toFixed(2)}</div></td>
          <td>{r.error && <div className="danger">{r.error}</div>}{r.text && <pre>{r.text}</pre>}{r.tool_calls.length > 0 && <pre>{JSON.stringify(r.tool_calls, null, 2)}</pre>}</td>
          <td>{r.scores.map((s) => <div key={s.type}><b>{s.type}</b> {s.score.toFixed(2)}{s.reason && ` — ${s.reason}`}</div>)}</td>
          <td className="num">{r.cached ? "cached" : `${r.latency_s.toFixed(1)}s`}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

/** Every run in a job; opening one shows each case's output, score and the reason. */
export default function CaseExplorer({ runs }: { runs: JobRun[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="card" aria-labelledby="cases-h">
      <h2 id="cases-h">Case explorer</h2>
      <p className="muted">Every run in this comparison. Open one to see each task: the model&apos;s output, its score and why.</p>
      <div className="table-wrap" tabIndex={0}><table>
        <thead><tr><th>Model</th><th>Benchmark</th><th className="num">Passed</th><th className="num">Errors</th><th className="num">Cost</th><th>Status</th><th><span className="sr-only">Cases</span></th></tr></thead>
        <tbody>{runs.map((r) => (
          <tr key={r.run_id}>
            <td>{r.target}</td><td>{r.benchmark}</td><td className="num">{r.passed}/{r.n_results} <span className="muted">{pct(r.passed, r.n_results)}</span></td>
            <td className="num">{r.n_errors}</td><td className="num">${r.cost_usd.toFixed(3)}</td><td><Chip text={r.status} /></td>
            <td><button type="button" className="link-btn" aria-expanded={open === r.run_id} onClick={() => setOpen(open === r.run_id ? null : r.run_id)}>{open === r.run_id ? "Hide cases" : "View cases"}</button></td>
          </tr>))}</tbody>
      </table></div>
      {open !== null && <RunDetail key={open} id={open} />}
    </section>
  );
}
