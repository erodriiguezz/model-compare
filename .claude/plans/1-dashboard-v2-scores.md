---
issue: 1
title: Trustworthy scores
branch: feat/dashboard-v2-redesign-p1-scores
status: shipped
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: M
est_tokens: 250000
est_lines: 300
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: true
---

# #1 Trustworthy scores

## 1. Approval summary
**What:** Errored results stop counting as failures. New verdicts `incomplete` (>10% errors on either side) and `equivalent` (tie inside a ±3 pt margin). Benchmarks where every model scores ≥0.95 get a saturation flag.

**Why:** The local DB shows 130 temperature-unsupported errors and 70 credit-exhausted errors scored as 0. Ceiling-effect benchmarks and small packs then produce "No measurable difference". Fix the data before redesigning the UI.

**How:** `drop_params=True` in LiteLLM, plus a retry without temperature on `UnsupportedParamsError`. Errors are filtered before pairing. TOST-style equivalence: 90% CI fully inside ±`EQUIV_MARGIN` (0.03). Turned down: imputing errors as 0.5 (it hides the cause).

**Blast radius**
- Touches: scoring and verdict semantics for every report, including historical ones.
- Files to touch:
  - `engine/modelcompare/targets/litellm_target.py` — drop_params, temperature retry, record the fallback
  - `engine/modelcompare/stats.py` — `EQUIV_MARGIN`, equivalence test, `equivalent` verdict
  - `engine/modelcompare/report.py` — exclude errors, error counts + reasons, `incomplete`, saturation flag
  - `engine/modelcompare/summary.py` — plain-language lines for the new verdicts
  - `engine/targets.qa.yaml` — new: mock-only targets for QA
  - `engine/tests/test_stats.py`, `test_summary.py`, `test_end_to_end.py` — new cases
- Also affected: `html_report.py` and `web/index.html` render verdict strings. Unknown verdicts must still render.
- Left alone: DB schema, the runner cache, the CLI flags.
- Rollback: revert the PR. No data migration.

**Concerns:** Old runs re-render with different numbers (intended).

**Security:** None.

**Acceptance criteria**
- **Errors excluded** (AC-1.1) — a result with `error` set is not counted in the score or in pairing. The report shows an error count + reason.
- **Incomplete** (AC-1.2) — a comparison where either side has >10% errors has verdict `incomplete` with text "Fix errors and re-run".
- **Tie** (AC-1.3) — paired deltas with a 90% CI inside ±0.03 give `equivalent`; a wide CI stays `inconclusive`.
- **Saturation** (AC-1.4) — a benchmark where all compared targets score ≥0.95 is flagged "Too easy to separate these models".
- **Temperature fallback** (AC-1.5) — a target that rejects temperature is retried without it and the run records the fallback.

**How it will be proven:** unit tests (stats, summary, litellm target with a mocked litellm), an end-to-end test with mock errors, and API smoke on `POST /compare` against the running app.

**Size** M · ~300 lines · ~250k tokens · milestone PR

**Out of scope:** UI changes beyond rendering the new verdict strings in the existing page.

**Context:** `domain.md` — verdicts row — add `equivalent`, `incomplete`. `architecture.md` — `stats.py` row — mention `EQUIV_MARGIN`.

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 3. Design & architecture
### Approach
Filter `Result.error is not None` before building paired vectors. Track `n_errors` and the top error reasons per target × benchmark. Verdict order: insufficient data → incomplete → better/worse (CI excludes 0 and McNemar significant, as today) → equivalent → inconclusive.

### Contract
| Method | Path | Change | Breaking? |
| --- | --- | --- | --- |
| POST | /compare | adds `errors`, `saturated`, and the verdicts `equivalent`/`incomplete` | No (additive) |

## 4. Plan
### Tests to add
- AC-1.1, AC-1.2 `test_end_to_end.py::test_errors_excluded_and_incomplete`
- AC-1.3 `test_stats.py::test_equivalence_tight_ci`, `::test_wide_ci_inconclusive`
- AC-1.4 `test_end_to_end.py::test_saturation_flag`
- AC-1.5 `tests/test_litellm_target.py::test_temperature_fallback`
- API smoke `.claude/qa/api-smoke.json`: `POST /compare` returns 200 with `verdict` fields

## 5. Evidence
- QA: passed on `5a341b1`. Verify: 785 pytest tests pass. App up on :8765 with mock targets. API smoke: 3/3 pass. Browser: n/a (backend only). AC coverage: AC-1.1–1.5 all covered. Diff coverage: not measured (no `coverage.command`).
- AC table: see `docs/reviews/1.md`.
- Reviewer: Request changes (1 High, 3 Medium, 3 Low). All fixed in `9c89232`; re-verified green.
- Lines: 214 counted (+187/−27), 255 test/generated lines not counted.
- Cost: ~4.5M tokens (cache-heavy), 65 tool calls, 3 red verify runs, 1 session, no hand-off.

## 6. Retro
- The plan's file list missed `runner.py`, `schema.py` and `mock.py`, all of which AC-1.5 ("the run records the fallback") needed. Plans should trace each AC to where the data is persisted.
- The global `pr-size-ignore` doesn't match Python's `test_*.py` convention, so the first count (411) read as over the limit. Proposal: add `**/test_*.py` and `**/tests/**` to the global default.
- `api-smoke.mjs` has no poll/retry support, so a smoke check can't wait on an async job. Seeding through `app.setup` worked around it.

## 7. Hand-off
