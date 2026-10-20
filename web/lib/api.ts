async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const detail = await res.json().then((b) => (typeof b?.detail === "string" ? b.detail : null)).catch(() => null);
    throw new Error(detail ?? `${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const getJSON = <T,>(path: string) => request<T>(path);
export const postJSON = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export type Target = { name: string; model?: string; kind?: string };
export type Benchmark = { name: string; dimension: string; capability: string; cases: number; needs_judge: boolean };
export type Estimate = { usd: number; total_calls: number; cached_calls: number; minutes: number };
export type Live = { target: string; benchmark: string; done: number; total: number; passed: number; errors: number };
export type JobRun = { target: string; benchmark: string; passed: number; n_results: number; n_errors: number; first_error: string | null };
export type Job = {
  id: string; targets: string[]; baseline: string | null; status: string; error: string | null; started_at: string;
  total_calls: number; done_calls: number; run_ids: number[]; runs: JobRun[]; live: Live[];
};
export type RunRow = { id: number; target_name: string; benchmark_name: string; status: string; n_results: number; passed: number; n_errors: number; cost_usd: number };

export const TERMINAL = ["done", "cancelled", "failed", "interrupted"];
export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
export const fmtTime = (s: string) => new Date(/Z|\+/.test(s) ? s : `${s}Z`).toLocaleString();
