"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON } from "@/lib/api";
import { Empty, Error as ErrorState, Loading } from "./States";

type Target = { name: string; model?: string; kind?: string };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; targets: Target[] };

/** Placeholder page body: fetches /api/targets and renders the shared Loading, Empty and Error states. */
export default function ApiPage({ title, blurb }: { title: string; blurb: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getJSON<Target[]>("/targets")
      .then((targets) => live && setState({ status: "ready", targets }))
      .catch(() => live && setState({ status: "error", message: "The ModelCompare API is not reachable. Check that `modelcompare serve` is running." }));
    return () => { live = false; };
  }, [attempt]);

  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="muted lede">{blurb}</p>
      {state.status === "loading" && <Loading label="Loading targets" />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}
      {state.status === "ready" && state.targets.length === 0 && (
        <Empty title="No targets configured">Copy targets.example.yaml to targets.yaml and add a model.</Empty>
      )}
      {state.status === "ready" && state.targets.length > 0 && (
        <div className="card">
          <p className="muted">{state.targets.length} targets available. This page is coming soon.</p>
        </div>
      )}
    </main>
  );
}
