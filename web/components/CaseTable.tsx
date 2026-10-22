import { Fragment, useState } from "react";
import type { ProjectCase, ScorerInfo } from "@/lib/api";

/** A case as the editor holds it: text fields stay strings until save, `_orig` keeps a non-string expected value intact. */
export type Row = Omit<ProjectCase, "expected"> & { _k: number; _orig: unknown; expected: string; _tags: string };

export const show = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
export const toRow = (c: ProjectCase, k: number): Row => ({ ...c, _k: k, _orig: c.expected, expected: show(c.expected), _tags: (c.tags ?? []).join(", ") });
/** A value that was not text keeps its type: an edit is parsed as JSON, and falls back to text only when it is not JSON. Text stays text. */
export function fromRow({ _k, _orig, _tags, expected, ...c }: Row): ProjectCase {
  void _k;
  const typed = _orig != null && typeof _orig !== "string";
  let value: unknown = expected.trim() === "" ? null : expected;
  if (expected === show(_orig)) value = _orig;
  else if (typed && value !== null) { try { value = JSON.parse(expected); } catch { /* keep the text */ } }
  return { ...c, expected: value, tags: _tags.split(",").map((x) => x.trim()).filter(Boolean) };
}

/** Problems the editor can see before the API does: a blank or repeated case id, by row index. */
export function idProblems(rows: Row[]) {
  const out: Record<number, string> = {};
  const seen = new Map<string, number>();
  rows.forEach((r) => seen.set(r.id, (seen.get(r.id) ?? 0) + 1));
  rows.forEach((r, i) => { out[i] = !r.id.trim() ? "ID is required." : seen.get(r.id)! > 1 ? "Duplicate id." : ""; });
  return out;
}
export const nextId = (rows: Row[]) => { let n = 1; while (rows.some((r) => r.id === `case-${n}`)) n++; return `case-${n}`; };

export const Err = ({ id, msgs }: { id: string; msgs: string[] }) => (msgs.length ? <p id={`e-${id}`} className="danger small">{msgs.join(" ")}</p> : null);

const MULTI = "__multi";
/** Scrolls an open case to the middle of the screen and puts focus in its id field, once it is drawn. */
export const reveal = (k: number) => requestAnimationFrame(() => {
  const row = document.getElementById(`case-${k}`);
  row?.scrollIntoView({ block: "center" });
  row?.querySelector("input")?.focus({ preventScroll: true });
});
const FIELDS = ["id", "input", "expected", "scorers"];
const PAGE = 25; // rows drawn until "Show all": a project can hold hundreds of cases

