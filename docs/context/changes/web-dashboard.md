# web-dashboard

- Issue / PR: #
- Affects: product | architecture | status

## What changes in the shared context
- product.md: Web dashboard surface is "Working — single static page served by `modelcompare serve` at `/` (Setup, Run, Results, Compare)". It replaces the planned Next.js app for now.
- architecture.md: `api.py` adds in-memory jobs (`POST /runs` returns `job_id`; `GET /jobs`, `GET /jobs/{id}` report progress and per-run summaries), `GET /targets/status` (missing provider key names via `litellm.validate_environment`, never values), and per-run counts on `GET /runs` (`db.run_summaries`). The page lives at `modelcompare/web/index.html` (vanilla JS, no build step).
- architecture.md: `bench_loader.resolve_benchmarks` also accepts a benchmark name from `standard/` or `custom/`. `runner.benchmarks_needing_judge` is shared by the CLI and the API.
- architecture.md, Known gaps: replace "no progress endpoint" with "jobs are in memory and lost on restart; a run that was in progress stays `running` in the DB".
- status.md: `targets.yaml` is gitignored as local config.

## Decisions
none
