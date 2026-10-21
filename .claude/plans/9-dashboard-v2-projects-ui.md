---
issue: 9
title: Projects UI and end-to-end journeys
branch: feat/dashboard-v2-redesign-p9-projects-ui
status: approved
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: M
est_tokens: 350000
est_lines: 380
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: false
---

# #9 Projects UI and end-to-end journeys

## 1. Approval summary
**What:** A Projects list + editor (name, system prompt, scorer picker, case table with add/edit/delete and expected values), "Draft with AI" from a description + pasted examples, Save, and "Run on selected models" → Compare. This milestone also owns the MVP's end-to-end journeys.

**Why:** It completes the custom-benchmark journey and proves the whole MVP in one place.

**How:** `/projects` and `/projects/[slug]` (a static export with a client-side fetch; `generateStaticParams` is empty plus a client fallback route `/projects/edit?slug=`). The draft fills the editor unsaved, and leaving with unsaved changes asks for confirmation through an in-page dialog. Turned down: a raw YAML editor (it's what people avoid today).

**Blast radius**
- Files to touch: `web/app/projects/page.tsx`, `web/app/projects/edit/page.tsx`, `web/components/{ProjectEditor,CaseTable,DraftDialog}.tsx`, `web/lib/api.ts`, `.claude/qa/e2e.spec.ts`, `README.md` (dashboard section)
- Rollback: revert.

**Security:** None beyond M6a.

**Acceptance criteria**
- **List** (AC-9.1) — the projects are listed with case count and last run. The empty state shows "Create your first project".
- **Edit + save** (AC-9.2) — create a project, add/edit/delete cases, pick a scorer, save → it shows up in the list, and validation errors are shown inline.
- **Draft** (AC-9.3) — describe + paste examples → Draft (mock model) fills the editor unsaved, and it's editable before saving.
- **Run** (AC-9.4) — "Run on selected models" opens /compare with the project and models preselected, and the run completes.
- **E2E keys journey** (AC-9.5) — Settings → add a fake key → masked → Models shows that provider's models (recorded fixture) → select a mock model → run → Compare shows verdict + suggestions.
- **E2E project journey** (AC-9.6) — Projects → describe + paste examples → Draft (mock model) → edit a case → save → run on two mock models → Compare.
- **E2E states** (AC-9.7) — every page shows loading, empty and error states; light-theme screenshots of every page; UI audit 0 serious.

**How it will be proven:** headless Playwright against the running app (mock targets, catalog fixtures, QA keys file), screenshots at 1280 and 390 for every page, UI audit with 0 serious findings.

**Size** M · ~380 lines · ~350k tokens

**PR split** (lead decision before the build: ~380 lines leaves no room for review fixes; stacked PRs, each ≤400, full AC gate on the top part)
| Part | Branch | Content | Criteria |
| --- | --- | --- | --- |
| 9a | `feat/dashboard-v2-redesign-p9a-editor` | projects list, editor, case table, save, validation | AC-9.1, AC-9.2 |
| 9b | `feat/dashboard-v2-redesign-p9b-draft` | draft dialog, run on selected models, unsaved-changes guard | AC-9.3, AC-9.4 |
| 9c | `feat/dashboard-v2-redesign-p9c-e2e` | end-to-end journeys, all-page states and screenshots, README, context rows | AC-9.5, AC-9.6, AC-9.7 |

**Delivery notes**
- The criteria line for the end-to-end journeys was rewritten from the range "AC-9.5–AC-9.7" into three explicit lines (same wording as the MVP plan) so the AC gate sees all three.
- `status.md`'s three prose lines are converted to table rows when its row is updated, so the context-size check passes.

**Out of scope:** project sharing, import/export.

**Context:** `product.md` — add a Projects row; `status.md` — Dashboard v2 shipped to the feature branch.

### Screens
- /projects — list, empty
- /projects/edit — editor, draft dialog, validation errors
- /settings — keys
- /models — model tree
- /compare — run form
- /compare/?job=qa-every-verdict — report

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-9.1–AC-9.4 `.claude/qa/projects.spec.ts`
- AC-9.5–AC-9.7 `.claude/qa/e2e.spec.ts`

## 5. Evidence
## 6. Retro
## 7. Hand-off
