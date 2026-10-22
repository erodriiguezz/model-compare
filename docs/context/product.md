# Product

| Area | State |
| --- | --- |
| Purpose | Benchmarks LLMs on your own tasks: is B better than A, for what, at what cost? Paired statistics |
| User: the author (now) | A personal tool for model decisions |
| User: engineers | Choosing or swapping a model: a verdict per dimension, a regression list, a cost/latency trade-off |
| User: teams (later, hosted) | Shared runs and reports; needs auth and multi-user storage the code lacks |
| Surface: CLI `modelcompare` | `list`, `run`, `compare`, `runs`, `serve`; working |
| Surface: HTML + JSON report | `compare -o`; working |
| Surface: HTTP API | `serve` (FastAPI); working; backs the web dashboard |
| Surface: web dashboard | Settings, Models, Compare (verdict matrix, suggestions) and History |
| Surface: Projects | Create custom benchmarks (cases, scorers), draft them with AI, run them on chosen models |
| Promise: providers | Any provider through LiteLLM; a `mock` target runs the pipeline with no API keys |
| Promise: verdicts | better / worse / inconclusive / insufficient_data, never a bare average |
| Promise: cost | Estimated and confirmed before a run; `--budget` caps it; responses cached, no re-billing |
| Promise: comparability | Reports refuse to compare runs from different benchmark revisions |
| Promise: recommendations | Per dimension (best quality, value, fastest acceptable, Pareto front) and per decision profile |
| Constraint: code_exec | Process isolation, not a security sandbox; untrusted suites belong in a container |
| Constraint: v0 packs | 12-15 cases are too small for most verdicts; "inconclusive" does not mean "equal" |
| Revision 0.1.0 (2026-10-05) | Seeded by /sdlc-init |
