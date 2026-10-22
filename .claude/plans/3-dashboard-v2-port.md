---
issue: 3
title: Port run, report and history to Next.js
branch: feat/dashboard-v2-redesign-p3-port
status: shipped
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: M
est_tokens: 300000
est_lines: 380
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: false
---

# #3 Port run, report and history

## 1. Approval summary
**What:** The existing flow (choose targets + benchmarks → estimate → run with progress polling → report → history) works in the Next app, and then `engine/modelcompare/web/index.html` and its fallback are deleted.

**Why:** It reaches parity before new features, so nothing regresses.

**How:** Compare page: a target/benchmark picker, an estimate, `POST /api/runs`, polling `GET /api/jobs/{id}` with a cancel button, and the report from `GET /api/jobs/{id}/report` shown as a table for now (the charts come in M5). A history table from `/api/runs` and `/api/jobs`. Turned down: keeping the old page around (two UIs drift).

**Blast radius**
- Files to touch:
  - `web/app/compare/page.tsx`, `web/app/history/page.tsx` (or a history tab), `web/components/{RunForm,JobProgress,ReportTable}.tsx`, `web/lib/api.ts`
  - `engine/modelcompare/web/index.html` — deleted
  - `engine/modelcompare/api.py` — remove the fallback, keep the aliases
- Rollback: revert.

**Security:** None.

**Acceptance criteria**
- **Run** (AC-3.1) — select two mock targets + one benchmark → estimate shown → Run → progress updates → the report table shows verdicts, including `equivalent`/`incomplete`.
- **Cancel** (AC-3.2) — Cancel on a running job stops it and the status shows cancelled.
- **History** (AC-3.3) — past jobs are listed and opening one shows its report.
- **Old page gone** (AC-3.4) — `index.html` is deleted and `/` serves the Next app.
- **States** (AC-3.5) — loading while polling, empty history, an error when the API fails.

**How it will be proven:** headless Playwright against the running app with `targets.qa.yaml`, screenshots, UI audit.

**Size** M · ~380 lines · ~300k tokens

**PR split** (lead decision during delivery: the port came to ~880 counted lines, so the same scope ships as stacked PRs into the feature branch, each ≤400)
| Part | Branch | Content | Criteria |
| --- | --- | --- | --- |
| 3a | `feat/dashboard-v2-redesign-p3a-compare` | run form, progress, cancel, report table | AC-3.1, AC-3.2, AC-3.5 |
| 3b | `feat/dashboard-v2-redesign-p3b-history` | history page, sub-tabs, nav | AC-3.3, AC-3.5 |
| 3c | `feat/dashboard-v2-redesign-p3c-parity` | remaining old-page features: budget + confirm, repeats/concurrency/cache, key status, judge pick, case explorer, report links | AC-3.1, AC-3.3 |
| 3d | `feat/dashboard-v2-redesign-p3d-cleanup` | delete the old page, 503 without `web/out`, docs | AC-3.4 |

**Out of scope:** charts, the verdict matrix, suggestions (M5).

**Context:** `architecture.md` — `cli.py / api.py` row — the dashboard is the Next app.

### Screens
- /compare — run form, progress, report table
- /history — job list

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-3.1–AC-3.3, AC-3.5 `.claude/qa/run-flow.spec.ts`
- AC-3.4 `engine/tests/test_api.py::test_root_serves_next`

## 5. Evidence
- QA (top of the stack, 3d): passed on `29f0a60`. Verify: 790 pytest tests pass, plus web lint and build. App up on :8765. API smoke passes. Browser: 33 Playwright tests pass. UI audit: 0 serious, 0 minor. AC-3.1–3.5 covered. Diff coverage: not measured. Parts 3a–3c: green except the AC step's later-part criteria.
- AC table and screens: `docs/reviews/3.md`.
- Reviewer: round 1 Request changes (2 High), round 2 Approve. All fixed except the `RunRequest` bounds follow-up.
- Lines: 399 + 127 + 139 + 397 counted across 4 PRs.
- Cost: ~32M tokens (cache-heavy), 1 session, no hand-off.

## 6. Retro
- The plan estimated ~380 lines for "port + delete", but the port alone was ~490 and the deletion 375, so it should have been planned as stacked PRs from the start. A deletion of a large file can blow the size budget on its own.
- The plan said "parity" but didn't list the old page's features. The first build missed seven of them. Plans that port a UI should inventory the features being ported.
- `ac-coverage` can't scope to part of a plan, and the QA harness counted a red bridge test as proof. Propose: (1) let a PR-split row declare its criteria; (2) fail the AC gate when a mapped test is ✖.
## 7. Hand-off
