---
version: 0.1.0
last_release: none
updated: 2026-10-05
---

# Product

ModelCompare benchmarks LLMs on the user's own tasks and answers "is model B actually better than model A, for what, and at what cost?" with paired statistics instead of raw averages.

## Users
| Who | Need |
| --- | --- |
| The author (now) | A personal tool for model decisions |
| Engineers choosing or swapping a model for a product feature | A defensible verdict per dimension, a regression list, and a cost/latency trade-off |
| Teams (later, hosted) | Shared runs and reports; implies auth and multi-user storage the code doesn't have yet |

## Surfaces
| Surface | State |
| --- | --- |
| CLI `modelcompare` (`list`, `run`, `compare`, `runs`, `serve`) | Working |
| HTML + JSON report (`compare -o`) | Working |
| HTTP API (`serve`, FastAPI) | Working; written to back the web dashboard |
| Web dashboard | The Compare page shows the verdict matrix + suggestions |

## Core promises
- Any provider through LiteLLM; a `mock` target runs the pipeline with no API keys.
- A verdict is `better` / `worse` / `inconclusive` / `insufficient_data`, never a bare average.
- Cost is estimated and confirmed before a run spends money; `--budget` caps a run; responses are cached so re-runs don't re-bill.
- Reports refuse to compare runs from different benchmark revisions.
- Recommendations per dimension (best quality, best value, fastest acceptable, Pareto front) and per decision profile.

## Out of scope / constraints
- `code_exec` is process isolation, not a security sandbox; untrusted suites belong in a container.
- v0 standard packs (12–15 cases) are too small for most verdicts; "inconclusive" does not mean "equal".

## Revision history
| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-10-05 | Seeded by /sdlc-init |
