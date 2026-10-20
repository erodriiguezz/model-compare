import { useSyncExternalStore } from "react";

export type DimTarget = { quality: number; quality_ci: [number, number]; cost_per_1k_tasks: number; vendor: string };
export type Dimension = { label: string; n_cases: number; targets: Record<string, DimTarget> };
export type Marker = { task_success: number; cost_per_1k_tasks: number };

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

/** Targets not dominated on (quality up, cost down). Equal points do not dominate each other. */
export function paretoFront<T extends { quality: number; cost: number }>(points: T[]): T[] {
  return points
    .filter((p) => !points.some((q) => q.quality >= p.quality && q.cost <= p.cost && (q.quality > p.quality || q.cost < p.cost)))
    .sort((a, b) => a.cost - b.cost);
}
