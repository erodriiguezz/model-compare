"use client";

import { useEffect, useState } from "react";
import { getJSON, type Catalog, type Target } from "@/lib/api";

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
