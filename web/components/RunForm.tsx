"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, postJSON, type Benchmark, type Estimate, type Target } from "@/lib/api";
import { Empty, ErrorState, Loading } from "./States";

type Data = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; targets: Target[]; benches: Benchmark[] };

export default function RunForm({ onStart }: { onStart: (jobId: string) => void }) {
  const [data, setData] = useState<Data>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [targets, setTargets] = useState<string[]>([]);
  const [benches, setBenches] = useState<string[]>([]);
  const [baseline, setBaseline] = useState("");
  const [judge, setJudge] = useState("");
  const [estimate, setEstimate] = useState<Estimate | { error: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([getJSON<Target[]>("/targets"), getJSON<Benchmark[]>("/benchmarks")])
      .then(([t, b]) => live && setData({ status: "ready", targets: t, benches: b }))
      .catch((e: Error) => live && setData({ status: "error", message: `Could not load targets and benchmarks (${e.message}).` }));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setData({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  const base = targets.includes(baseline) ? baseline : targets[0] ?? "";
  const needsJudge = data.status === "ready" && data.benches.some((b) => benches.includes(b.name) && b.needs_judge);
  const body = { targets, benchmarks: benches, baseline: base || undefined, judge: needsJudge && judge ? judge : undefined };
  const ready = targets.length >= 2 && benches.length > 0;
  const key = JSON.stringify(body);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const t = setTimeout(() => {
      postJSON<Estimate>("/runs/estimate", JSON.parse(key))
        .then((e) => live && setEstimate(e))
        .catch((e: Error) => live && setEstimate({ error: e.message }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key, ready]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function run() {
    setStarting(true); setStartError("");
    try { onStart((await postJSON<{ job_id: string }>("/runs", body)).job_id); }
    catch (e) { setStartError((e as Error).message); setStarting(false); }
  }

  if (data.status === "loading") return <Loading label="Loading targets and benchmarks" />;
  if (data.status === "error") return <ErrorState message={data.message} onRetry={retry}>Check that <code>modelcompare serve</code> is running.</ErrorState>;
  if (!data.targets.length) return <Empty title="No targets configured">Copy targets.example.yaml to targets.yaml and add a model.</Empty>;
  if (!data.benches.length) return <Empty title="No benchmarks found">Add a benchmark YAML under benchmarks/custom.</Empty>;

  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <div className="form-cols">
        <fieldset>
          <legend>Models (pick at least two)</legend>
          {data.targets.map((t) => (
            <label key={t.name} className="check">
              <input type="checkbox" checked={targets.includes(t.name)} onChange={() => toggle(targets, setTargets, t.name)} />
              <span>{t.name}</span><span className="muted">{t.model}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Benchmarks</legend>
          <div className="scroll-list">
            {data.benches.map((b) => (
              <label key={b.name} className="check">
                <input type="checkbox" checked={benches.includes(b.name)} onChange={() => toggle(benches, setBenches, b.name)} />
                <span>{b.name}</span><span className="muted">{b.capability} · {b.cases} cases</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="form-row">
        <label>Baseline
          <select value={base} onChange={(e) => setBaseline(e.target.value)} disabled={!targets.length}>
            {!targets.length && <option value="">Pick models first</option>}
            {targets.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {needsJudge && (
          <label>Judge
            <select value={judge} onChange={(e) => setJudge(e.target.value)}>
              <option value="">Choose a judge</option>
              {data.targets.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="muted" aria-live="polite" data-testid="estimate">
        {!ready && "Pick two models and a benchmark to see an estimate."}
        {ready && !estimate && "Estimating…"}
        {ready && estimate && ("error" in estimate ? estimate.error
          : `Estimate: ${estimate.total_calls} calls (${estimate.cached_calls} cached) · about $${estimate.usd.toFixed(3)} · ~${Math.max(1, Math.round(estimate.minutes))} min`)}
      </p>
      {startError && <p role="alert" className="danger">{startError}</p>}
      <div><button type="submit" className="btn" disabled={!ready || starting}>{starting ? "Starting…" : "Run comparison"}</button></div>
    </form>
  );
}
