export type FieldError = { loc: string[]; msg: string };
export type ApiError = Error & { status: number; fields?: FieldError[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail).catch(() => null);
    const fields: FieldError[] | undefined = Array.isArray(detail) ? detail : undefined;
    throw Object.assign(new Error(typeof detail === "string" ? detail : fields?.[0]?.msg ?? `${path} returned ${res.status}`), { status: res.status, fields });
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const getJSON = <T,>(path: string) => request<T>(path);
export const postJSON = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export type Target = { name: string; model?: string; kind?: string; keys_ok?: boolean; missing_keys?: string[] };
export type Benchmark = { name: string; dimension: string; capability: string; cases: number; needs_judge: boolean };
export type Estimate = { usd: number; total_calls: number; cached_calls: number; minutes: number; unpriced?: string[] };
export type Live = { target: string; benchmark: string; done: number; total: number; passed: number; errors: number };
export type JobRun = { run_id: number; dimension?: string; status: string; cost_usd: number; target: string; benchmark: string; passed: number; n_results: number; n_errors: number; first_error: string | null };
export type Job = {
  id: string; targets: string[]; baseline: string | null; status: string; error: string | null; started_at: string; benchmarks: string[];
  total_calls: number; done_calls: number; run_ids: number[]; runs: JobRun[]; live: Live[];
};

export const TERMINAL = ["done", "cancelled", "failed", "interrupted"];
export const vendor = (model = "") => (model.includes("/") ? model.split("/")[0] : model.split("-")[0]);
export const usd = (v: number) => `$${v.toFixed(v >= 10 ? 0 : v >= 1 ? 2 : 3)}`;
export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
export type RunRow = { id: number; started_at?: string; target_name: string; benchmark_name: string; status: string; n_results: number; passed: number; n_errors: number; cost_usd: number };
export const fmtTime = (s: string) => new Date(/Z|\+/.test(s) ? s : `${s}Z`).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

export type KeyStatus = { provider: string; var: string; set: boolean; masked: string | null; source: "file" | "environment" | null };
const send = <T,>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
export const putJSON = <T,>(path: string, body: unknown) => send<T>("PUT", path, body);
export const deleteJSON = <T,>(path: string) => send<T>("DELETE", path);

export type CatalogModel = { id: string; target: string; name?: string | null; context?: number | null; price_in?: number | null; price_out?: number | null };
export type CatalogProvider = { provider: string; var: string; key_ok: boolean; reason?: string; error?: string; models: CatalogModel[] };
export type Catalog = { providers: CatalogProvider[]; cached_at: string };
export const ctxLabel = (n?: number | null) => (!n ? "—" : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
export const priceLabel = (v?: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);

export type ScorerSpec = { type: string; weight?: number; params?: Record<string, unknown> };
export type ProjectCase = { id: string; input: string; expected?: unknown; scorers?: ScorerSpec[] | null; tags?: string[] };
export type Project = {
  name: string; dimension: string; description?: string; system_prompt?: string | null; pass_threshold?: number;
  scorers: ScorerSpec[]; cases: ProjectCase[];
}; // fields the editor has no control for (version, tools, documents, repeats…) ride along untouched
export type ProjectRow = { slug: string; name: string; dimension: string | null; n_cases: number; valid: boolean; error: string | null };
export type ScorerInfo = { name: string; description: string };
export const DIMENSIONS = ["reasoning", "knowledge", "coding", "instruction_following", "structured_output", "tool_calling", "long_context", "factuality", "calibration", "summarization", "safety_over_refusal", "safety_harmful", "robustness", "multilingual", "software_delivery", "agentic", "custom"];
