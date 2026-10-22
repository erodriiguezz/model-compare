import { vendorColor } from "@/lib/vendor";
import type { Decision, Marker, Profile, Suggestion } from "@/lib/report";
import VerdictChip, { VERDICT } from "./ui/VerdictChip";

const KINDS: Record<string, [string, string]> = {
  fix_errors: ["Fix errors", "bad"], switch: ["Switch", "ok"], stay: ["Stay", "info"], tradeoff: ["Trade-off", "warn"], tie: ["Tie", "info"],
  add_cases: ["Add cases", "muted"], too_small: ["Too close to call", "muted"], saturated: ["Saturated", "warn"],
};
const HEADLINE: Record<string, (t?: string) => string> = {
  switch: (t) => `Switch to ${t}.`, stay: (t) => `Stay on ${t}.`, tradeoff: (t) => `Trade-off: ${t}.`, tie: () => "No clear winner.",
};
const UNSCORED = new Set(["incomplete", "insufficient_data"]);
const STEPS = [5, 10, 20, 25, 50, 100];
const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
const humanize = (id: string) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Axis for the overall-change chart: whole-point ticks that include zero and every interval. */
function axis(decisions: Decision[]) {
  const vals = decisions.flatMap((d) => (UNSCORED.has(d.overall_verdict) || d.overall_delta_points == null ? [] : [d.overall_delta_points, ...(d.overall_range_points ?? [])]));
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const step = STEPS.find((s) => (hi - lo) / s <= 6) ?? 100;
  const min = Math.floor(lo / step) * step, max = Math.max(Math.ceil(hi / step) * step, min + step);
  const at = (v: number) => (100 * (v - min)) / (max - min);
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  return { at, ticks };
}

/** Recommendation first: the decision in one sentence, each candidate's overall change against zero, the best model per use case, then caveats and next steps. */
export default function DecisionPanel({ baseline, decisions, suggestions, profiles, warnings, markers }: {
  baseline: string; decisions: Decision[]; suggestions: Suggestion[]; profiles: Profile[]; warnings: string[]; markers: Record<string, Marker>;
}) {
  const lead = suggestions.find((s) => s.kind in HEADLINE);
  const needsFix = suggestions.some((s) => s.kind === "fix_errors");
  const title = lead ? HEADLINE[lead.kind](lead.target) : needsFix ? "Fix errors before deciding." : decisions.length ? "No decision yet." : "Scorecard only.";
  const rest = suggestions.filter((s) => s !== lead);
  const { at, ticks } = axis(decisions);
  const caveats = [...warnings, ...Object.entries(markers).filter(([, m]) => m.incomplete).map(([t]) => `${t} is incomplete: too many errors to trust its numbers, so it is not ranked.`)];
  const picks = profiles.flatMap((p) => (p.ranking[0] ? [{ id: p.profile, note: p.description, pick: p.ranking[0].target }] : []));
  return (
    <section className="card decision" aria-labelledby="rec-h" id="decision">
      <div className="decision-main">
        <div>
          <h2 id="rec-h" className="eyebrow">Recommendation</h2>
          <p className="rec-title">{title}</p>
          {lead && <p className="rec-text">{lead.text}</p>}
          {!lead && decisions.length === 0 && <p className="rec-text muted">A single model has no baseline to beat, so there is nothing to recommend.</p>}
        </div>
        {decisions.length > 0 && (
          <div>
            <div className="between small muted"><span>Change vs {baseline}, overall, with 95% CI</span><span>points</span></div>
            <ul className="forest" aria-label="Overall change">
              {decisions.map((d) => {
                const v = VERDICT[d.overall_verdict];
                const tone = v?.tone ?? "neutral";
                const scored = !UNSCORED.has(d.overall_verdict) && d.overall_delta_points != null;
                const [lo, hi] = d.overall_range_points ?? [null, null];
                return (
                  <li key={d.candidate} data-candidate={d.candidate} className={`tone-${tone}`}>
                    <span className="forest-name"><span className="dot" style={{ background: vendorColor(d.candidate) }} />{d.candidate}</span>
                    <span className="forest-plot">
                      <span className="forest-zero" style={{ left: `${at(0)}%` }} />
                      {scored && lo != null && hi != null && <span className="forest-ci" style={{ left: `${at(lo)}%`, width: `${at(hi) - at(lo)}%` }} />}
                      {scored && <span className="forest-pt" style={{ left: `${at(d.overall_delta_points as number)}%` }} />}
                    </span>
                    <span className="forest-value">
                      <span className="mono small">{scored ? `${sign(d.overall_delta_points as number)}${lo != null && hi != null ? ` [${sign(lo)}, ${sign(hi)}]` : ""}` : "Not compared"}</span>
                      <VerdictChip verdict={d.overall_verdict}>{d.overall_verdict_text}</VerdictChip>
                    </span>
                  </li>
                );
              })}
              <li className="forest-axis" aria-hidden="true">
                <span /><span className="forest-plot">{ticks.map((t) => <span key={t} style={{ left: `${at(t)}%` }}>{t > 0 ? `+${t}` : t}</span>)}</span><span />
              </li>
            </ul>
          </div>
        )}
        {caveats.length > 0 && <ul className="caveats" aria-label="Caveats">{caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
        {suggestions.length === 0
          ? <p className="muted">Nothing to act on: no decision, error or data gap found.</p>
          : rest.length > 0 && (
            <div>
              <h3 className="eyebrow">{lead ? "Also worth doing" : "Next steps"}</h3>
              <ol className="suggestions">
                {rest.map((s, i) => {
                  const [label, tone] = KINDS[s.kind] ?? [s.kind, "muted"];
                  const mde = s.data.mde_points;
                  return (
                    <li key={i} data-kind={s.kind}>
                      <span className={`chip ${tone}`}>{label}</span>
                      <div>
                        <p>{s.text}</p>
                        {typeof mde === "number" && <p className="muted small">Now {String(s.data.n)} cases; this sample can only detect a {mde.toFixed(0)} point difference.</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
      </div>
      {picks.length > 0 && (
        <div className="decision-side">
          <h3 className="eyebrow">Best by use case</h3>
          <ul className="picks">
            {picks.map((p) => (
              <li key={p.id}>
                <span><span className="pick-name">{humanize(p.id)}</span><span className="muted small">{p.note}</span></span>
                <span className="pick"><span className="dot" style={{ background: vendorColor(p.pick) }} />{p.pick}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
