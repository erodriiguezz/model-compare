---
issue: 7
title: Compare page and suggestions
branch: feat/dashboard-v2-redesign-p7-compare
status: approved
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: L
est_tokens: 350000
est_lines: 400
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: true
---

# #7 Compare page and suggestions

## 1. Approval summary
**What:** An AA-style report: ranked horizontal bars per capability with CI whiskers in provider colors, a verdict matrix (candidate × capability: Better / Worse / Tie / Inconclusive / Incomplete), a quality-vs-cost scatter with the Pareto front, a regression list, and a suggestions panel.

**Why:** It turns the M1 verdicts into decisions.

**How:** The report JSON gains a `suggestions` list built in `summary.py` from `recommend.py` + `stats.mde`: Switch, Stay, Tie → cheaper is X (saves $Y / 1k tasks), "To decide, add N more cases to <benchmark>", Benchmark saturated, Fix errors. Charts use Recharts. Turned down: a radar chart (hard to read with many models).

**Blast radius**
- Files to touch:
  - `engine/modelcompare/summary.py` — `suggestions()`
  - `engine/modelcompare/report.py` — include suggestions and per-capability CI data
  - `engine/tests/test_summary.py` — suggestion cases
  - `web/app/compare/page.tsx` (replace the M2b table), `web/components/{RankedBars,VerdictMatrix,CostScatter,Suggestions,Regressions}.tsx`
- Rollback: revert.

**Security:** None.

**Acceptance criteria**
- **Bars** (AC-7.1) — one ranked bar chart per capability with CI whiskers, sorted by score, colored per provider.
- **Matrix** (AC-7.2) — the verdict matrix shows all five verdict labels from fixture data, with the baseline marked.
- **Pareto** (AC-7.3) — the scatter plots quality vs $/1k tasks with the Pareto front highlighted.
- **Suggestions** (AC-7.4) — for fixture reports: a tie gives "cheaper is X, saves $Y/1k tasks", a wide CI gives "add N cases to <benchmark>", and saturation and errors each produce their own suggestion.
- **States** (AC-7.5) — loading, empty (no runs yet → link to Models), error, and an incomplete-only report.

**How it will be proven:** pytest for suggestions. Headless Playwright on /compare with a seeded QA DB (mock runs covering every verdict). Screenshots at 1280 and 390, UI audit.

**Size** L · ~400 lines · ~350k tokens

**Out of scope:** exporting charts, dark mode.

**Context:** `product.md` — dashboard row — the Compare page shows the verdict matrix + suggestions.

### Screens
- /compare — the report with all panels; incomplete state; empty state

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-7.4 `engine/tests/test_summary.py::test_suggestions_*`
- AC-7.1–AC-7.3, AC-7.5 `.claude/qa/compare.spec.ts`
- QA seed `engine/scripts/seed_qa.py` — mock runs producing every verdict

## 5. Evidence
## 6. Retro
## 7. Hand-off
