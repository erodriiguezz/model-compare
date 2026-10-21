"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DIMENSIONS, deleteJSON, getJSON, postJSON, putJSON, type ApiError, type FieldError, type Project, type ScorerInfo, type ScorerSpec } from "@/lib/api";
import CaseTable, { Err, fromRow, idProblems, toRow, type Row } from "./CaseTable";
import { Empty, ErrorState, Loading } from "./States";

type Loaded = { project: Project; scorers: ScorerInfo[] };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "missing" } | ({ status: "ready"; slug: string | null; id: number } & Loaded);

const BLANK: Project = { name: "", dimension: "custom", description: "", system_prompt: "", scorers: [], cases: [] };
const KNOWN = ["name", "description", "dimension", "system_prompt", "pass_threshold", "scorers", "cases"];
const group = (fields: FieldError[]) => fields.reduce<Record<string, string[]>>((acc, f) => { const k = f.loc.join("."); (acc[k] ??= []).push(f.msg); return acc; }, {});

const SLUG = /^[a-z0-9-]{1,64}$/;
const CODE_SCORERS = ["code_exec", "test_quality"];
const badRows = (found: FieldError[]) => found.flatMap((f) => (f.loc[0] === "cases" && /^\d+$/.test(f.loc[1] ?? "") ? [Number(f.loc[1])] : []));

