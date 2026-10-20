import { useSyncExternalStore } from "react";

export type DimTarget = { quality: number; quality_ci: [number, number]; vendor: string; incomplete: boolean };
export type Dimension = { label: string; n_cases: number; targets: Record<string, DimTarget> };
export type Marker = { task_success: number; cost_per_1k_tasks: number; incomplete: boolean };

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

/** Complete targets not dominated on (quality up, cost down), on raw values. Incomplete ones neither join nor dominate. */
export function paretoFront<T extends { quality: number; cost: number; incomplete?: boolean }>(points: T[]): T[] {
  const ok = points.filter((p) => !p.incomplete);
  return ok
    .filter((p) => !ok.some((q) => q.quality >= p.quality && q.cost <= p.cost && (q.quality > p.quality || q.cost < p.cost)))
    .sort((a, b) => a.cost - b.cost);
}

export type Suggestion = { kind: string; text: string; target?: string; benchmark?: string; data: Record<string, unknown> };
export type CapabilityVerdict = { dimension: string; label: string; verdict: string; delta_points: number };
export type Decision = { candidate: string; line: string; capabilities: CapabilityVerdict[] };
export type FlaggedItem = {
  kind: string; tag: string; benchmark: string; dimension: string; case_id: string; delta: number;
  baseline: { score: number }; candidate: { score: number };
};
