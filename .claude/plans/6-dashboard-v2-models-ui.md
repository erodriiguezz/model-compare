---
issue: 6
title: Models page
branch: feat/dashboard-v2-redesign-p6-models-ui
status: approved
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
touches_api: false
---

# #6 Models page

## 1. Approval summary
**What:** A Models page with provider rows that expand to child model rows (price in/out, context, last-run score) and checkboxes to select models for a run. Providers without a key show "Add key" linking to Settings.

**Why:** It's the main way to pick models now that YAML is optional.

**How:** It reads `/api/models` and `/api/runs` (latest score per target). The selection is kept in URL search params, and "Compare selected" goes to `/compare?targets=…`. Turned down: global client state (doesn't survive a reload).

**Blast radius**
- Files to touch: `web/app/models/page.tsx`, `web/components/{ProviderRow,ModelRow}.tsx`, `web/app/compare/page.tsx` (read `targets` param), `web/lib/api.ts`
- Rollback: revert.

**Security:** None.

**Acceptance criteria**
- **Tree** (AC-6.1) — the providers are listed. Expanding one shows its models with price and context, and a provider with `key_ok:false` shows "Add key" → /settings.
- **Select → run** (AC-6.2) — checking two models and pressing "Compare selected" opens /compare with them preselected, and a run starts with them.
- **Filter** (AC-6.3) — a search box filters models by id across providers.
- **States** (AC-6.4) — loading, empty (no keys at all → link to Settings), error (API down), and a per-provider error row.

**How it will be proven:** headless Playwright against the running app. The QA server serves catalog fixtures through a `MODELCOMPARE_CATALOG_FIXTURES` dir (test-only env) so no live keys are needed. Screenshots at 1280 and 390, UI audit.

**Size** M · ~300 lines · ~250k tokens

**Out of scope:** model detail pages.

**Context:** none

### Screens
- /models — provider tree, collapsed and expanded, no-key row, search

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-6.1–AC-6.4 `.claude/qa/models.spec.ts`

## 5. Evidence
## 6. Retro
## 7. Hand-off
