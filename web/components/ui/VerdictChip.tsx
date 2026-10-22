import type { ReactNode } from "react";

export type Tone = "better" | "worse" | "neutral" | "warning";
const CLASS: Record<Tone, string> = { better: "ok", worse: "bad", neutral: "muted", warning: "warn" };

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

/** One chip for verdicts (tone + text) and statuses (pass `status`). */
export default function VerdictChip({ tone, status, children }: { tone?: Tone; status?: string; children?: ReactNode }) {
  const info = status ? statusInfo(status) : null;
  const t = tone ?? info?.tone ?? "neutral";
  return <span className={`chip ${CLASS[t]}`} data-tone={t}>{children ?? info?.label}</span>;
}
