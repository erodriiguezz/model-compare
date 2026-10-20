"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ctxLabel, getJSON, pct, priceLabel, type Catalog, type RunRow, type Target } from "@/lib/api";
import ModelRow from "./ModelRow";
import ProviderRow from "./ProviderRow";
import { Empty, ErrorState, Loading } from "./States";

type Data = { catalog: Catalog; targets: Target[]; runs: RunRow[] };
type State = { status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & Data);
type Item = { id: string; context: string; priceIn: string; priceOut: string; note?: string; disabled?: boolean };

const TOKENS: Record<string, string> = { openai: "openai", anthropic: "anthropic", gemini: "google" };
const NAMES: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", togetherai: "Together AI", groq: "Groq", openrouter: "OpenRouter" };
const DONE = ["done", "budget_exceeded"];

/** Pass rate per target: the latest finished run of each benchmark, passed summed over results. */
function passRates(runs: RunRow[]) {
  const latest = new Map<string, RunRow>();
  for (const r of runs) {
    const k = `${r.target_name}\u0000${r.benchmark_name}`;
    if (DONE.includes(r.status) && (!latest.has(k) || r.id > latest.get(k)!.id)) latest.set(k, r);
  }
  const sum = new Map<string, [number, number]>();
  for (const r of latest.values()) { const [p, n] = sum.get(r.target_name) ?? [0, 0]; sum.set(r.target_name, [p + r.passed, n + r.n_results]); }
  return (target: string) => { const s = sum.get(target); return s ? pct(s[0], s[1]) : "—"; };
}

const knownIds = (d: Data) => new Set([...d.targets.filter((t) => t.keys_ok !== false).map((t) => t.name), ...d.catalog.providers.flatMap((p) => p.models.map((m) => m.target))]);
const mirror = (ids: string[]) => window.history.replaceState(null, "", ids.length ? `/models/?sel=${encodeURIComponent(ids.join(","))}` : "/models/");

export default function ModelsView() {
  const initial = useSearchParams().get("sel");
  const [selected, setSelected] = useState<string[]>(() => (initial ?? "").split(",").filter(Boolean));
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set(["configured"]));
  const [query, setQuery] = useState("");
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([getJSON<Catalog>("/models"), getJSON<Target[]>("/targets/status"), getJSON<RunRow[]>("/runs")])
      .then(([catalog, targets, runs]) => {
        if (!live) return;
        const data = { catalog, targets, runs };
        const known = knownIds(data);
        setSelected((cur) => { const next = cur.filter((id) => known.has(id)); if (next.length !== cur.length) mirror(next); return next; });
        setState({ status: "ready", ...data });
      })
      .catch(() => live && setState({ status: "error", message: "Could not load models." }));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  const retryProvider = () => getJSON<Catalog>("/models?refresh=1")
    .then((catalog) => { setRetryFailed(false); setState((s) => (s.status === "ready" ? { ...s, catalog } : s)); })
    .catch(() => setRetryFailed(true));

  const update = (next: string[]) => { setSelected(next); mirror(next); }; // the URL mirrors the selection so it survives a reload
  const toggleSel = (id: string) => update(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });

  return (
    <main className="page">
      <h1>Models</h1>
      <p className="muted lede">Pick models to compare. Catalog models come from your provider keys; configured ones from targets.yaml.</p>
      {state.status === "loading" && <Loading label="Loading models" />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry}>Check that <code>modelcompare serve</code> is running.</ErrorState>}
      {state.status === "ready" && <Tree data={state} selected={selected} open={open} query={query} setQuery={setQuery} onSel={toggleSel} onOpen={toggleOpen} onRetry={retryProvider} retryFailed={retryFailed} />}
      {selected.length > 0 && (
        <aside className="selection-bar" aria-label="Selection" data-testid="selection-bar">
          <span role="status">{selected.length} selected</span>
          <span className="bar-actions">
            <button type="button" className="btn secondary" onClick={() => update([])}>Clear</button>
            <Link className="btn" href={`/compare/?targets=${encodeURIComponent(selected.join(","))}`} prefetch={false}>Compare selected</Link>
          </span>
        </aside>
      )}
    </main>
  );
}

