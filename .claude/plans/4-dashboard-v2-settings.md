---
issue: 4
title: Settings — provider keys
branch: feat/dashboard-v2-redesign-p4-settings
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

# #4 Settings — provider keys

## 1. Approval summary
**What:** A Settings page to add, replace, test and remove an API key per provider. Keys are written to the engine env file, shown only masked, and applied live.

**Why:** Editing the env file by hand is the main source of friction today.

**How:** `modelcompare/keys.py` reads and writes the keys file at `MODELCOMPARE_KEYS_FILE` (default: the engine env file) through a temp file + `os.replace`, chmod 600, and updates `os.environ`. Only an allowlist of provider variable names (OPENAI, ANTHROPIC, GEMINI, TOGETHERAI, GROQ, OPENROUTER) is accepted. A Host-check dependency rejects anything except `localhost`/`127.0.0.1` on `/api/settings/*`. Turned down: OS keychain, DB storage.

**Blast radius**
- Files to touch:
  - `engine/modelcompare/keys.py` — new
  - `engine/modelcompare/api.py` — `GET /api/settings/keys`, `PUT`/`DELETE /api/settings/keys/{provider}`, `POST /api/settings/keys/{provider}/test`, Host check
  - `engine/tests/test_keys.py` — new; every test uses a tmp keys file
  - `web/app/settings/page.tsx`, `web/components/KeyRow.tsx`
  - `docs/context/decisions/2026-10-19-keys-in-env-file.md` — ADR
- Left alone: the CLI still loads the env file the same way. Other lines in the file are preserved byte for byte.
- Rollback: revert. Keys already written stay valid lines in the file.

**Concerns:** The secret guard blocks any tool access to the real env file. Builders and QA must only use the `MODELCOMPARE_KEYS_FILE` override (tmp path in tests, `.modelcompare-qa/keys.test` in QA) and fake key values.

**Security:**
- Data in and out: the key value comes in on PUT only. Responses return `{provider, set, masked, source}`, never the value.
- Who can access it: localhost only. The Host header is checked (DNS-rebinding defense), no CORS, and the server binds to 127.0.0.1.
- Stored: in the env file, chmod 600, gitignored, until deleted.
- Abuse: a hostile page writing keys or env vars → Host check + variable allowlist + no arbitrary names. Values are never logged (no request-body logging on these routes).

**Acceptance criteria**
- **Add/replace/remove** (AC-4.1) — PUT writes `X_API_KEY=value` to the keys file, a second PUT replaces it, and DELETE removes the line. Other lines are untouched and file mode is 600.
- **Masked only** (AC-4.2) — GET and the UI show `sk-…a1b2`. The full value never appears in any response or in the DOM.
- **Host check** (AC-4.3) — a request with `Host: evil.example` gets 403. An unknown provider gets 404.
- **Live** (AC-4.4) — after PUT, `/api/targets/status` reports that provider's key present with no restart.
- **UI** (AC-4.5) — the Settings page adds, replaces, tests and removes a key, with loading, empty (no keys) and error states.

**How it will be proven:** pytest with a tmp keys file, API smoke, headless Playwright with a fake value against the QA keys file, UI audit.

**Size** M · ~300 lines · ~280k tokens

**PR split** (lead decision during delivery: security-review fixes took it to 443 counted lines, so the same scope ships as two stacked PRs, each ≤400)
| Part | Branch | Content | Criteria |
| --- | --- | --- | --- |
| 4a | `feat/dashboard-v2-redesign-p4a-keys` | `keys.py`, settings API with Host/Origin checks, CLI key loading, ADR | AC-4.1, AC-4.2, AC-4.3, AC-4.4 |
| 4b | `feat/dashboard-v2-redesign-p4b-settings` | Settings page and `KeyRow` | AC-4.2, AC-4.5 |

**Out of scope:** encryption at rest, multiple keys per provider.

**Context:** `architecture.md` — Storage and config — API keys row: "Environment, the env file, or Settings page (writes the env file)".

### Screens
- /settings — provider rows with a masked key, add/replace/test/remove

## 2. Grill
See `mvp-dashboard-v2.md` §2.

## 4. Plan
### Tests to add
- AC-4.1–AC-4.4 `engine/tests/test_keys.py`
- AC-4.3 `.claude/qa/api-smoke.json` (Host header case)
- AC-4.2, AC-4.5 `.claude/qa/settings.spec.ts`

## 5. Evidence
- QA (top of the stack, 4b): passed on `37db984`. Verify: 824 pytest tests pass (network blocked), plus web lint and build. App up on :8765 with an isolated keys file. API smoke passes (foreign Origin, 404). Browser: 41 tests pass. UI audit: 0 serious, 0 minor. AC-4.1–4.5 covered. 4a alone: green except AC-4.5 (owned by 4b).
- AC table and screens: `docs/reviews/4.md`.
- Reviewer: round 1 Request changes (1 High), round 2 Approve with 2 Medium. Follow-up: Host/Origin protection for the rest of `/api`.
- Lines: 286 + 157 counted across 2 PRs.

## 6. Retro
- The plan's ~300-line estimate held for the feature, but the security review added ~50 lines of necessary hardening. Security-sensitive milestones should budget review fixes before cutting PRs.
- The builder wrote tests after the code (the brief asked for tests first). There was no red run, so nothing shows the tests can fail.
- litellm loads a cwd `.env` on import, which nearly put real keys into the QA app and pytest. A global QA rule could set `LITELLM_MODE=PRODUCTION` for Python LLM projects.
## 7. Hand-off