export default function CaseTable({ rows, scorers, errors, open, onOpen, onChange }: {
  rows: Row[]; scorers: ScorerInfo[]; errors: (key: string, exact?: boolean) => string[]; open: number | null; onOpen: (k: number | null) => void; onChange: (rows: Row[]) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const edit = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const k = Math.max(0, ...rows.map((r) => r._k)) + 1;
    onChange([...rows, toRow({ id: nextId(rows), input: "", expected: "" }, k)]);
    onOpen(k);
    reveal(k);
  };
  const pick = (i: number, type: string) => {
    const old = rows[i].scorers?.[0];
    edit(i, { scorers: type === "" ? null : [old?.type === type ? old : { type }] });
  };
  const dup = idProblems(rows);
  const openAt = rows.findIndex((r) => r._k === open);
  if (openAt >= limit) setLimit(openAt + 1); // the open case is always drawn, and stays drawn when it closes
  const visible = Math.min(limit, rows.length);
  const label = (r: Row) => ((r.scorers?.length ?? 0) > 1 ? `${r.scorers!.length} scorers` : r.scorers?.[0]?.type ?? <span className="muted">project default</span>);
  return (
    <section id="cases" aria-labelledby="cases-h" className="card table-card proj-cases">
      <div className="between proj-cases-head">
        <div><h2 id="cases-h" className="sec">Cases <span className="muted">· {rows.length}</span></h2><p className="muted small">Edit a case in place. 50 or more cases make verdicts trustworthy.</p></div>
        <button type="button" className="btn secondary" onClick={add}>Add case</button>
      </div>
      {!rows.length && <p className="muted proj-cases-head">No cases yet. Add one, or draft a set with AI.</p>}
      {rows.length > 0 && (
        <div className="table-wrap"><table className="list cases" aria-label="Cases">
          <thead><tr><th className="num">#</th><th>ID</th><th>Input</th><th className="hide-sm">Expected</th><th className="hide-sm">Scorer</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.slice(0, visible).map((r, i) => {
            const n = i + 1, isOpen = open === r._k;
            const fieldErrs = (k: string) => [...errors(`cases.${i}.${k}`), ...(k === "id" && dup[i] ? [dup[i]] : [])];
            const ctl = (k: string) => ({ "aria-invalid": fieldErrs(k).length > 0 || undefined, "aria-describedby": fieldErrs(k).length ? `e-cases-${i}-${k}` : undefined });
            const known = FIELDS.flatMap((k) => fieldErrs(k));
            const other = errors(`cases.${i}`).filter((m) => !known.includes(m));
            const first = [...known, ...other][0];
            return (
              <Fragment key={r._k}>
                <tr>
                  <td className="num muted">{n}</td>
                  <td className="nowrap mono small">{r.id}</td>
                  <td><span className="preview">{r.input}</span>{first && !isOpen && <div className="danger small">{first}</div>}</td>
                  <td className="hide-sm"><span className="preview mono small">{r.expected}</span></td>
                  <td className="hide-sm nowrap"><span className="tag">{label(r)}</span></td>
                  <td className="nowrap">
                    <button type="button" id={`edit-${r._k}`} className="link-btn" aria-expanded={isOpen} aria-controls={`case-${r._k}`} aria-label={`Edit case ${n}`} onClick={() => onOpen(isOpen ? null : r._k)}>{isOpen ? "Close" : "Edit"}</button>{" "}
                    <button type="button" className="link-btn danger" aria-label={`Delete case ${n}`} onClick={() => { onChange(rows.filter((_, j) => j !== i)); if (isOpen) onOpen(null); }}>Delete</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr id={`case-${r._k}`} className="proj-open"><td colSpan={6}>
                    <div className="case-grid">
                      <label>ID<input aria-label={`Case ${n} id`} value={r.id} onChange={(e) => edit(i, { id: e.target.value })} {...ctl("id")} /><Err id={`cases-${i}-id`} msgs={fieldErrs("id")} /></label>
                      <label>Tags<input aria-label={`Case ${n} tags`} value={r._tags} placeholder="comma, separated" onChange={(e) => edit(i, { _tags: e.target.value })} /></label>
                      <label className="wide">Input<textarea aria-label={`Case ${n} input`} rows={3} value={r.input} onChange={(e) => edit(i, { input: e.target.value })} {...ctl("input")} /><Err id={`cases-${i}-input`} msgs={fieldErrs("input")} /></label>
                      <label>Expected<textarea aria-label={`Case ${n} expected`} rows={2} value={r.expected} onChange={(e) => edit(i, { expected: e.target.value })} {...ctl("expected")} /><Err id={`cases-${i}-expected`} msgs={fieldErrs("expected")} /></label>
                      <label>Scorer
                        <select aria-label={`Case ${n} scorer`} value={(r.scorers?.length ?? 0) > 1 ? MULTI : r.scorers?.[0]?.type ?? ""} onChange={(e) => e.target.value !== MULTI && pick(i, e.target.value)} {...ctl("scorers")}>
                          <option value="">Project default</option>
                          {(r.scorers?.length ?? 0) > 1 && <option value={MULTI}>{r.scorers!.length} scorers (kept)</option>}
                          {scorers.map((s) => <option key={s.name}>{s.name}</option>)}
                        </select>
                        <Err id={`cases-${i}-scorers`} msgs={fieldErrs("scorers")} />
                      </label>
                      {other.length > 0 && <p className="danger small wide">{other.join(" ")}</p>}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table></div>
      )}
      {visible < rows.length && <p className="proj-cases-head"><button type="button" className="link-btn" onClick={() => { const k = rows[visible]._k; setLimit(Infinity); requestAnimationFrame(() => document.getElementById(`edit-${k}`)?.focus()); }}>Show all {rows.length} cases</button></p>}
      {errors("cases", true).length > 0 && <p className="danger small proj-cases-head" role="alert">{errors("cases", true).join(" ")}</p>}
    </section>
  );
}
