"use client";

import { useCallback, useEffect, useState } from "react";
import KeyRow from "@/components/KeyRow";
import { Empty, ErrorState, Loading } from "@/components/States";
import { getJSON, type KeyStatus } from "@/lib/api";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: KeyStatus[] };

export default function Page() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getJSON<KeyStatus[]>("/settings/keys")
      .then((rows) => live && setState({ status: "ready", rows }))
      .catch(() => live && setState({ status: "error", message: "Provider keys could not be loaded." }));
    return () => { live = false; };
  }, [attempt]);

  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  const update = (next: KeyStatus) =>
    setState((s) => (s.status === "ready" ? { status: "ready", rows: s.rows.map((r) => (r.provider === next.provider ? next : r)) } : s));

  return (
    <main className="page">
      <h1>Settings</h1>
      <p className="muted lede">Provider API keys. They are saved to the engine env file and shown masked; changes apply immediately.</p>
      {state.status === "loading" && <Loading label="Loading keys" />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry}>Check that <code>modelcompare serve</code> is running.</ErrorState>}
      {state.status === "ready" && (
        <>
          {state.rows.every((r) => !r.set) && <Empty title="No keys yet">Add a provider key below to run models from that provider.</Empty>}
          <ul className="key-list">
            {state.rows.map((r) => <KeyRow key={r.provider} row={r} onChange={update} />)}
          </ul>
        </>
      )}
    </main>
  );
}
