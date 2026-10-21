"use client";

import { useState } from "react";
import { postJSON, type ApiError, type Project } from "@/lib/api";
import Dialog from "./Dialog";
import { ModelSelect, useChoices } from "./ModelPicker";

export type Draft = { benchmark: Project; cost_usd: number };

/** One example per line; "input => expected" adds the expected answer. */
const parseExamples = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [input, ...rest] = l.split("=>");
  return rest.length ? { input: input.trim(), expected: rest.join("=>").trim() } : { input: l };
});

export default function DraftDialog({ open, onClose, onDraft }: { open: boolean; onClose: () => void; onDraft: (d: Draft) => void }) {
  const choices = useChoices(open);
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [examples, setExamples] = useState("");
  const [n, setN] = useState("6");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = choices?.some((c) => c.id === model) ? model : choices?.[0]?.id ?? "";

  async function draft() {
    if (busy || !target || !description.trim()) return;
    setBusy(true); setError("");
    try {
      onDraft(await postJSON<Draft>("/projects/draft", { target, description, examples: parseExamples(examples), n_cases: Number(n) || 6 }));
      onClose();
    } catch (e) {
      const a = e as ApiError;
      setError(a.fields ? a.fields.map((f) => f.msg).join(" ") : a.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} title="Draft with AI" onClose={onClose} onSubmit={() => void draft()}>
      <p className="muted">The model drafts cases and scorers from your description. Nothing is saved until you press Save, and the call costs a little.</p>
      {choices && !choices.length && <p className="note">No model is ready to use. Add an API key in Settings first.</p>}
      {choices && choices.length > 0 && <ModelSelect choices={choices} value={target} onChange={setModel} />}
      <label>Describe the project<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Examples (optional, one per line, “input =&gt; expected”)<textarea rows={4} value={examples} onChange={(e) => setExamples(e.target.value)} /></label>
      <label>Number of cases<input type="number" min={1} max={50} value={n} onChange={(e) => setN(e.target.value)} /></label>
      {error && <p className="danger" role="alert">{error}</p>}
      <div className="bar-actions">
        <button type="submit" className="btn" disabled={busy || !target || !description.trim()}>{busy ? "Drafting…" : "Draft"}</button>
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
