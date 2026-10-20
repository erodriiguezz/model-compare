---
issue: 5
title: Model catalog API
branch: feat/dashboard-v2-redesign-p5-catalog
status: shipped
approved_by: Ernesto
approved_at: 2026-10-19
autonomy: pr
source: mvp
mvp: mvp-dashboard-v2
size: M
est_tokens: 280000
est_lines: 350
shape: milestones
feature_branch: feat/dashboard-v2-redesign
base: feat/dashboard-v2-redesign
touches_api: true
---

# #5 Model catalog API

## 1. Approval summary
**What:** `GET /api/models` lists every chat model each configured key can access, grouped by provider and enriched with LiteLLM pricing/context. Any listed model can be run without editing `targets.yaml`.

**Why:** Typing model ids into YAML is error-prone and goes stale.

**How:** `modelcompare/catalog.py` has one small fetcher per provider (OpenAI, Anthropic, Gemini, Together, Groq, OpenRouter) over httpx, a chat-only filter, `litellm.model_cost` enrichment, and a 10-minute in-process TTL cache (`?refresh=1` bypasses it). `schema.load_targets` + a resolver: `targets.yaml` names win, otherwise a model id from the catalog becomes a synthesized `TargetConfig(name=id, model="<provider>/<id>", temperature=None)`. Turned down: a static model list (goes stale).

**Blast radius**
- Files to touch:
  - `engine/modelcompare/catalog.py` — new
  - `engine/modelcompare/api.py` — `GET /api/models`; `POST /api/runs` accepts catalog ids
  - `engine/modelcompare/schema.py` — target resolver
  - `engine/tests/test_catalog.py` + `engine/tests/fixtures/catalog/*.json` — recorded responses
- Also affected: `POST /api/runs/estimate` resolves the same way.
- Rollback: revert.

**Concerns:** Provider APIs change. A failing provider returns `{key_ok:false, error}` for its row and never a 500.

**Security:**
- Data in and out: keys are sent only to their own provider's list endpoint over https.
- Who can access it: localhost.
- Stored: model lists in memory only.
- Abuse: none new.

**Acceptance criteria**
- **List** (AC-5.1) — with fixture responses, `/api/models` returns providers with `key_ok`, and models with id, price in/out and context where known. Embedding/image/audio models are filtered out.
- **No key / failure** (AC-5.2) — a provider without a key gives `key_ok:false, reason:"no key"`. An HTTP error gives `key_ok:false` with the error and other providers are unaffected.
- **Cache** (AC-5.3) — a second call within 10 min makes no HTTP request, and `refresh=1` does.
- **Runnable** (AC-5.4) — `POST /api/runs` with a catalog id not in `targets.yaml` starts a run. A `targets.yaml` name takes precedence.

**How it will be proven:** pytest with recorded fixtures and mocked httpx (no live keys), plus API smoke.

**Size** M · ~350 lines · ~280k tokens

**Out of scope:** the Models UI (M4b).

**Context:** `architecture.md` — add a `catalog.py` module row.

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-5.1–AC-5.3 `engine/tests/test_catalog.py`
- AC-5.4 `engine/tests/test_api.py::test_run_catalog_target`
- API smoke `GET /api/models` 200

## 5. Evidence
- QA: passed on `0d24cc5`. Verify: 849 pytest tests pass (network blocked), plus web lint and build. App up. API smoke passes (`GET /api/models` 200). Browser: 41 tests pass. AC-5.1–5.4 covered. Diff coverage: not measured.
- AC table: `docs/reviews/5.md`.
- Reviewer: round 1 Request changes (7 Medium), all fixed. The lead also fixed the missing-`targets.yaml` 404.
- Lines: 268 counted (277 test/fixture lines not counted).

## 6. Retro
- The plan's "runnable without YAML" missed that the API 404s when `targets.yaml` is absent. The ACs should have included "no targets file".
- The builder's first pass added bare-id resolution, which wasn't in the plan and broke report names. Briefs should say "only the id forms the plan lists".
- Red-first was enforced in round 1 by asking for the red line. Briefs should ask for it from the start.
## 7. Hand-off
