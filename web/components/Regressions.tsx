"use client";

import { useState } from "react";
import type { FlaggedItem } from "@/lib/report";

const SHOWN = 8;
const pts = (v: number) => `${Math.round(100 * v)}%`;

/** Cases the baseline passed and a candidate no longer does. */
export default function Regressions({ flagged, baseline }: { flagged: Record<string, { items: FlaggedItem[] }>; baseline: string }) {
  const [all, setAll] = useState(false);
  const rows = Object.entries(flagged).flatMap(([t, f]) => f.items.filter((i) => i.kind === "regression").map((i) => ({ ...i, target: t })));
  return (
    <section className="card" aria-labelledby="regress-h">
      <h2 id="regress-h">Regressions</h2>
      {rows.length === 0
        ? <p className="muted">No case that {baseline} passed fails on a candidate.</p>
        : (
          <>
            <p className="muted small">Cases {baseline} passes that a candidate fails, most reliable first. <a href="#cases-h">Open the case explorer</a> to read the outputs.</p>
            <ul className="regressions">
              {(all ? rows : rows.slice(0, SHOWN)).map((r) => (
                <li key={`${r.target}/${r.benchmark}/${r.case_id}`}>
                  <strong>{r.target}</strong> · {r.benchmark} · {r.case_id}
                  <span className="muted small"> {pts(r.baseline.score)} to {pts(r.candidate.score)}, {r.tag.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
            {rows.length > SHOWN && !all && <button type="button" className="btn secondary" onClick={() => setAll(true)}>Show all {rows.length}</button>}
          </>
        )}
    </section>
  );
}
