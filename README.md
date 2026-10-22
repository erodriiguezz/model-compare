# ModelCompare

Benchmark LLMs on **your** tasks and get a statistically grounded answer to "is model B actually better than model A, for what, and at what cost?"

- **Any provider** through [LiteLLM](https://docs.litellm.ai/docs/providers): OpenAI, Anthropic, Gemini, Llama (Together/Groq), OpenRouter, local models, and more.
- **Standard test deck** covering the dimensions that matter for a model decision, plus your own YAML benchmarks.
- **Paired statistics**: a bootstrap CI on per-case deltas plus McNemar. A verdict is *better / worse / inconclusive / insufficient data*, never a raw average.
- **Regression list** that shows, side by side, the cases the incumbent passed and the candidate failed.
- **Recommendations** per dimension (best quality, best value, fastest acceptable, Pareto front) and **decision profiles** (coding assistant, support bot, extraction pipeline, …).

## Quick start

```bash
cd engine
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
cp targets.example.yaml targets.yaml      # edit model ids
```

API keys are read from the environment, or from a `.env` file in the directory you run from. The variable names LiteLLM expects are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `TOGETHERAI_API_KEY`, `GROQ_API_KEY`, and `OPENROUTER_API_KEY`.

```bash
.venv/bin/modelcompare list                                        # show benchmarks
.venv/bin/modelcompare run -t claude-sonnet -t gpt -b standard -j judge --budget 5
.venv/bin/modelcompare compare -t claude-sonnet -t gpt --baseline claude-sonnet -o reports/sonnet-vs-gpt.html
```

`run` prints a cost estimate and asks before spending. Responses are cached, so re-running `compare` or adding a third model does not re-bill the earlier ones. Pass `--no-cache` to measure fresh latency and cost.

## Web dashboard

```bash
(cd web && npm ci && npm run build)            # once, and after changing web/: exports web/out
cd engine && .venv/bin/modelcompare serve      # open http://127.0.0.1:8000
```

The server serves the exported Next.js app from `web/out` at `/`; without it, `/` returns a 503 asking you to run `cd web && npm run build`. The API lives under `/api` (old root paths still work). Set `MODELCOMPARE_WEB_OUT` to serve an export from another directory (the export is read from the checkout, not packaged). To work on the UI with hot reload, run `modelcompare serve` and `cd web && npm run dev`, which proxies `/api` to port 8000.

Run it from `engine/` so it finds `targets.yaml` and `.env`. The dashboard follows the order you work in: **Settings → Models → Compare → History → Projects**.

- **Settings**: add a provider API key. It is saved to the engine env file, shown only masked (`sk-…a1b2`), and applies at once without a restart. Test and Remove sit next to each key.
- **Models**: your configured targets plus, for every provider with a key, its model catalog with context size and price (cached for 10 minutes). Search, tick two or more, and "Compare selected" opens Compare with them preselected. Models without a key show as "no key" with a link to Settings.
- **Compare**, two tabs:
  - **New run**: pick models (one to score it, two or more to compare), choose a baseline and the benchmarks, and set optional repeats, parallel calls, a per-run budget and whether to reuse cached answers. A judge is picked automatically, from a vendor you are not comparing, when a benchmark needs one. The form shows a live cost estimate and asks for an inline confirmation before a paid run. The run shows live progress with a Cancel button, then the report: a verdict matrix per capability, ranked charts, a cost scatter, **Suggestions** (what to do next: switch, stay, add cases, fix errors) and, under Details, per-benchmark tables and a case explorer with each case's output, score and the scorer's reason. "Open report" and "JSON" give the full HTML and JSON reports.
  - **History**: past comparisons and runs. Opening one shows its report; interrupted ones open with whatever finished.
- **Projects**: your own benchmarks, saved as YAML in `engine/benchmarks/custom/` (override with `MODELCOMPARE_CUSTOM_DIR`).
  - The list shows each project's dimension, case count and last run; a file that does not parse is listed with its error.
  - The editor takes a name, description, dimension, system prompt, scorers (with optional JSON parameters) and a pass threshold, plus a compact case table (id, input and expected previews, scorer; Edit opens one case at a time). Scorers that run code (`code_exec`, `test_quality`) carry a warning when picked. Problems the API finds appear next to the field or case that caused them.
  - **Draft with AI** asks a model you choose to write cases and scorers from a description and pasted examples (`input => expected`, one per line). The draft lands in the editor **unsaved**, with its cost shown; nothing is written until you press Save. Drafts never use the code-running scorers (`code_exec`, `test_quality`); add those by hand if you want them.
  - Leaving the editor with unsaved changes asks first, in the page: for the nav links, the back link and the browser Back button. Closing the tab uses the browser's own prompt.
  - **Run on selected models** opens Compare with the project and the models you ticked already selected.

The JSON API it uses is documented at http://127.0.0.1:8000/docs.

## Writing a benchmark

```yaml
# engine/benchmarks/custom/support_triage.yaml
name: support-triage
version: "1"
dimension: structured_output      # rolls up into the scorecard and profiles
system_prompt: Return only JSON.
scorers:
  - type: json_schema
repeats: 3                        # >1 also measures consistency
cases:
  - id: t1
    input: "Customer says: charged twice for order 991, wants refund"
    expected: {category: billing, refund_requested: true}
```

Built-in scorers are `exact`, `contains`, `regex`, `numeric`, `choice`, `json_schema` (schema + per-field match), `tool_call` (name + args, with abstention), `instructions` (IFEval-style checks), `code_exec` (unit tests in a subprocess), `refusal`, and `llm_judge` (rubric, needs `--judge`). Several scorers per case are combined by `weight`.

Editing a benchmark changes its fingerprint, and the report refuses to compare runs across different revisions.

## Standard deck status

| Dimension | Status |
|---|---|
| reasoning, coding, instruction_following, structured_output, tool_calling | v0, 12–15 original cases each |
| long_context, factuality, calibration, summarization, safety (over-refusal / harmful), robustness, multilingual | Phase 2 |
| agentic multi-step | Phase 3 |

⚠️ **v0 packs are too small for most verdicts.** With about 12 cases, only very large gaps reach significance. Grow each pack to 50–100 cases (or use `repeats`) before trusting "inconclusive" as meaning "equal".

## Layout

```
engine/modelcompare/   schema, targets/, scorers/, runner, stats, recommend, report, html_report, cli, api, db
engine/benchmarks/  standard/<dimension>/*.yaml, standard/profiles.yaml, custom/
engine/tests/       unit + end-to-end tests with mock targets (no API keys needed)
```

`code_exec` runs model-written code in a subprocess on your machine. That isolates the evaluator process but is **not** a security sandbox, so run untrusted suites in a container.