function Tree({ data, selected, open, query, setQuery, onSel, onOpen, onRetry, retryFailed }: {
  data: Data; selected: string[]; open: Set<string>; query: string; setQuery: (q: string) => void;
  onSel: (id: string) => void; onOpen: (id: string) => void; onRetry: () => void; retryFailed: boolean;
}) {
  const score = passRates(data.runs);
  const q = query.trim().toLowerCase();
  const keep = (i: Item) => !q || i.id.toLowerCase().includes(q);
  const configured: Item[] = data.targets.map((t) => ({
    id: t.name, context: "—", priceIn: "—", priceOut: "—", note: t.keys_ok === false ? `no key (${t.missing_keys?.[0] ?? "unknown"})` : t.model, disabled: t.keys_ok === false,
  }));
  const keyless = data.catalog.providers.filter((p) => !p.key_ok && !p.error);
  if (keyless.length === data.catalog.providers.length && !configured.length) return <Empty title="No models yet">Add a provider key in <Link href="/settings/" prefetch={false}>Settings</Link> to list its models.</Empty>;

  const groups = [
    { id: "configured", label: "Configured (targets.yaml)", token: "other", chip: null, items: configured.filter(keep), total: configured.length, extra: null as React.ReactNode },
    ...data.catalog.providers.filter((p) => p.key_ok || p.error).map((p) => ({
      id: p.provider, label: NAMES[p.provider] ?? p.provider, token: TOKENS[p.provider] ?? "other", total: p.models.length,
      items: p.models.map((m): Item => ({ id: m.target, context: ctxLabel(m.context), priceIn: priceLabel(m.price_in), priceOut: priceLabel(m.price_out) })).filter(keep),
      chip: <span className={`chip ${p.key_ok ? "ok" : "bad"}`}>{p.key_ok ? "key set" : "error"}</span>,
      extra: p.key_ok ? null : (
        <p className="provider-note danger" role="alert">{p.error} <button type="button" className="link-btn" onClick={onRetry}>Retry</button>{retryFailed && " Retry failed, try again."}</p>
      ),
    })),
  ].filter((g) => !q || g.items.length);

  return (
    <>
      <div className="search">
        <input type="search" aria-label="Search models" placeholder="Search models by id" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!groups.length && <Empty title="No models match">Nothing matches &ldquo;{query}&rdquo;. Try a shorter id.</Empty>}
      {groups.length > 0 && (
        <div className="model-head muted small" aria-hidden="true">
          <span>Model</span><span className="num hide-sm">Context</span><span className="num hide-sm">In / 1M</span><span className="num hide-sm">Out / 1M</span><span className="num">Pass rate</span>
        </div>
      )}
      {groups.map((g) => {
        const shown = !!q || open.has(g.id);
        return (
          <ProviderRow key={g.id} id={g.id} label={g.label} token={g.token} chip={g.chip} count={q ? g.items.length : g.total}
            open={shown} controls={`${g.id}-models`} onToggle={g.total && !q ? () => onOpen(g.id) : undefined}>
            {shown && g.items.length > 0 && (
              <ul className="model-list" id={`${g.id}-models`}>
                {g.items.map((i) => <ModelRow key={i.id} {...i} score={score(i.id)} checked={selected.includes(i.id)} onToggle={() => onSel(i.id)} />)}
              </ul>
            )}
            {g.extra}
          </ProviderRow>
        );
      })}
      {!q && keyless.length > 0 && (
        <p className="card keyless" data-group="no-key">
          <span><strong>No key:</strong> <span className="muted">{keyless.map((p) => NAMES[p.provider] ?? p.provider).join(", ")}</span></span>
          <Link href="/settings/" prefetch={false}>Add keys</Link>
        </p>
      )}
    </>
  );
}
