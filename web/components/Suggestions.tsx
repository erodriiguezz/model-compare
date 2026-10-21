import type { Suggestion } from "@/lib/report";

const KINDS: Record<string, [string, string]> = {
  fix_errors: ["Fix errors", "bad"], switch: ["Switch", "ok"], stay: ["Stay", "info"], tradeoff: ["Trade-off", "warn"], tie: ["Tie", "info"],
  add_cases: ["Add cases", "muted"], too_small: ["Too close to call", "muted"], saturated: ["Saturated", "warn"],
};

/** What to do next, in the order the engine returns it: errors, then decisions, then advice on collecting data. */
export default function Suggestions({ items }: { items: Suggestion[] }) {
  return (
    <section className="card" aria-labelledby="suggest-h">
      <h2 id="suggest-h">Suggestions</h2>
      {items.length === 0
        ? <p className="muted">Nothing to act on: no decision, error or data gap found.</p>
        : (
          <ol className="suggestions">
            {items.map((s, i) => {
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
        )}
    </section>
  );
}
