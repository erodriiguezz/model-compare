"use client";

import { useState } from "react";
import { vendorColor } from "@/lib/vendor";
import type { CaseSide, FlaggedItem } from "@/lib/report";
import VerdictChip from "./ui/VerdictChip";

const SHOWN = 8;
const pct = (v: number) => `${Math.round(100 * v)}%`;

/** Cases the baseline passed and a candidate no longer does: one tab per candidate, each row opening to both outputs and the scorer's reason. */
export default function Regressions({ flagged, baseline, candidates }: { flagged: Record<string, { items: FlaggedItem[] }>; baseline: string; candidates: string[] }) {
  const rows = (t: string) => (flagged[t]?.items ?? []).filter((i) => i.kind === "regression");
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const sel = picked ?? candidates.reduce((best, t) => (rows(t).length > rows(best).length ? t : best), candidates[0] ?? "");
  const list = rows(sel);
  const side = (role: string, name: string, s: CaseSide) => (
    <div key={role} className="reg-side">
      <div className="between"><strong>{name} · {role}</strong><VerdictChip tone={s.pass_rate >= 0.5 ? "better" : "worse"}>{s.pass_rate >= 0.5 ? "Passed" : "Failed"}</VerdictChip></div>
      <pre className="mono" tabIndex={0} aria-label={`${name} output`}>{s.text || "(no output)"}</pre>
    </div>
  );
  return (
    <section id="regressions" className="report-section" aria-labelledby="regress-h">
      <div>
        <h2 id="regress-h" className="sec">Regressions</h2>
        <p className="muted">Cases {baseline} passed and a candidate failed, most reliable first. Consistent means it failed on every repeat. <a href="#cases-h">Open the case explorer</a> to read every output.</p>
      </div>
      <div role="group" aria-label="Candidates" className="reg-filter">
        {candidates.map((t) => (
          <button key={t} type="button" className="pill" aria-pressed={t === sel} onClick={() => { setPicked(t); setAll(false); }}>
            <span className="dot" style={{ background: vendorColor(t) }} /> {t} · {rows(t).length}
          </button>
        ))}
      </div>
      <div className="card table-card">
        {list.length === 0 && <p className="muted">{sel ? `No case that ${baseline} passed fails on ${sel}.` : "No candidates to compare."}</p>}
        {(all ? list : list.slice(0, SHOWN)).map((r) => (
          <details key={`${sel}/${r.benchmark}/${r.case_id}`} className="reg">
            <summary>
              <span className="mono reg-id">{r.benchmark} · {r.case_id}</span>
              <span className="tag">{r.dimension}</span>
              <VerdictChip tone={r.tag === "consistent" ? "worse" : "neutral"}>{r.tag.replace("_", " ")}</VerdictChip>
              <span className="mono small">{pct(r.baseline.score)} → {pct(r.candidate.score)}</span>
            </summary>
            <div className="reg-body">
              <p><strong>Why it failed:</strong> {r.candidate.reasons.filter(Boolean).join(" · ") || "No reason recorded."}</p>
              <div className="reg-pair">{side("baseline", baseline, r.baseline)}{side("candidate", sel, r.candidate)}</div>
            </div>
          </details>
        ))}
        {list.length > SHOWN && !all && <p><button type="button" className="btn secondary" onClick={() => setAll(true)}>Show all {list.length}</button></p>}
      </div>
    </section>
  );
}
