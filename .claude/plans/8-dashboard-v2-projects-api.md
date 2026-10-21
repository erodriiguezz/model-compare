---
issue: 8
title: Projects API and AI draft
branch: feat/dashboard-v2-redesign-p8-projects-api
status: shipped
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: M
est_tokens: 280000
est_lines: 300
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: true
---

# #8 Projects API and AI draft

## 1. Approval summary
**What:** CRUD for custom benchmarks ("projects") stored as `benchmarks/custom/<slug>.yaml` and validated by `schema.Benchmark`, plus `POST /api/projects/draft`, where a chosen model drafts cases + a scorer from a description and pasted examples and returns them unsaved.

**Why:** `benchmarks/custom/` is empty because authoring YAML by hand is too slow.

**How:** Slugs are `[a-z0-9-]{1,64}` and resolved paths must stay inside `benchmarks/custom/` (no traversal). Writes are atomic. The draft uses LiteLLM with JSON-schema output (`response_format`) and a schema derived from `Benchmark`, then validates the result. Invalid output returns 422 with the reason. Turned down: storing projects in the DB (the YAML files are already the benchmark source of truth).

**Blast radius**
- Files to touch:
  - `engine/modelcompare/projects.py` — new: CRUD + draft
  - `engine/modelcompare/api.py` — `/api/projects` GET/POST, `/api/projects/{slug}` GET/PUT/DELETE, `/api/projects/draft`, `/api/scorers` (registry names)
  - `engine/tests/test_projects.py` — new
- Also affected: `bench_loader` already loads `custom`, so no change.
- Rollback: revert. Saved YAML files stay valid benchmarks.

**Security:**
- Data in and out: user-provided examples are sent to the chosen model provider for the draft.
- Who can access it: localhost (the M3 Host check applies to these mutating routes too).
- Stored: YAML in `benchmarks/custom/`.
- Abuse: path traversal through the slug → strict regex + resolved-path check. An oversized body → 1 MB limit.

**Acceptance criteria**
- **CRUD** (AC-8.1) — create, read, update and delete a project. The file appears in or disappears from `benchmarks/custom/` and loads through `bench_loader`.
- **Validation** (AC-8.2) — an invalid benchmark (unknown scorer, no cases) gets 422 with the field errors. A slug like `../x` gets 400.
- **Draft** (AC-8.3) — with the mock target, `/api/projects/draft` returns a valid unsaved Benchmark and nothing is written to disk.
- **Scorers** (AC-8.4) — `/api/scorers` lists the registry names.

**How it will be proven:** pytest with a tmp custom dir and the mock target for the draft, plus API smoke.

**Size** M · ~300 lines · ~280k tokens

**PR split** (lead decision during delivery, used only if review fixes take the PR over 400 counted lines; otherwise it ships as one PR on `branch`)
| Part | Branch | Content | Criteria |
| --- | --- | --- | --- |
| 8a | `feat/dashboard-v2-redesign-p8a-crud` | projects CRUD, slug/path guard, validation, custom-dir override, `/api/scorers` | AC-8.1, AC-8.2, AC-8.4 |
| 8b | `feat/dashboard-v2-redesign-p8b-draft` | AI draft endpoint | AC-8.3 |

**Delivery notes**
- `bench_loader` gains `MODELCOMPARE_CUSTOM_DIR` (custom dir override, so tests and QA never write into the repo); default unchanged.
- Security (lead decision): drafts never offer or return a code-running scorer (`code_exec`, `test_quality`; they run Python locally and pasted examples are untrusted). Users can still add them by hand in the editor.

**Out of scope:** the Projects UI (M6b).

**Context:** `architecture.md` — add a `projects.py` module row.

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-8.1–AC-8.4 `engine/tests/test_projects.py`
- API smoke: `GET /api/projects`, `GET /api/scorers`

## 5. Evidence
- QA: passed on `68f53ae` (verify: 893 pytest tests plus web lint and build; API smoke; 73 browser tests; AC-8.1–8.4 covered). Diff coverage: not measured. The PR split wasn't needed.
- AC table: `docs/reviews/8.md`.
- Reviewer: round 1 Request changes (2 High), all fixed. The lead also blocked `test_quality`.
- Lines: 389 counted (320 test lines not counted).

## 6. Retro
- The plan's Security section didn't consider that drafted scorers can run code. Plans that let a model write config should list every config field with side effects.
- Red-first was skipped again in round 1 despite the brief. It only happened when the lead asked for pasted red lines plus mutation proofs. Make "paste the red line" a required report field in every builder brief.
- The `max_tokens`/`response_format` defaults came from one provider's limits. Draft or structured-output features need per-model capability checks.
## 7. Hand-off
