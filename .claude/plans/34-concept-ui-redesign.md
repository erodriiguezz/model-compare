---
issue: 34
title: Concept UI redesign — Compare, Projects and Settings
branch: feat/concept-ui-redesign
status: approved
approved_by: Ernesto
approved_at: 2026-10-21
autonomy: pr
source: request
mvp:
size: L
est_tokens: 1500000
est_lines: 2100
shape: milestones
feature_branch: feat/concept-ui-redesign
base: feat/dashboard-v2-redesign
touches_api: false
---

# #34 Concept UI redesign — Compare, Projects and Settings

## 1. Approval summary
**What:** The Next.js dashboard matches the approved concept canvas (https://claude.ai/artifact/CpdRB5qTRLRzp4RxLS1X85). Compare becomes Choose → Run → a decision-first Report in the Artificial Analysis style; History, Projects (list and editor) and Settings are redesigned; Models picks up the new look through shared styles only.

**Why:** The v2 dashboard works but doesn't look finished. The report buries the decision below tables, and screens don't share one visual language. The concept is approved, and doing it now builds on #30 before it merges.

**How:** Restyle the existing pages in place on the current routes. Replace the shared CSS tokens and primitives, then rebuild each view's layout with the same data hooks and API calls. No engine or API changes. Turned down: new routes or the concept's nav, because it would break links and every e2e journey for no user gain.

**Blast radius**
- Touches: every page of the web app (look and layout); the e2e specs' selectors.
- Files to touch:
  - `web/app/globals.css` — new tokens (ink, surfaces, vendor colours, verdict colours), type scale, buttons, cards, chips, fields, tables
  - `web/app/layout.tsx` — JetBrains Mono for ids and code alongside Inter
  - `web/components/Nav.tsx` — new top bar and brand mark; same four items
  - `web/components/SectionTabs.tsx` — Compare › New comparison / History sub-tabs, and the sticky report section tabs
  - `web/components/States.tsx` — loading skeleton, empty and error-with-retry panels per the States board
  - `web/components/ui/BarList.tsx` (new) — horizontal bar chart for pass rate, cost and latency
  - `web/components/ui/VerdictChip.tsx` (new) — one verdict and status chip, replacing `Chip` in `ReportTable.tsx`
  - `web/components/CostScatter.tsx` → `web/components/QualityScatter.tsx` — generic quality-vs-x scatter (cost and latency), keeping the Pareto line
  - `web/components/RunForm.tsx`, `web/components/ModelPicker.tsx` — Choose layout: model cards with key status and baseline, use-case presets from `/profiles`, dimension toggles, sticky "Before you run" estimate
  - `web/components/JobView.tsx` — Run layout: overall progress, by-model progress, benchmark × model grid
  - `web/components/ReportTable.tsx` — Report page assembly and section order
  - `web/components/DecisionPanel.tsx` (new) — recommendation, overall-change chart with CI per candidate, best model per use case, caveats
  - `web/components/KeyMetrics.tsx` (new) — metric × model table with the best value per row highlighted
  - `web/components/CapabilityGrid.tsx` (new, replaces `RankedBars.tsx` and `VerdictMatrix.tsx`) — one card per dimension
  - `web/components/CostSpeed.tsx` (new) — cost per 1k bars, run spend, latency p50/p95 bars, quality vs latency
  - `web/components/Regressions.tsx` — per-candidate tabs; rows expand to baseline vs candidate output with the reason
  - `web/components/Evidence.tsx` (new) — per-benchmark statistics table (moved out of `ReportTable.tsx`)
  - `web/components/Suggestions.tsx` — folded into `DecisionPanel`; deleted if unused
  - `web/components/CaseExplorer.tsx` — restyled only
  - `web/components/HistoryView.tsx` — table with models, outcome chip, spend, status and filter chips
  - `web/components/ProjectsView.tsx` — project cards with an invalid state
  - `web/components/ProjectEditor.tsx`, `web/components/CaseTable.tsx`, `web/components/DraftDialog.tsx`, `web/components/Dialog.tsx` — editor layout: details, scorer cards, case table with inline edit, sticky actions with checks, draft dialog
  - `web/app/settings/page.tsx`, `web/components/KeyRow.tsx` — key rows with status, masked key, inline replace/test/remove, and a "Where keys live" panel
  - `web/lib/report.ts` — types for the report fields the new sections read (overall delta and CI, latency, profiles, flagged outputs)
  - `.claude/qa/*.spec.ts` (existing) — selectors updated to the new markup, journeys unchanged
  - `.claude/qa/concept-ui.spec.ts` (new) — AC-tagged browser checks and screenshots at 1280 and 390
  - `docs/context/decisions/2026-10-21-ui-tokens-restyle.md` (new) — ADR: restyle with our own tokens over a UI kit
- Also affected: `/api/jobs/{id}/report.html` stays as the downloadable report; Models page inherits tokens without layout changes.
- Left alone: engine, API routes and JSON shapes, key storage, project files, the CLI.
- Rollback: revert the feature-branch merge into `feat/dashboard-v2-redesign`; no data or schema changes.

**Concerns:**
- Two concept features have no data and are dropped: the cost split into input and output tokens, and the live feed of individual case results. "Saved by cache" shows the cached share, not dollars.
- "Best by use case" shows the top profile ranking per profile from the report. It doesn't recompute ties.
- Accepted: e2e specs that use class selectors (`.chip`, `.key-mask`) are rewritten to role and label selectors.
- Accepted: light theme only, with every colour a token so dark mode can come later.

**Security:** None. Settings keeps today's behaviour, where only the masked key reaches the page. AC-34.14 re-checks that the full key never appears in the DOM.

**Acceptance criteria**
- **Shell** (AC-34.1) — Every page shows the new top bar with Compare, Models, Projects and Settings, uses the new tokens, and has no horizontal page scroll at 390 px.
- **Choose** (AC-34.2) — Model cards show key status, a model with a missing key can't be picked, and one selected model is marked baseline.
- **Choose deck and estimate** (AC-34.3) — Use-case presets from `/profiles` and dimension toggles with case counts update a sticky estimate (cost, time, calls, cached). Start is disabled with fewer than two models and says why.
- **Run** (AC-34.4) — A running job shows overall percent, calls, spend and time left; progress per model; and a benchmark × model grid with done, running, queued and error states. Cancel still works.
- **Decision** (AC-34.5) — A finished report opens with the recommendation sentence and each candidate's overall change, with its 95% CI, drawn against zero and labelled with its verdict. The best model per use case and the caveats follow.
- **Key metrics** (AC-34.6) — One table lists pass rate, verdict, regressions, consistency, cost per 1k, run cost, p50, p95 and error rate per model, with the best value per row highlighted.
- **Quality** (AC-34.7) — The quality vs cost scatter keeps the Pareto line and its explanation, next to sorted overall pass-rate bars.
- **Capabilities** (AC-34.8) — Each dimension gets a card with a bar per model and a verdict chip per candidate.
- **Cost and speed** (AC-34.9) — Cost per 1k bars, run spend, latency bars (p50 solid, p95 tail) and a quality vs latency scatter render from the report.
- **Regressions** (AC-34.10) — There's a tab per candidate, and each regression expands to the baseline and candidate outputs side by side with the scorer's reason.
- **Evidence** (AC-34.11) — The per-benchmark table shows n, change, CI, p, McNemar p, W/T/L and verdict. The HTML and JSON report links still work.
- **History** (AC-34.12) — History lists comparisons with models, outcome, spend and status. The filter chips work, and a row opens its report.
- **Projects** (AC-34.13) — The list shows project cards, with invalid ones flagged. The editor has details, scorer cards, a case table with inline edit, sticky actions (Run disabled while unsaved), a checks list, delete with confirm, and the AI draft dialog. Saving and running behave as today.
- **Settings** (AC-34.14) — Each provider row shows its status, masked key, and Replace, Test and Remove inline. A key from the environment says so. The full key never appears in the page.
- **States** (AC-34.15) — Every data view has the loading, empty and error-with-retry states from the States board.
- **No regressions** (AC-34.16) — All existing e2e journeys and pytest pass, and the UI audit has 0 serious findings at 1280 and 390 px.

**How it will be proven:** `verify` (pytest + web lint and build). Headless Playwright against the running app with mock targets, for every AC, with screenshots at 1280 and 390. The UI audit. No API changes, so the existing API smoke checks are enough.

**Size** L · ~2,100 lines · ~1.5M tokens · 6 milestone PRs into `feat/concept-ui-redesign`, then one PR into `feat/dashboard-v2-redesign`

**Out of scope:** Models page layout, dark mode, engine or API changes, the input/output cost split, a per-case live feed, new routes.

**Context:** none

---

## 2. Grill
| # | Question | Answer |
| --- | --- | --- |
| 1 | Which branch should this build on? PR #30 is still open. | "Depends on where the code stands." All Projects work is committed and pushed on `feat/dashboard-v2-redesign` (HEAD 3eb8f77, clean, no stashes), so: feature branch off it, final PR into it. |
| 2 | Which navigation? | "Whatever can be wired into the current page." Keep the current routes and nav. Choose, Run and Report live at `/compare/` and `/compare/?job=`, with History a Compare sub-tab. |
| 3 | Models, Projects, Settings? | "Keep and redesign projects and settings." Concept boards were added for Projects list, Project editor and Settings. Models gets tokens only. |
| 4 | Dark mode? | Light only. |

## 3. Design & architecture
### Approach
- **Design source:** the canvas boards Choose, Run, Report (Main), History, States, Projects, Projects › Editor and Settings. Their markup, spacing, colours and copy are the spec. The local copies are at `.claude/design/concept-ui/*.dc.html` (committed with the plan). The builder brief inlines the relevant board each milestone.
- **Tokens first:** `globals.css` gets the concept palette as tokens: ink `#17171A`, canvas `#F6F6F7`, surface, border `#E4E4E8`, muted `#5C5C66`. Vendor colours are anthropic `#D9774F`, openai `#0F8A6A` and google `#3D6FE0`. Verdict pairs are better `#11663D`/`#E3F3EA`, worse `#A1271C`/`#FBE7E5`, neutral and warning. Components use tokens only, so dark mode is a later override.
- **Same data, new layout:** every view keeps its fetch, poll and state machine. Only the render changes. The report reads fields that already exist in `/jobs/{id}/report`:
  - `summary.decisions[].overall_delta_points` and `overall_range_points`, for the overall-change chart;
  - `suggestions`, for the recommendation sentence;
  - `profiles`, for the best model per use case;
  - `summary.markers` (task_success, cost_per_1k_tasks, error_rate, consistency);
  - per-benchmark `summaries` (latency_p50, latency_p95), aggregated per model on the client;
  - `dimensions`, for the capability cards;
  - `flagged` items with outputs, for the regressions;
  - `benchmarks[].comparisons`, for the evidence table.
- **Charts:** horizontal bars are plain CSS (`BarList`). The scatter stays on Recharts, generalised to cost or latency on x. The overall-change chart is CSS, the same as the concept.
- **Selectors:** markup keeps roles and accessible names (`region "Verdict matrix"` becomes `region "Recommendation"`, and so on). Specs move to role and label selectors only.

### Alternatives considered
| Option | Why not |
| --- | --- |
| New routes and the concept's nav (New comparison / Runs / Reports / History) | Breaks links and every e2e journey; the user asked to wire into the current pages |
| Adopt Tailwind or a component kit | New dependency and a full rewrite of 1,800 lines of CSS and markup for the same result; tokens already exist |
| Keep the server-rendered `report.html` in an iframe | That's the old look the concept replaces; it stays only as the download |

### Decisions
- `docs/context/decisions/2026-10-21-ui-tokens-restyle.md`, written in p1: restyle with our own CSS tokens rather than a UI kit.

## 4. Plan
### PR split
| # | Branch | Scope | Est. lines |
| --- | --- | --- | --- |
| 1 | feat/concept-ui-redesign-p1-shell | Tokens, type, primitives (buttons, cards, chips, fields, tables), Nav, SectionTabs, States, VerdictChip, BarList, ADR; History redesign (AC-34.1, AC-34.12, AC-34.15) | 380 |
| 2 | feat/concept-ui-redesign-p2-choose-run | RunForm and ModelPicker as Choose; JobView as Run (AC-34.2, AC-34.3, AC-34.4) | 380 |
| 3 | feat/concept-ui-redesign-p3-report-top | ReportTable assembly, DecisionPanel, KeyMetrics, QualityScatter and pass-rate bars, sticky section tabs (AC-34.5, AC-34.6, AC-34.7) | 380 |
| 4 | feat/concept-ui-redesign-p4-report-rest | CapabilityGrid, CostSpeed, Regressions side by side, Evidence; remove RankedBars, VerdictMatrix, Suggestions (AC-34.8, AC-34.9, AC-34.10, AC-34.11) | 380 |
| 5 | feat/concept-ui-redesign-p5-projects | ProjectsView cards, ProjectEditor, CaseTable, DraftDialog, Dialog (AC-34.13) | 360 |
| 6 | feat/concept-ui-redesign-p6-settings | Settings and KeyRow; full-suite pass, UI audit, screenshots (AC-34.14, AC-34.16) | 220 |

Each milestone updates the existing specs it breaks, so the feature branch stays green.

### Context
none

### Tests to add
- `.claude/qa/concept-ui.spec.ts` [AC-34.1] nav items and active state on every route; no horizontal scroll at 390 px
- [AC-34.2] a missing-key model card is disabled; "Make baseline" moves the baseline marker
- [AC-34.3] a preset changes the toggled dimensions and the estimate; Start is disabled with one model and shows the reason
- [AC-34.4] a mock job shows percent, per-model progress and grid cell states; Cancel ends it
- [AC-34.5] the finished mock report shows the recommendation, an overall-change row per candidate with a verdict, and use-case rows
- [AC-34.6] the key metrics table has 9 rows and exactly one highlighted cell per comparable row
- [AC-34.7, AC-34.9] both scatters render one point per model and a frontier line; bar lists are sorted
- [AC-34.8] the capability card count equals the report's dimension count
- [AC-34.10] expanding a regression shows two outputs and the reason
- [AC-34.11] evidence rows match `benchmarks`; the HTML report link returns 200
- [AC-34.12] the filter chips change the rows; clicking a row opens `/compare/?job=`
- [AC-34.13] an invalid project card shows its error; in the editor Run is disabled until save, the draft dialog opens and closes, and delete asks to confirm
- [AC-34.14] add, test and remove a fake key; only the masked value is in `page.content()`
- [AC-34.15] a mocked API failure shows error-with-retry on Projects, Settings, History and Report
- [AC-34.16] the existing `e2e`, `compare`, `run-flow`, `projects`, `settings`, `models`, `shell` and `judge` specs pass; UI audit at 1280 and 390

### Screens
- /compare/ — Choose
- /compare/?job=qa-every-verdict — Report (seeded by scripts/seed_qa.py; the Run screen is captured by concept-ui.spec.ts with a mocked running job)
- /history/ — History
- /projects/ — Projects list
- /projects/edit/?slug=<slug> and ?new=1 — Project editor (and the draft dialog)
- /settings/ — Settings
- /models/ — tokens only (check for visual breakage)

## 5. Evidence

## 6. Retro

## 7. Hand-off
