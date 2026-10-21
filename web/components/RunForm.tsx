"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getJSON, postJSON, usd, vendor, type Benchmark, type Catalog, type Estimate, type Target } from "@/lib/api";
import { Empty, ErrorState, Loading } from "./States";

type Data = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; targets: Target[]; benches: Benchmark[]; catalog: Catalog | null };

export default function RunForm({ onStart }: { onStart: (jobId: string) => void }) {
  const [data, setData] = useState<Data>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const params = useSearchParams();
  const fromUrl = params.get("targets");
  const benchesFromUrl = params.get("benchmarks");
  const [targets, setTargets] = useState<string[]>(() => (fromUrl ?? "").split(",").filter(Boolean));
  const [benches, setBenches] = useState<string[]>(() => (benchesFromUrl ?? "").split(",").filter(Boolean));
  const [baseline, setBaseline] = useState("");
  const [judge, setJudge] = useState("");
  const [opts, setOpts] = useState({ repeats: "", concurrency: "8", budget: "", cache: true });
  const [confirmKey, setConfirmKey] = useState("");
  const [estimate, setEstimate] = useState<{ key: string; value: Estimate | { error: string } } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    let live = true;
    // The catalog is only needed to label ids that arrive from the Models page.
    Promise.all([getJSON<Target[]>("/targets/status"), getJSON<Benchmark[]>("/benchmarks"), fromUrl ? getJSON<Catalog>("/models").catch(() => null) : null])
      .then(([t, b, catalog]) => {
        if (!live) return;
        const noKey = new Set(catalog?.providers.filter((p) => p.reason === "no key").map((p) => p.provider));
        const unusable = (n: string) => { const y = t.find((x) => x.name === n); return y ? y.keys_ok === false : noKey.has(n.split("/")[0]); };
        setTargets((cur) => cur.filter((n) => !unusable(n)));
        setBenches((cur) => cur.filter((n) => b.some((x) => x.name === n)));
        setData({ status: "ready", targets: t, benches: b, catalog });
      })
      .catch((e: Error) => live && setData({ status: "error", message: `Could not load targets and benchmarks (${e.message}).` }));
    return () => { live = false; };
  }, [attempt, fromUrl]);
  const retry = useCallback(() => { setData({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  const base = targets.includes(baseline) ? baseline : targets[0] ?? "";
  const needsJudge = data.status === "ready" && data.benches.some((b) => benches.includes(b.name) && b.needs_judge);
  // Judges: real models not under test, from a vendor not being compared when possible.
  const judges = data.status === "ready" ? data.targets.filter((t) => t.kind !== "mock" && t.keys_ok && !targets.includes(t.name)) : [];
  const used = new Set(data.status === "ready" ? targets.map((n) => vendor(data.targets.find((t) => t.name === n)?.model ?? n)) : []);
  const judgeName = judges.some((t) => t.name === judge) ? judge : (judges.find((t) => !used.has(vendor(t.model))) ?? judges[0])?.name ?? "";
  const body = { targets, benchmarks: benches, baseline: base || undefined, judge: needsJudge && judgeName ? judgeName : undefined,
    repeats: opts.repeats === "" ? undefined : Number(opts.repeats), budget_usd: opts.budget === "" ? undefined : Number(opts.budget), concurrency: Number(opts.concurrency) || 8, use_cache: opts.cache };
  const ready = targets.length >= 1 && benches.length > 0 && (!needsJudge || !!judgeName);
  const key = JSON.stringify(body);
  const est = estimate?.key === key && !("error" in estimate.value) ? estimate.value : null;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const t = setTimeout(() => {
      postJSON<Estimate>("/runs/estimate", JSON.parse(key))
        .then((value) => live && setEstimate({ key, value }))
        .catch((e: Error) => live && setEstimate({ key, value: { error: e.message } }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key, ready]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function run() {
    if (!est) return;
    if ((est.usd > 0 || est.unpriced?.length) && confirmKey !== key) return setConfirmKey(key);
    setStarting(true); setStartError("");
    try { onStart((await postJSON<{ job_id: string }>("/runs", body)).job_id); }
    catch (e) { setStartError((e as Error).message); setStarting(false); }
  }

  // Ids picked on the Models page that targets.yaml does not list (catalog models); kept visible even when unchecked.
  const [initial] = useState(targets);
  const extra = data.status === "ready" ? initial.filter((n) => !data.targets.some((t) => t.name === n)) : [];
  const fromNote = (n: string) => {
    if (data.status !== "ready" || !data.catalog) return { text: "catalog", off: false };
    const p = data.catalog.providers.find((x) => x.provider === n.split("/")[0]);
    if (p?.reason === "no key") return { text: `no key (${p.var})`, off: true };
    return !p || (p.key_ok && !p.models.some((m) => m.target === n)) ? { text: "not in catalog", off: false } : { text: "catalog", off: false };
  };
  if (data.status === "loading") return <Loading label="Loading targets and benchmarks" />;
  if (data.status === "error") return <ErrorState message={data.message} onRetry={retry}>Check that <code>modelcompare serve</code> is running.</ErrorState>;
  if (!data.targets.length && !extra.length) return <Empty title="No targets configured">Copy targets.example.yaml to targets.yaml and add a model.</Empty>;
  if (!data.benches.length) return <Empty title="No benchmarks found">Add a benchmark YAML under benchmarks/custom.</Empty>;

  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <div className="form-cols">
        <fieldset>
          <legend>Models (pick one, or two or more to compare)</legend>
          {data.targets.map((t) => (
            <label key={t.name} className="check">
              <input type="checkbox" checked={targets.includes(t.name)} disabled={t.keys_ok === false} onChange={() => toggle(targets, setTargets, t.name)} />
              <span>{t.name}</span><span className="muted">{t.keys_ok === false ? `no key (${t.missing_keys?.[0] ?? "unknown"})` : t.model}</span>
            </label>
          ))}
        </fieldset>
        {extra.length > 0 && (
          <fieldset>
            <legend>From Models</legend>
            {extra.map((name) => (
              <label key={name} className="check">
                <input type="checkbox" checked={targets.includes(name)} disabled={fromNote(name).off} onChange={() => toggle(targets, setTargets, name)} />
                <span>{name}</span><span className="muted">{fromNote(name).text}</span>
              </label>
            ))}
          </fieldset>
        )}
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
            <select value={judgeName} onChange={(e) => setJudge(e.target.value)}>
              {!judges.length && <option value="">No judge available</option>}
              {judges.map((t) => <option key={t.name} value={t.name}>{t.name}{used.has(vendor(t.model)) ? " (same vendor as a model under test)" : ""}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="form-row">
        <label>Repeats<input type="number" min={1} max={10} placeholder="deck default" value={opts.repeats} onChange={(e) => setOpts({ ...opts, repeats: e.target.value })} /></label>
        <label>Parallel calls per model<input type="number" min={1} max={64} value={opts.concurrency} onChange={(e) => setOpts({ ...opts, concurrency: e.target.value })} /></label>
        <label>Budget per run (USD)<input type="number" min={0} step="0.01" placeholder="no cap" value={opts.budget} onChange={(e) => setOpts({ ...opts, budget: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={opts.cache} onChange={(e) => setOpts({ ...opts, cache: e.target.checked })} />Reuse cached answers</label>
      </div>
      <p className="muted" aria-live="polite" data-testid="estimate">
        {!ready && (needsJudge && !judgeName ? "These benchmarks need a judge model that is not under test." : "Pick a model and a benchmark to see an estimate.")}
        {ready && estimate?.key !== key && "Estimating…"}
        {ready && estimate?.key === key && ("error" in estimate.value ? estimate.value.error
          : `Estimate: ${estimate.value.total_calls} calls (${estimate.value.cached_calls} cached) · up to ${usd(estimate.value.usd)} · ~${Math.max(1, Math.round(estimate.value.minutes))} min`)}
        {ready && targets.length < 2 && " · one model gives a scorecard; select two for a verdict"}
      </p>
      {startError && <p role="alert" className="danger">{startError}</p>}
      {confirmKey === key && est ? (
        <div className="confirm" role="group" aria-label="Confirm cost">
          <p>This run makes {est.total_calls - est.cached_calls} calls and may cost up to {usd(est.usd)}.</p>
          {!!est.unpriced?.length && <p className="danger">Heads up: cost unknown for {est.unpriced.join(", ")} — the budget cap can&apos;t be enforced for them.</p>}
          <button type="submit" className="btn" disabled={starting}>{starting ? "Starting…" : "Confirm and run"}</button>
          <button type="button" className="btn secondary" onClick={() => setConfirmKey("")}>Back</button>
        </div>
      ) : <div><button type="submit" className="btn" disabled={!est || starting}>Run comparison</button></div>}
    </form>
  );
}
