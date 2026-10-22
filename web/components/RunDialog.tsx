"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Dialog from "./Dialog";
import { ModelChecks, useChoices } from "./ModelPicker";

export default function RunDialog({ open, project, onClose }: { open: boolean; project: string; onClose: () => void }) {
  const router = useRouter();
  const choices = useChoices(open);
  const [picked, setPicked] = useState<string[]>([]);
  const go = () => router.push(`/compare/?targets=${encodeURIComponent(picked.join(","))}&benchmarks=${encodeURIComponent(project)}`);
  return (
    <Dialog open={open} title="Run on selected models" onClose={onClose} onSubmit={() => picked.length && go()}>
      <p className="muted">Pick one model to score it, or two or more to compare. Compare opens with this project already selected.</p>
      {choices && !choices.length && <p className="note">No model is ready to use. Add an API key in Settings first.</p>}
      {choices && <ModelChecks choices={choices} value={picked} onChange={setPicked} />}
      <div className="bar-actions">
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn" disabled={!picked.length}>Open Compare</button>
      </div>
    </Dialog>
  );
}
