---
issue: 2
title: Next.js shell and design system
branch: feat/dashboard-v2-redesign-p2-shell
status: approved
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: M
est_tokens: 300000
est_lines: 350
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: true
---

# #2 Next.js shell and design system

## 1. Approval summary
**What:** A `web/` Next.js app (App Router, TS, Recharts) with a static export. FastAPI serves `web/out` at `/` and the API moves under `/api` (old paths kept as aliases). Light design tokens, Inter, a top nav (Compare · Models · Projects · Settings) and shared Loading/Empty/Error components.

**Why:** The vanilla 375-line page can't carry four pages. One server keeps `modelcompare serve` the only command.

**How:** `output: 'export'`. FastAPI mounts `StaticFiles(web/out, html=True)` when it exists and otherwise falls back to the old page. Routes go on an `APIRouter` included at `/api` and at `/`. Turned down: a Next server at runtime (two processes).

**Blast radius**
- Files to touch:
  - `web/**` — new app: `package.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/{compare,models,projects,settings}/page.tsx` placeholders, `components/{Nav,States}.tsx`, `lib/api.ts`
  - `engine/modelcompare/api.py` — APIRouter under `/api` plus aliases; static mount with fallback
  - `engine/tests/test_api.py` — `/api/*` and alias tests
  - `.claude/project.json` — verify adds web lint+build; app.start builds web first
  - `README.md` — `npm run build` step
  - `docs/context/decisions/2026-10-19-nextjs-static-export.md` — ADR
- Left alone: engine logic.
- Rollback: revert. The fallback keeps the old page working if `web/out` is missing.

**Security:** None (same localhost bind, no CORS added).

**Acceptance criteria**
- **One URL** (AC-2.1) — `modelcompare serve` serves the Next app at `/` and `GET /api/targets` returns the same JSON as `GET /targets`.
- **Shell** (AC-2.2) — every page shows the top nav with the active item highlighted, light tokens on `:root`, and a 16px gutter at 390px width with no horizontal scroll.
- **States** (AC-2.3) — the placeholder pages render the shared Loading, Empty and Error components (Error when the API is down).
- **Fallback** (AC-2.4) — with no `web/out`, `/` serves the old page.

**How it will be proven:** pytest, `npm run lint && npm run build`, headless Playwright on each route at 1280 and 390, screenshots, UI audit.

**Size** M · ~350 lines (excluding lockfile) · ~300k tokens

**Out of scope:** porting the run/report flow (M2b), dark mode.

**Context:** `architecture.md` — add a `web/` row; Known gaps — remove nothing.

### Screens
- / — shell and states
- /compare — shell and states
- /models — shell and states
- /projects — shell and states
- /settings — shell and states

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 3. Design & architecture
Design source: artificialanalysis.ai as inspiration only (no assets). Off-white canvas `#f7f7f5`-ish, white cards, 1px hairline borders, dense tables, Inter, one accent plus per-provider colors defined as tokens. Development: `next dev` rewrites `/api/*` to `http://127.0.0.1:8000`.

## 4. Plan
### Tests to add
- AC-2.1, AC-2.4 `engine/tests/test_api.py::test_api_prefix_and_alias`, `::test_static_fallback`
- AC-2.2, AC-2.3 `.claude/qa/shell.spec.ts`

## 5. Evidence
## 6. Retro
## 7. Hand-off
