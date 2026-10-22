"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getJSON, pct, postJSON, usd, vendor, type Benchmark, type Catalog, type Estimate, type Target } from "@/lib/api";
import { vendorColor } from "@/lib/vendor";
import { ModelCard } from "./ModelPicker";
import { Empty, ErrorState, Loading } from "./States";

type Judge = { name: string; group: string; vendor: string };
const NAMES: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", togetherai: "Together AI", groq: "Groq", openrouter: "OpenRouter" };
const LITELLM_PREFIX: Record<string, string> = { togetherai: "together_ai" }; // same mapping as the backend's keys.LITELLM_PREFIX
type JudgeCatalog = { status: "loading" } | { status: "error" } | { status: "ready"; catalog: Catalog };

type Profiles = Record<string, { weights: Record<string, number> }>;
type Data = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; targets: Target[]; benches: Benchmark[]; catalog: Catalog | null; profiles: Profiles };
const title = (id: string) => { const t = id.replace(/_/g, " "); return t[0].toUpperCase() + t.slice(1); };

export default function RunForm({ onStart }: { onStart: (jobId: string) => void }) {
  const [data, setData] = useState<Data>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const params = useSearchParams();
  const fromUrl = params.get("targets");
  const benchesFromUrl = params.getAll("benchmarks"); // one param per name: names may contain commas
  const [targets, setTargets] = useState<string[]>(() => (fromUrl ?? "").split(",").filter(Boolean));
  const [benches, setBenches] = useState<string[]>(benchesFromUrl);
  const [baseline, setBaseline] = useState("");
  const [judge, setJudge] = useState("");
  const [opts, setOpts] = useState({ repeats: "", concurrency: "8", budget: "", cache: true });
  const [confirmKey, setConfirmKey] = useState("");
  const [estimate, setEstimate] = useState<{ key: string; value: Estimate | { error: string } } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [judgeCatalog, setJudgeCatalog] = useState<JudgeCatalog>({ status: "loading" });

  useEffect(() => {
    let live = true;
    // One catalog fetch serves both the ids that arrive from the Models page and the judge options.
    const catalogP = getJSON<Catalog>("/models").catch(() => null);
    void catalogP.then((c) => live && setJudgeCatalog(c ? { status: "ready", catalog: c } : { status: "error" }));
    Promise.all([getJSON<Target[]>("/targets/status"), getJSON<Benchmark[]>("/benchmarks"), fromUrl ? catalogP : null, getJSON<Profiles>("/profiles").catch(() => ({}) as Profiles)])
      .then(([t, b, catalog, profiles]) => {
        if (!live) return;
        const noKey = new Set(catalog?.providers.filter((p) => p.reason === "no key").map((p) => p.provider));
        const unusable = (n: string) => { const y = t.find((x) => x.name === n); return y ? y.keys_ok === false : noKey.has(n.split("/")[0]); };
        setTargets((cur) => cur.filter((n) => !unusable(n)));
        const known = new Set(b.map((x) => x.name));
        setBenches((cur) => cur.flatMap((v) => (known.has(v) ? [v] : v.split(","))).filter((n) => known.has(n))); // an old "a,b" link still works
        setData({ status: "ready", targets: t, benches: b, catalog, profiles });
      })
      .catch((e: Error) => live && setData({ status: "error", message: `Could not load targets and benchmarks (${e.message}).` }));
    return () => { live = false; };
  }, [attempt, fromUrl]);
  const retry = useCallback(() => { setData({ status: "loading" }); setJudgeCatalog({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  const base = targets.includes(baseline) ? baseline : targets[0] ?? "";
  const needsJudge = data.status === "ready" && data.benches.some((b) => benches.includes(b.name) && b.needs_judge);
  // Judges: real models not under test, from a vendor not being compared when possible. Configured targets come
  // first; catalog models fill in for users without a targets.yaml (a catalog id resolves as the judge server-side).
  const judges: Judge[] = [];
  if (data.status === "ready") {
    const under = new Set(targets.flatMap((n) => [n, data.targets.find((t) => t.name === n)?.model ?? ""]));
    const seen = new Set<string>();
    for (const t of data.targets) {
      if (t.kind === "mock" || !t.keys_ok || under.has(t.name)) continue;
      judges.push({ name: t.name, group: "Configured", vendor: vendor(t.model) });
      seen.add(t.model ?? t.name);
    }
    if (judgeCatalog.status === "ready") {
      for (const p of judgeCatalog.catalog.providers.filter((x) => x.key_ok)) {
        for (const m of p.models) {
          const litellm = `${LITELLM_PREFIX[p.provider] ?? p.provider}/${m.id}`;
          if (under.has(m.target) || under.has(litellm) || seen.has(litellm) || seen.has(m.target)) continue;
          judges.push({ name: m.target, group: NAMES[p.provider] ?? p.provider, vendor: p.provider });
        }
      }
    }
  }
  const judgesLoading = judgeCatalog.status === "loading";
  const used = new Set(data.status === "ready" ? targets.map((n) => vendor(data.targets.find((t) => t.name === n)?.model ?? n)) : []);
  const judgeName = judges.some((t) => t.name === judge) ? judge : (judges.find((t) => !used.has(t.vendor)) ?? judges[0])?.name ?? "";
  const body = { targets, benchmarks: benches, baseline: base || undefined, judge: needsJudge && judgeName ? judgeName : undefined,
    repeats: opts.repeats === "" ? undefined : Number(opts.repeats), budget_usd: opts.budget === "" ? undefined : Number(opts.budget), concurrency: Number(opts.concurrency) || 8, use_cache: opts.cache };
  const ready = targets.length >= 1 && benches.length > 0 && (!needsJudge || !!judgeName);
  const tooFew = targets.length < 2;
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

  const presets = Object.entries(data.profiles).map(([id, p]) => ({ id, names: data.benches.filter((b) => b.dimension in p.weights).map((b) => b.name) })).filter((p) => p.names.length);
  const same = (names: string[]) => names.length === benches.length && names.every((n) => benches.includes(n));
  const cases = data.benches.filter((b) => benches.includes(b.name)).reduce((n, b) => n + b.cases, 0);
  const stat = (label: string, id: string, value: string, big = false) => (
    <div><dt className="small muted">{label}</dt><dd className={big ? "stat-big" : "stat"} data-testid={id}>{value}</dd></div>
  );

  return (
    <form className="choose" onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <div className="choose-main">
        <section className="card" aria-labelledby="h-models">
          <div className="between"><h2 id="h-models">1 · Models</h2><span className="muted small">{targets.length} selected</span></div>
          <p className="muted">The baseline is the model you use today. Every other model is judged against it.</p>
          <div className="tile-grid">
            {data.targets.map((t) => (
              <ModelCard key={t.name} id={t.name} model={t.model ?? ""} off={t.keys_ok === false} checked={targets.includes(t.name)} baseline={base === t.name}
                status={t.keys_ok === false ? `no key (${t.missing_keys?.[0] ?? "unknown"})` : t.kind === "mock" ? "no key needed" : "key set"}
                onToggle={() => toggle(targets, setTargets, t.name)} onBaseline={() => setBaseline(t.name)} />
            ))}
          </div>
          {extra.length > 0 && (
            <fieldset>
              <legend>From Models</legend>
              <div className="tile-grid">
                {extra.map((name) => (
                  <ModelCard key={name} id={name} model={name} off={fromNote(name).off} checked={targets.includes(name)} baseline={base === name}
                    status={fromNote(name).text} onToggle={() => toggle(targets, setTargets, name)} onBaseline={() => setBaseline(name)} />
                ))}
              </div>
            </fieldset>
          )}
        </section>
        <section className="card" aria-labelledby="h-deck">
          <div className="between"><h2 id="h-deck">2 · What to test</h2><span className="muted small">{cases} cases in {benches.length} benchmark{benches.length === 1 ? "" : "s"}</span></div>
          <p className="muted">Start from a use case, then add or drop benchmarks.</p>
          <div className="toolbar" role="group" aria-label="Use cases">
            {presets.map((p) => <button key={p.id} type="button" className="pill" aria-pressed={same(p.names)} onClick={() => setBenches(p.names)}>{title(p.id)}</button>)}
            <button type="button" className="pill" aria-pressed={same(data.benches.map((b) => b.name))} onClick={() => setBenches(data.benches.map((b) => b.name))}>Everything</button>
          </div>
          <div className="tile-grid dims">
            {data.benches.map((b) => (
              <label key={b.name} className="tile tile-label" data-on={benches.includes(b.name)}>
                <input type="checkbox" checked={benches.includes(b.name)} onChange={() => toggle(benches, setBenches, b.name)} />
                <span className="tile-body"><span className="tile-name">{b.name}</span><span className="muted small">{b.capability}</span></span>
                <span className="muted small num">{b.cases} cases</span>
              </label>
            ))}
          </div>
        </section>
        <section className="card" aria-labelledby="h-opt">
          <h2 id="h-opt">3 · Options</h2>
          <div className="form-row">
            {needsJudge && (
              <label>Judge
                <select value={judgeName} onChange={(e) => setJudge(e.target.value)}>
                  {!judges.length && <option value="">{judgesLoading ? "Loading judges…" : "No judge available"}</option>}
                  {[...new Set(judges.map((j) => j.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {judges.filter((j) => j.group === g).map((j) => <option key={j.name} value={j.name}>{j.name}{used.has(j.vendor) ? " (same vendor as a model under test)" : ""}</option>)}
                    </optgroup>
                  ))}
                </select>
                {judgeCatalog.status === "error" && <span className="muted">Model catalog unavailable; showing configured judges only.</span>}
              </label>
            )}
            <label>Repeats<input type="number" min={1} max={10} placeholder="deck default" value={opts.repeats} onChange={(e) => setOpts({ ...opts, repeats: e.target.value })} /></label>
            <label>Parallel calls per model<input type="number" min={1} max={64} value={opts.concurrency} onChange={(e) => setOpts({ ...opts, concurrency: e.target.value })} /></label>
            <label>Budget per run (USD)<input type="number" min={0} step="0.01" placeholder="no cap" value={opts.budget} onChange={(e) => setOpts({ ...opts, budget: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={opts.cache} onChange={(e) => setOpts({ ...opts, cache: e.target.checked })} />Reuse cached answers</label>
          </div>
        </section>
      </div>
      <aside className="card summary" aria-labelledby="h-sum">
        <h2 id="h-sum">Before you run</h2>
        <ul className="summary-models">
          {targets.map((n) => <li key={n}><span className="models-cell"><span className="dot" style={{ background: vendorColor(data.targets.find((t) => t.name === n)?.model ?? n) }} />{n}</span><span className={`chip${n === base ? "" : " muted"}`}>{n === base ? "Baseline" : "Candidate"}</span></li>)}
        </ul>
        <div data-testid="estimate" aria-live="polite">
          <dl className="stats">
            {stat("Estimated cost", "est-cost", est ? usd(est.usd) : "—", true)}
            {stat("Estimated time", "est-time", est ? `~${Math.max(1, Math.round(est.minutes))} min` : "—", true)}
            {stat("API calls", "est-calls", est ? String(est.total_calls) : "—")}
            {stat("Already cached", "est-cached", est ? `${est.cached_calls} (${pct(est.cached_calls, est.total_calls)})` : "—")}
          </dl>
          <p className="muted small">
            {!ready && (needsJudge && !judgeName ? (judgesLoading ? "Loading judges…" : "These benchmarks need a judge model that is not under test.") : "Pick a model and a benchmark to see an estimate.")}
            {ready && estimate?.key !== key && "Estimating…"}
            {ready && estimate?.key === key && "error" in estimate.value && estimate.value.error}
          </p>
        </div>
        {tooFew && <p className="notice" id="start-reason">Pick at least two models to get a verdict.</p>}
        {startError && <p role="alert" className="danger">{startError}</p>}
        {confirmKey === key && est ? (
          <div className="confirm" role="group" aria-label="Confirm cost">
            <p>This run makes {est.total_calls - est.cached_calls} calls and may cost up to {usd(est.usd)}.</p>
            {!!est.unpriced?.length && <p className="danger">Heads up: cost unknown for {est.unpriced.join(", ")} — the budget cap can&apos;t be enforced for them.</p>}
            <button type="submit" className="btn" disabled={starting}>{starting ? "Starting…" : "Confirm and run"}</button>
            <button type="button" className="btn secondary" onClick={() => setConfirmKey("")}>Back</button>
          </div>
        ) : <button type="submit" className="btn start" disabled={!est || starting || tooFew} aria-describedby={tooFew ? "start-reason" : undefined}>Run comparison</button>}
        <p className="muted small center">{opts.budget ? `Capped at $${opts.budget} per run. ` : ""}You can cancel at any time.</p>
      </aside>
    </form>
  );
}
