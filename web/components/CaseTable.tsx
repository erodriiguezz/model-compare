import type { ProjectCase, ScorerInfo } from "@/lib/api";

/** A case as the editor holds it: text fields stay strings until save, `_orig` keeps a non-string expected value intact. */
export type Row = Omit<ProjectCase, "expected"> & { _k: number; _orig: unknown; expected: string; _tags: string };

export const show = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
export const toRow = (c: ProjectCase, k: number): Row => ({ ...c, _k: k, _orig: c.expected, expected: show(c.expected), _tags: (c.tags ?? []).join(", ") });
export function fromRow({ _k, _orig, _tags, expected, ...c }: Row): ProjectCase {
  void _k;
  const t = expected.trim();
  let value: unknown = t === "" ? null : expected;
  if (expected === show(_orig)) value = _orig;
  else if (/^[[{]/.test(t)) { try { value = JSON.parse(t); } catch { /* keep the text */ } }
  return { ...c, expected: value, tags: _tags.split(",").map((x) => x.trim()).filter(Boolean) };
}

const MULTI = "__multi";

export default function CaseTable({ rows, scorers, errors, onChange }: {
  rows: Row[]; scorers: ScorerInfo[]; errors: (key: string, exact?: boolean) => string[]; onChange: (rows: Row[]) => void;
}) {
  const edit = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, toRow({ id: `case-${rows.length + 1}`, input: "", expected: "" }, Math.max(0, ...rows.map((r) => r._k)) + 1)]);
  const pick = (i: number, type: string) => {
    const old = rows[i].scorers?.[0];
    edit(i, { scorers: type === "" ? null : [old?.type === type ? old : { type }] });
  };
  return (
    <section aria-labelledby="cases-h" className="form">
      <div className="between"><h2 id="cases-h">Cases</h2><button type="button" className="btn secondary" onClick={add}>Add case</button></div>
      {!rows.length && <p className="muted">No cases yet. Add one, or draft a set with AI.</p>}
      <ul className="cases">
        {rows.map((r, i) => {
          const n = i + 1, errs = errors(`cases.${i}`), bad = (k: string) => errors(`cases.${i}.${k}`, true).length > 0;
          const ctl = (k: string) => ({ "aria-invalid": bad(k) || undefined, "aria-describedby": bad(k) ? `e-cases-${i}` : undefined });
          return (
            <li key={r._k} className="card case">
              <div className="between"><h3>Case {n}</h3><button type="button" className="link-btn danger" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Delete case {n}</button></div>
              <div className="case-grid">
                <label>ID<input aria-label={`Case ${n} id`} value={r.id} onChange={(e) => edit(i, { id: e.target.value })} {...ctl("id")} /></label>
                <label>Tags<input aria-label={`Case ${n} tags`} value={r._tags} placeholder="comma, separated" onChange={(e) => edit(i, { _tags: e.target.value })} /></label>
                <label className="wide">Input<textarea aria-label={`Case ${n} input`} rows={3} value={r.input} onChange={(e) => edit(i, { input: e.target.value })} {...ctl("input")} /></label>
                <label>Expected<textarea aria-label={`Case ${n} expected`} rows={2} value={r.expected} onChange={(e) => edit(i, { expected: e.target.value })} {...ctl("expected")} /></label>
                <label>Scorer
                  <select aria-label={`Case ${n} scorer`} value={(r.scorers?.length ?? 0) > 1 ? MULTI : r.scorers?.[0]?.type ?? ""} onChange={(e) => e.target.value !== MULTI && pick(i, e.target.value)} {...ctl("scorers")}>
                    <option value="">Project default</option>
                    {(r.scorers?.length ?? 0) > 1 && <option value={MULTI}>{r.scorers!.length} scorers (kept)</option>}
                    {scorers.map((s) => <option key={s.name}>{s.name}</option>)}
                  </select>
                </label>
              </div>
              {errs.length > 0 && <ul id={`e-cases-${i}`} className="field-errors danger small">{errs.map((m) => <li key={m}>{m}</li>)}</ul>}
            </li>
          );
        })}
      </ul>
      {errors("cases", true).length > 0 && <p className="danger small" role="alert">{errors("cases", true).join(" ")}</p>}
    </section>
  );
}
