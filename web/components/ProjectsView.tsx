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

  return (
    <main className="page">
      <div className="between">
        <h1>Projects</h1>
        {state.status === "ready" && state.rows.length > 0 && <Link href="/projects/edit/?new=1" prefetch={false} className="btn">New project</Link>}
      </div>
      <p className="muted lede">Your own benchmarks: cases, scorers and a system prompt, ready to run on any model.</p>
      {state.status === "loading" && <Loading label="Loading projects" />}
      {state.status === "error" && <ErrorState message={`Could not load projects (${state.message}).`} onRetry={retry} />}
      {state.status === "ready" && !state.rows.length && (
        <Empty title="No projects yet">
          <Link href="/projects/edit/?new=1" prefetch={false} className="btn">Create your first project</Link>
        </Empty>
      )}
      {state.status === "ready" && state.rows.length > 0 && (
        <div className="card">
          <div className="table-wrap" tabIndex={0}><table>
            <thead><tr><th>Name</th><th className="hide-sm">Dimension</th><th className="num">Cases</th><th className="hide-sm">Last run</th></tr></thead>
            <tbody>{state.rows.map((p) => {
              const last = state.runs.find((r) => r.benchmark_name === p.name);
              const lastText = last ? `${last.started_at ? `${fmtTime(last.started_at)} · ` : ""}${last.target_name}` : "Never run";
              return (
                <tr key={p.slug}>
                  <td className="name-cell">
                    <Link href={`/projects/edit/?slug=${p.slug}`} prefetch={false}>{p.name}</Link>
                    <div className="show-sm muted small">{p.dimension ?? "—"} · {lastText}</div>
                    {!p.valid && <> <span className="chip bad">invalid</span><div className="danger small">{p.error}</div></>}
                  </td>
                  <td className="hide-sm">{p.dimension ?? "—"}</td>
                  <td className="num">{p.n_cases}</td>
                  <td className="hide-sm">{last ? lastText : <span className="muted">Never run</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </div>
      )}
    </main>
  );
}
