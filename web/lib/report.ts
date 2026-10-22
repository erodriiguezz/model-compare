import { useSyncExternalStore } from "react";

export type DimTarget = { quality: number | null; quality_ci: [number | null, number | null]; vendor: string; incomplete: boolean };
export type Dimension = { label: string; n_cases: number; targets: Record<string, DimTarget> };
export type Marker = {
  task_success: number | null; cost_per_1k_tasks: number | null; incomplete: boolean;
  latency_p50?: number | null; error_rate?: number | null; consistency?: number | null; regressions?: number | null;
};

/** Provider colour tokens, keyed by the vendor prefix of the model id. */
const PROVIDER_TOKEN: Record<string, string> = { openai: "openai", anthropic: "anthropic", google: "google", gemini: "google", vertex_ai: "google" };
export const providerOf = (vendor: string) => PROVIDER_TOKEN[vendor] ?? "other";

export type ChartColors = { provider: (vendor: string) => string; text: string; muted: string; border: string; accent: string; surface: string };

let resolved: ChartColors | null = null;
function readColors(): ChartColors {
  if (!resolved) {
    const css = getComputedStyle(document.documentElement);
    const get = (name: string) => css.getPropertyValue(name).trim();
    resolved = {
      provider: (vendor) => get(`--provider-${providerOf(vendor)}`),
      text: get("--text"), muted: get("--text-muted"), border: get("--border"), accent: get("--accent"), surface: get("--surface"),
    };
  }
  return resolved;
}
const noSubscription = () => () => {};

/** Recharts cannot read CSS variables, so resolve the design tokens once on the client (null while prerendering). */
export const useChartColors = (): ChartColors | null => useSyncExternalStore(noSubscription, readColors, () => null);

/** Complete targets not dominated on (quality up, x down: cost or latency), on raw values. Incomplete ones neither join nor dominate. */
export function paretoFront<T extends { quality: number; x: number; incomplete?: boolean }>(points: T[]): T[] {
  const ok = points.filter((p) => !p.incomplete);
  return ok
    .filter((p) => !ok.some((q) => q.quality >= p.quality && q.x <= p.x && (q.quality > p.quality || q.x < p.x)))
    .sort((a, b) => a.x - b.x);
}

export type Suggestion = { kind: string; text: string; target?: string; benchmark?: string; data: Record<string, unknown> };
export type CapabilityVerdict = { dimension: string; label: string; verdict: string; delta_points: number | null };
export type Decision = {
  candidate: string; line: string; capabilities: CapabilityVerdict[];
  overall_verdict: string; overall_verdict_text: string; overall_delta_points: number | null; overall_range_points: [number, number] | null;
};
export type Profile = { profile: string; description: string; ranking: { target: string; score: number }[]; coverage: number };
export type CaseSide = { score: number; pass_rate: number; text: string; reasons: string[] };
export type FlaggedItem = {
  kind: string; tag: string; benchmark: string; dimension: string; case_id: string; delta: number;
  baseline: CaseSide; candidate: CaseSide;
};
export type Summary = { mean_score: number; pass_rate: number; n_errors: number; n_calls: number; latency_p50?: number | null; latency_p95?: number | null };
export type Comparison = {
  candidate: string; verdict: string; delta: number | null; ci: [number | null, number | null]; n: number;
  p_value: number | null; mcnemar_p: number | null; wins: number; ties: number; losses: number;
};
export type Bench = {
  name: string; dimension: string; fingerprint: string; summaries: Record<string, Summary>; comparisons: Comparison[];
  saturated: boolean; saturation_message: string | null;
};
