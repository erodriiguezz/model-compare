import type { ReactNode } from "react";

export type Tone = "better" | "worse" | "neutral" | "warning" | "info";
const CLASS: Record<Tone, string> = { better: "ok", worse: "bad", neutral: "muted", warning: "warn", info: "info" };

/** Run and comparison statuses, as shown to people. Unknown statuses fall back to neutral. */
export const STATUS: Record<string, { label: string; tone: Tone }> = {
  done: { label: "Complete", tone: "better" },
  running: { label: "Running", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  interrupted: { label: "Interrupted", tone: "warning" },
  failed: { label: "Failed", tone: "worse" },
  error: { label: "Failed", tone: "worse" },
};
export const statusInfo = (status: string) => STATUS[status] ?? { label: status, tone: "neutral" as Tone };

/** Overall verdicts against the baseline, as shown to people. */
export const VERDICT: Record<string, { label: string; tone: Tone }> = {
  better: { label: "Better", tone: "better" }, worse: { label: "Worse", tone: "worse" }, mixed: { label: "Mixed", tone: "warning" },
  equivalent: { label: "Tie", tone: "info" }, inconclusive: { label: "Inconclusive", tone: "neutral" },
  insufficient_data: { label: "Inconclusive", tone: "neutral" }, incomplete: { label: "Incomplete", tone: "warning" },
};

/** What a verdict means in a few words, shown muted beside its chip. */
export const VERDICT_NOTE: Record<string, string> = {
  equivalent: "within 3 points", inconclusive: "no measurable difference", insufficient_data: "n<10", incomplete: "fix errors and re-run",
};

/** One chip for verdicts (pass `verdict`, or a `tone` with text) and statuses (pass `status`). */
export default function VerdictChip({ tone, status, verdict, children }: { tone?: Tone; status?: string; verdict?: string; children?: ReactNode }) {
  const info = status ? statusInfo(status) : null;
  const v = verdict ? VERDICT[verdict] : null;
  const t = tone ?? v?.tone ?? info?.tone ?? "neutral";
  return <span className={`chip ${CLASS[t]}`} data-tone={t} data-verdict={verdict}>{children ?? v?.label ?? info?.label ?? verdict}</span>;
}
