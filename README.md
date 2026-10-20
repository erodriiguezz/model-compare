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

Run it from `engine/` so it finds `targets.yaml` and `.env`. The page has four steps:

1. **Setup** lists your targets and shows whether each provider's API key is set.
2. **Run** lets you pick targets, benchmarks, an optional judge and budget, then shows a cost estimate and live progress.
3. **Results** shows every case of a run: the model output, its score and the scorer's reason.
4. **Compare** renders the comparison report for the targets and baseline you choose.

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
