---
version: 0.1.0
last_release: none
updated: 2026-10-05
---

# Architecture

Single Python package, `engine/modelcompare` (Python ≥ 3.11, hatchling, ~2.2k lines). No monorepo tooling. Install: `cd engine && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`. Tests: `cd engine && .venv/bin/pytest` (30 tests, mock targets, no keys).

## Modules
| Module | Responsibility |
| --- | --- |
| `schema.py` | Pydantic models: `TargetConfig`, `Benchmark`, `Case`, `ScorerSpec`, `Completion`, `CaseResult`; benchmark fingerprint |
| `bench_loader.py` | Resolves `standard` / `custom` / `<dimension>` / dir / file into benchmarks |
| `targets/` | `Target` ABC; `LiteLLMTarget` (all real providers, pricing metadata); `MockTarget` |
| `scorers/` | Registry via `@scorer(name)`; `deterministic.py`, `code_exec.py` (subprocess, timeout), `judge.py` (`llm_judge`) |
| `runner.py` | Runs a benchmark: concurrency, cache key (sha256 of request), budget cap, weighted scoring, pre-run cost estimate |
| `stats.py` | Pure-Python paired bootstrap (seeded, 5000 iters), exact McNemar, Wilson CI; `MIN_CASES_FOR_VERDICT = 10`, `EQUIV_MARGIN = 0.03` (TOST-style `equivalent`) |
| `recommend.py` | Per-dimension recommendations, statistical ties, Pareto front, profile rankings |
| `report.py` | Builds the comparison report from the latest runs: headline, regressions, warnings |
| `html_report.py` | Self-contained HTML render (radar chart, side-by-side outputs) |
| `db.py` | SQLModel tables `Run`, `Result`, `CacheEntry` |
| `cli.py` / `api.py` | Typer CLI and FastAPI app; API under `/api` plus root aliases; the dashboard is the Next app |
| `web/` (Next.js) | Static export in `web/out`, served at `/` by FastAPI; build with `npm run build` |

## Data flow
`targets.yaml` + benchmark YAML → `runner.run_benchmark` → target completion (or cache hit) → scorers → `Run`/`Result` rows → `report.build_report` → `stats` + `recommend` → JSON/HTML.

## Storage and config
| Item | Default | Override |
| --- | --- | --- |
| Database | SQLite at `.modelcompare/modelcompare.db` | `MODELCOMPARE_DB_URL` — Postgres is a supported target but has no tests yet |
| Data dir | `.modelcompare/` | `MODELCOMPARE_HOME` |
| Targets file | `targets.yaml` (from `targets.example.yaml`) | `-f` / `MODELCOMPARE_TARGETS` |
| API keys | Environment or `.env` via python-dotenv | — |

Schema is created with `SQLModel.metadata.create_all`; there are no migrations.

## Known gaps
- `code_exec.py` docstring says "docker-compose provides one"; no compose sandbox is planned, so the docstring is stale.
- Postgres path untested; `create_all` without migrations will not evolve a Postgres schema.
- `POST /runs` uses FastAPI `BackgroundTasks` in-process; no job queue, no progress endpoint.
- API has no auth and binds to `127.0.0.1` by default.
- No CI, formatter or linter config in the repo.

## Revision history
| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-10-05 | Seeded by /sdlc-init |
