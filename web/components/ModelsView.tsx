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

/** Latest run's pass rate per target; run ids grow over time. */
function latestScores(runs: RunRow[]) {
  const latest = new Map<string, RunRow>();
  for (const r of runs) if (!latest.has(r.target_name) || r.id > latest.get(r.target_name)!.id) latest.set(r.target_name, r);
  return (target: string) => { const r = latest.get(target); return r ? pct(r.passed, r.n_results) : "—"; };
}

export default function ModelsView() {
  const initial = useSearchParams().get("sel");
  const [selected, setSelected] = useState<string[]>(() => (initial ?? "").split(",").filter(Boolean));
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set(["configured"]));
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([getJSON<Catalog>("/models"), getJSON<Target[]>("/targets/status"), getJSON<RunRow[]>("/runs")])
      .then(([catalog, targets, runs]) => live && setState({ status: "ready", catalog, targets, runs }))
      .catch(() => live && setState({ status: "error", message: "Could not load models." }));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  const retryProvider = () => getJSON<Catalog>("/models?refresh=1").then((catalog) => setState((s) => (s.status === "ready" ? { ...s, catalog } : s))).catch(() => {});

  const toggleSel = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    // The URL mirrors the selection so it survives a reload; no navigation needed.
    window.history.replaceState(null, "", next.length ? `/models/?sel=${encodeURIComponent(next.join(","))}` : "/models/");
  };
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });

  return (
    <main className="page">
      <h1>Models</h1>
      <p className="muted lede">Pick models to compare. Catalog models come from your provider keys; configured ones from targets.yaml.</p>
      {state.status === "loading" && <Loading label="Loading models" />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry}>Check that <code>modelcompare serve</code> is running.</ErrorState>}
      {state.status === "ready" && <Tree data={state} selected={selected} open={open} query={query} setQuery={setQuery} onSel={toggleSel} onOpen={toggleOpen} onRetry={retryProvider} />}
      {selected.length > 0 && (
        <div className="selection-bar" data-testid="selection-bar">
          <span>{selected.length} selected</span>
          <Link className="btn" href={`/compare/?targets=${encodeURIComponent(selected.join(","))}`} prefetch={false}>Compare selected</Link>
        </div>
      )}
    </main>
  );
}

function Tree({ data, selected, open, query, setQuery, onSel, onOpen, onRetry }: {
  data: Data; selected: string[]; open: Set<string>; query: string; setQuery: (q: string) => void;
  onSel: (id: string) => void; onOpen: (id: string) => void; onRetry: () => void;
}) {
  const score = latestScores(data.runs);
  const q = query.trim().toLowerCase();
  const keep = (i: Item) => !q || i.id.toLowerCase().includes(q);
  const configured: Item[] = data.targets.map((t) => ({
    id: t.name, context: "—", priceIn: "—", priceOut: "—", note: t.keys_ok === false ? `no key (${t.missing_keys?.[0] ?? "unknown"})` : t.model, disabled: t.keys_ok === false,
  }));
  const noKeys = data.catalog.providers.every((p) => p.reason === "no key");
  if (noKeys && !configured.length) return <Empty title="No models yet">Add a provider key in <Link href="/settings/" prefetch={false}>Settings</Link> to list its models.</Empty>;

  const rows = (items: Item[]) => (
    <ul className="model-list">
      {items.map((i) => <ModelRow key={i.id} {...i} score={score(i.id)} checked={selected.includes(i.id)} onToggle={() => onSel(i.id)} />)}
    </ul>
  );
  const groups = [
    { id: "configured", label: "Configured (targets.yaml)", token: "other", chip: null, items: configured.filter(keep), total: configured.length, extra: null },
    ...data.catalog.providers.map((p) => ({
      id: p.provider, label: p.provider, token: TOKENS[p.provider] ?? "other", total: p.models.length,
      items: p.models.map((m): Item => ({ id: m.target, context: ctxLabel(m.context), priceIn: priceLabel(m.price_in), priceOut: priceLabel(m.price_out) })).filter(keep),
      chip: <span className={`chip ${p.key_ok ? "ok" : p.error ? "bad" : "muted"}`}>{p.key_ok ? "key set" : p.error ? "error" : "no key"}</span>,
      extra: p.key_ok ? null : p.error
        ? <p className="provider-note danger" role="alert">{p.error} <button type="button" className="link-btn" onClick={onRetry}>Retry</button></p>
        : <p className="provider-note"><Link href="/settings/" prefetch={false}>Add key</Link> to list this provider&apos;s models.</p>,
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
      {groups.map((g) => (
        <ProviderRow key={g.id} id={g.id} label={g.label} token={g.token} chip={g.chip} count={q ? g.items.length : g.total}
          open={!!q || open.has(g.id)} onToggle={g.total ? () => onOpen(g.id) : undefined}>
          {(q || open.has(g.id)) && g.items.length > 0 && rows(g.items)}
          {g.extra}
        </ProviderRow>
      ))}
    </>
  );
}
