"use client";

import { useEffect, useRef, useState } from "react";
import { deleteJSON, postJSON, putJSON, type KeyStatus } from "@/lib/api";

type Mode = "idle" | "edit" | "confirm";
type Note = { ok: boolean; text: string } | null;

const LABELS: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", togetherai: "Together AI", groq: "Groq", openrouter: "OpenRouter",
};

/** One provider key: masked status plus add/replace, test and remove. The full value lives only in the input while typing. */
export default function KeyRow({ row, onChange }: { row: KeyStatus; onChange: (next: KeyStatus) => void }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const name = LABELS[row.provider] ?? row.provider;
  const base = `/settings/keys/${row.provider}`;

  // Back at idle after Save, Cancel or Remove, focus returns to the row's first action (its button remounts).
  useEffect(() => {
    if (mode === "idle" && restoreFocus.current) { restoreFocus.current = false; actionRef.current?.focus(); }
  }, [mode]);
  const toIdle = () => { restoreFocus.current = true; setMode("idle"); };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try { await action(); } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : "Request failed." }); }
    setBusy(false);
  }

  const save = () => run(async () => {
    onChange(await putJSON<KeyStatus>(base, { value }));
    setValue("");
    toIdle();
    setNote({ ok: true, text: "Saved." });
  });
  const test = () => run(async () => {
    const r = await postJSON<{ ok: boolean; message: string }>(`${base}/test`);
    setNote({ ok: r.ok, text: r.message });
  });
  const remove = () => run(async () => {
    onChange(await deleteJSON<KeyStatus>(base));
    toIdle();
    setNote({ ok: true, text: "Removed." });
  });

  const chip = !row.set ? <span className="chip muted">not set</span>
    : row.source === "environment" ? <span className="chip info">from environment</span>
    : <span className="chip ok">set</span>;

  return (
    <li className="card key-row" data-provider={row.provider}>
      <div className="key-head">
        <div>
          <h2>{name}</h2>
          <code className="muted">{row.var}</code>
        </div>
        {chip}
        <code className="key-mask" aria-label={`${name} key`}>{row.masked ?? "—"}</code>
        {mode === "idle" && (
          <div className="key-actions">
            <button type="button" ref={actionRef} className="btn secondary" disabled={busy} onClick={() => { setNote(null); setMode("edit"); }}>{row.set ? "Replace" : "Add"}</button>
            {row.set && <button type="button" className="btn secondary" disabled={busy} onClick={test}>Test</button>}
            {row.source === "file" && <button type="button" className="btn secondary" disabled={busy} onClick={() => { setNote(null); setMode("confirm"); }}>Remove</button>}
          </div>
        )}
      </div>
      {row.source === "environment" && (
        <p className="muted">Set in the server environment, not the env file. Replacing it here writes the file; removing it needs a change outside this page.</p>
      )}
      {mode === "edit" && (
        <form className="key-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label>
            <span className="sr-only">{name} API key</span>
            <input type="password" autoFocus autoComplete="new-password" spellCheck={false} placeholder={`Paste ${name} key`} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={busy || !value.trim()}>Save</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => { setValue(""); toIdle(); }}>Cancel</button>
        </form>
      )}
      {mode === "confirm" && (
        <div className="confirm" role="group" aria-label={`Remove ${name} key`}>
          <p>Remove the {name} key from the env file?</p>
          <button type="button" className="btn destructive" disabled={busy} onClick={remove}>Remove key</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={toIdle}>Cancel</button>
        </div>
      )}
      <p role="status" className={note ? (note.ok ? "key-ok" : "key-bad") : undefined}>{note?.text}</p>
    </li>
  );
}
