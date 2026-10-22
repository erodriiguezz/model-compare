---
version: 0.1.0
last_release: none
updated: 2026-10-05
---

# Domain

## Terms
| Term | Meaning |
| --- | --- |
| Target | A model under test: name, LiteLLM model string, params, optional pricing. `kind` is `litellm` or `mock` |
| Judge | A target used only by `llm_judge` scorers; should be from a different vendor than the targets compared |
| Benchmark | A YAML pack of cases with a dimension, scorers, optional tools, `repeats`, `pass_threshold` |
| Case | One input with `expected` and `vars`; may override the benchmark's scorers |
| Dimension | The capability a benchmark measures (`reasoning`, `coding`, `tool_calling`, … `agentic`, `custom`) |
| Fingerprint | First 12 hex chars of a SHA-256 over the benchmark's content; any edit changes it |
| Run | One target × one benchmark execution. Status `running` / `done` / `budget_exceeded` / `failed` |
| Result | One case × one repeat: score 0–1, passed, tokens, latency, cost, error, cached |
| Baseline / incumbent | The model a candidate is compared against (defaults to the first `--target`) |
| Verdict | Candidate vs baseline: `better` (CI > 0), `worse` (CI < 0), `equivalent` (90% CI inside ±3 pts), `inconclusive`, `insufficient_data` (< 10 paired cases), `incomplete` (> 10% errors on a side) |
| Regression | A case the baseline passed and the candidate failed |
| Statistical tie | Targets not significantly different from the quality leader; the cheapest tie is recommended |
| Decision profile | Weights over dimensions (`profiles.yaml`); unmeasured dimensions are reported as missing coverage |
| Contamination risk | Flag on benchmarks built from public datasets; reports warn that scores may be inflated |

## Scorers
| Scorer | Checks |
| --- | --- |
| `exact`, `contains`, `regex`, `numeric`, `choice` | Answer text |
| `json_schema` | Schema validity plus per-field match |
| `tool_call` | Function name and args, including correct abstention |
| `instructions` | IFEval-style constraint checks |
| `code_exec` | Model code against unit tests in a subprocess |
| `refusal` | Whether the model refused |
| `llm_judge` | Rubric score 1–10, normalised to 0–1; needs `--judge` |

Several scorers per case combine by `weight`.

## Rules
- Repeats are averaged per case first; only case ids present in both runs are compared (paired).
- Runs with different fingerprints for the same benchmark are not compared.
- A judge sharing a vendor with a target triggers a self-preference warning.

## Revision history
| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-10-05 | Seeded by /sdlc-init |
