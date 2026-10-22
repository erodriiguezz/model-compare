"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON, type Catalog, type Target } from "@/lib/api";
import { vendorColor } from "@/lib/vendor";

export type Choice = { id: string; note: string; group: string };

/** Models that can run right now: configured targets with a key, plus catalog models of providers with a key. */
export function useChoices(active: boolean) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    Promise.all([getJSON<Target[]>("/targets/status"), getJSON<Catalog>("/models").catch(() => null)]).then(([targets, catalog]) => {
      if (!live) return;
      const own = targets.filter((t) => t.keys_ok !== false).map((t) => ({ id: t.name, note: t.model ?? "", group: "Configured" }));
      const names = new Set(own.map((c) => c.id));
      const more = (catalog?.providers ?? []).filter((p) => p.key_ok).flatMap((p) => p.models.filter((m) => !names.has(m.target)).map((m) => ({ id: m.target, note: m.name ?? "", group: p.provider })));
      setChoices([...own, ...more]);
    }).catch(() => live && setChoices([]));
    return () => { live = false; };
  }, [active]);
  return choices;
}

const groups = (choices: Choice[]) => [...new Set(choices.map((c) => c.group))];

export function ModelSelect({ choices, value, onChange }: { choices: Choice[]; value: string; onChange: (id: string) => void }) {
  return (
    <label>Model
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {groups(choices).map((g) => <optgroup key={g} label={g}>{choices.filter((c) => c.group === g).map((c) => <option key={c.id}>{c.id}</option>)}</optgroup>)}
      </select>
    </label>
  );
}

export function ModelChecks({ choices, value, onChange }: { choices: Choice[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="scroll-list">
      {groups(choices).map((g) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {choices.filter((c) => c.group === g).map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={value.includes(c.id)} onChange={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])} />
              <span>{c.id}</span><span className="muted">{c.note}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** One selectable model on the Choose screen: vendor dot, key status, and a baseline marker or control. */
export function ModelCard({ id, model, status, off, checked, baseline, onToggle, onBaseline }: {
  id: string; model: string; status: string; off: boolean; checked: boolean; baseline: boolean; onToggle: () => void; onBaseline: () => void;
}) {
  return (
    <div role="group" aria-label={id} className="tile" data-on={checked} data-off={off}>
      <label className="tile-label">
        <input type="checkbox" checked={checked} disabled={off} onChange={onToggle} aria-describedby={baseline ? `baseline-${id}` : undefined} />
        <span className="tile-body">
          <span className="tile-name"><span className="dot" style={{ background: vendorColor(model || id) }} />{id}</span>
          <span className="mono muted small">{model}</span>
          <span className={`small ${off ? "danger" : "key-ok"}`}>{status}</span>
        </span>
      </label>
      {off && <Link href="/settings/" className="small">Add key in Settings</Link>}
      {baseline && <span className="chip tile-flag" id={`baseline-${id}`}>Baseline</span>}
      {checked && !baseline && <button type="button" className="link-btn tile-flag" onClick={onBaseline}>Make baseline</button>}
    </div>
  );
}
