"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, getJSON, type ProjectRow, type RunRow } from "@/lib/api";
import { Empty, ErrorState, Loading } from "./States";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: ProjectRow[]; runs: RunRow[] };

export default function ProjectsView() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    // A failing runs call only blanks the "last run" column.
    Promise.all([getJSON<ProjectRow[]>("/projects"), getJSON<RunRow[]>("/runs").catch(() => [])])
      .then(([rows, runs]) => live && setState({ status: "ready", rows, runs }))
      .catch((e: Error) => live && setState({ status: "error", message: e.message }));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  const [query, setQuery] = useState("");
  const ready = state.status === "ready";
  const all = ready ? state.rows : [];
  const q = query.trim().toLowerCase();
  const shown = all.filter((p) => !q || `${p.name} ${p.dimension ?? ""}`.toLowerCase().includes(q));
  const broken = all.filter((p) => !p.valid).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted lede">Your own benchmarks: cases, scorers and a system prompt, ready to run on any model. They sit next to the standard deck when you compare.</p>
        </div>
        {all.length > 0 && <Link href="/projects/edit/?new=1" prefetch={false} className="btn">New project</Link>}
      </div>
      {state.status === "loading" && <Loading label="Loading projects" />}
      {state.status === "error" && <ErrorState message={`Could not load projects (${state.message}).`} onRetry={retry} />}
      {ready && !all.length && (
        <Empty title="No projects yet" action={<Link href="/projects/edit/?new=1" prefetch={false} className="btn">Create your first project</Link>}>
          A project is a set of your own cases and scorers. Create one, or let a model draft the first cases.
        </Empty>
      )}
      {all.length > 0 && (
        <>
          <div className="toolbar">
            <label className="search">
              <span className="sr-only">Search projects</span>
              <input type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <span className="muted small proj-count">{all.length} {all.length === 1 ? "project" : "projects"}{broken > 0 && ` · ${broken} need${broken === 1 ? "s" : ""} fixing`}</span>
          </div>
          {!shown.length && <p className="muted state">No projects match.</p>}
          <div className="proj-grid">{shown.map((p) => {
            const last = ready ? state.runs.find((r) => r.benchmark_name === p.name) : undefined;
            return (
              <article key={p.slug} className="card proj-card" data-valid={p.valid} aria-labelledby={`p-${p.slug}`}>
                <div className="between">
                  <h2 id={`p-${p.slug}`}><Link href={`/projects/edit/?slug=${p.slug}`} prefetch={false} className="row-link">{p.name}</Link></h2>
                  {p.valid ? <span className="tag">{p.dimension ?? "—"}</span> : <span className="chip bad">invalid</span>}
                </div>
                {!p.valid && <p className="proj-error small">{p.error}</p>}
                <div className="proj-foot small">
                  <b>{p.n_cases} {p.n_cases === 1 ? "case" : "cases"}</b>
                  <span className="muted">{last ? `${last.started_at ? `${fmtTime(last.started_at)} · ` : ""}${last.target_name}` : "Never run"}</span>
                </div>
              </article>
            );
          })}</div>
        </>
      )}
    </main>
  );
}