function Form({ initial, slug, scorers, onSaved }: { initial: Project; slug: string | null; scorers: ScorerInfo[]; onSaved: (slug: string) => void }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() => initial.cases.map(toRow));
  const [params, setParams] = useState<string[]>(() => initial.scorers.map((s) => (s.params && Object.keys(s.params).length ? JSON.stringify(s.params) : ""))); // by position: two scorers of one type keep their own
  const [open, setOpen] = useState<number | null>(null); // the one expanded case
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<Project>) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };
  const errs = (key: string, exact = false) => Object.entries(errors).filter(([k]) => k === key || (!exact && k.startsWith(`${key}.`))).flatMap(([, m]) => m);
  const ctl = (key: string) => ({ "aria-invalid": errs(key).length > 0 || undefined, "aria-describedby": errs(key).length ? `e-${key}` : undefined });
  const stray = Object.entries(errors).filter(([k]) => !KNOWN.includes(k.split(".")[0])).flatMap(([, m]) => m);

  const toggle = (name: string) => {
    const keep = form.scorers.map((x, i) => i).filter((i) => form.scorers[i].type !== name);
    const on = keep.length < form.scorers.length;
    set({ scorers: on ? keep.map((i) => form.scorers[i]) : [...form.scorers, { type: name }] });
    setParams(on ? keep.map((i) => params[i]) : [...params, ""]);
  };

  async function save() {
    const found: FieldError[] = [];
    if (!form.name.trim()) found.push({ loc: ["name"], msg: "Name is required." });
    Object.entries(idProblems(rows)).forEach(([i, msg]) => msg && found.push({ loc: ["cases", i, "id"], msg }));
    const specs: ScorerSpec[] = form.scorers.map((s, i) => {
      const text = (params[i] ?? "").trim();
      const { params: _old, ...bare } = s;
      void _old;
      if (!text) return bare;
      try { const p = JSON.parse(text); if (p && typeof p === "object" && !Array.isArray(p)) return { ...bare, params: p }; } catch { /* reported below */ }
      found.push({ loc: ["scorers", String(i), "params"], msg: `Parameters for ${s.type} must be a JSON object.` });
      return s;
    });
    const show = (list: FieldError[]) => { setErrors(group(list)); const bad = badRows(list).map((i) => rows[i]?._k); if (bad.length && !bad.includes(open as number)) setOpen(bad[0]); };
    if (found.length) return show(found);
    setBusy(true); setErrors({});
    const body = { ...form, name: form.name.trim(), system_prompt: form.system_prompt || null, scorers: specs, cases: rows.map(fromRow) };
    try {
      const out = slug ? await putJSON<{ slug: string }>(`/projects/${encodeURIComponent(slug)}`, body) : await postJSON<{ slug: string }>("/projects", body);
      setSaved(true); onSaved(out.slug);
    } catch (e) {
      const a = e as ApiError;
      if (a.fields) show(a.fields); else setErrors({ [a.status === 409 ? "name" : "body"]: [a.message] });
    } finally { setBusy(false); }
  }
  async function remove() {
    try { await deleteJSON(`/projects/${encodeURIComponent(slug!)}`); router.push("/projects/"); } catch (e) { setErrors({ body: [(e as Error).message] }); setConfirming(false); }
  }

  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {stray.length > 0 && <p className="note" role="alert">{stray.join(" ")}</p>}
      <section className="card form" aria-label="Project details">
        <label>Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} {...ctl("name")} /></label>
        <Err id="name" msgs={errs("name")} />
        <label>Description<input value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} {...ctl("description")} /></label>
        <div className="form-row">
          <label>Dimension<select value={form.dimension} onChange={(e) => set({ dimension: e.target.value })} {...ctl("dimension")}>{DIMENSIONS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>Pass threshold<input type="number" min={0} max={1} step={0.05} placeholder="1" value={form.pass_threshold ?? ""} onChange={(e) => set({ pass_threshold: e.target.value === "" ? undefined : Number(e.target.value) })} {...ctl("pass_threshold")} /></label>
        </div>
        <Err id="dimension" msgs={errs("dimension")} /><Err id="pass_threshold" msgs={errs("pass_threshold")} />
        <label>System prompt<textarea rows={3} value={form.system_prompt ?? ""} onChange={(e) => set({ system_prompt: e.target.value })} {...ctl("system_prompt")} /></label>
        <fieldset>
          <legend>Scorers (for every case without its own)</legend>
          <div className="scorer-grid" data-testid="scorer-grid">
            {scorers.map((s) => {
              const on = form.scorers.some((x) => x.type === s.name);
              return (
                <div key={s.name} className="scorer">
                  <label className="check"><input type="checkbox" checked={on} onChange={() => toggle(s.name)} /><span>{s.name}</span></label>
                  <p className="muted small">{s.description}</p>
                  {on && CODE_SCORERS.includes(s.name) && <p className="note small">Runs Python on this machine — only use with code you trust.</p>}
                </div>
              );
            })}
          </div>
          {form.scorers.map((s, i) => {
            const same = form.scorers.filter((x) => x.type === s.type);
            return (
              <label key={i} className="params-row">{s.type} parameters
                <input aria-label={`${s.type} parameters${same.length > 1 ? ` ${same.indexOf(s) + 1}` : ""}`} placeholder='JSON, e.g. {"values": ["Paris"]}' value={params[i] ?? ""} onChange={(e) => { setParams(params.map((p, j) => (j === i ? e.target.value : p))); setSaved(false); }} />
              </label>
            );
          })}
          {errs("scorers").length > 0 && <p className="danger small" role="alert">{errs("scorers").join(" ")}</p>}
        </fieldset>
      </section>
      <CaseTable rows={rows} scorers={scorers} errors={errs} open={open} onOpen={setOpen} onChange={(r) => { setRows(r); setSaved(false); }} />
      {errs("body").length > 0 && <p className="danger" role="alert">{errs("body").join(" ")}</p>}
      <div className="between">
        <div className="bar-actions">
          <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save project"}</button>
          <span role="status" className="muted">{saved ? "Saved" : ""}</span>
        </div>
        {slug && !confirming && <button type="button" className="btn secondary destructive-text" onClick={() => setConfirming(true)}>Delete project</button>}
      </div>
      {confirming && (
        <div className="confirm">
          <p>Delete “{initial.name}”? This removes its file and cannot be undone. Past runs stay in History.</p>
          <button type="button" className="btn destructive" onClick={() => void remove()}>Confirm delete</button>
          <button type="button" className="btn secondary" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
    </form>
  );
}

/** /projects/edit/?slug=<slug> edits a saved project; ?new=1 (or no slug) starts a blank one. */
export default function ProjectEditor() {
  const slug = useSearchParams().get("slug");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const known = useRef<string | null>(null); // the slug a save just created: no reload, the form already holds it
  const loads = useRef(0);
  useEffect(() => {
    if (slug && known.current === slug) return;
    let live = true;
    const bad = Object.assign(new Error("Invalid project name in the address."), { status: 404 }); // never put an unchecked slug in a request path
    Promise.all([slug ? (SLUG.test(slug) ? getJSON<Project>(`/projects/${encodeURIComponent(slug)}`) : Promise.reject(bad)) : BLANK, getJSON<ScorerInfo[]>("/scorers")])
      .then(([project, scorers]) => live && setState({ status: "ready", slug, id: ++loads.current, project, scorers }))
      .catch((e: ApiError) => live && setState(e.status === 404 ? { status: "missing" } : { status: "error", message: e.message }));
    return () => { live = false; };
  }, [slug, attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  const saved = (s: string) => {
    known.current = s;
    setState((st) => (st.status === "ready" ? { ...st, slug: s } : st));
    window.history.replaceState(null, "", `/projects/edit/?slug=${s}`);
  };

  return (
    <main className="page">
      <Link href="/projects/" prefetch={false} className="back">← Projects</Link>
      <h1>{state.status === "ready" && state.slug ? state.project.name : "New project"}</h1>
      {state.status === "loading" && <Loading label="Loading project" />}
      {state.status === "error" && <ErrorState message={`Could not load the project (${state.message}).`} onRetry={retry} />}
      {state.status === "missing" && <Empty title="Project not found"><Link href="/projects/" prefetch={false}>Back to projects</Link></Empty>}
      {state.status === "ready" && <Form key={state.id} initial={state.project} slug={state.slug} scorers={state.scorers} onSaved={saved} />}
    </main>
  );
}
