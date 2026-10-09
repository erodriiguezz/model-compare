---
version: 0.1.0
last_release: none
updated: 2026-10-05
---

# Status

Pre-release, package version 0.1.0. No commits yet; branches `develop` (integration) and `main` (production), `develop` not created yet; tickets in GitHub Issues; remote `github.com/erodriiguezz/model-compare`.

## Standard deck
| Dimension | Status |
| --- | --- |
| reasoning (15), coding (12), instruction_following (13), structured_output (12), tool_calling (13) | v0 — too small for most verdicts; target 50–100 cases each |
| long_context, factuality, calibration, summarization, safety_over_refusal, safety_harmful, robustness, multilingual | Phase 2 |
| agentic multi-step | Phase 3 |
| knowledge | Planned; phase not set |

## Roadmap
| Phase | Scope |
| --- | --- |
| 2 | Remaining dimensions above; Next.js web dashboard on the existing HTTP API |
| 3 | Agentic multi-step benchmarks |

## Open items
- Grow v0 packs to 50–100 cases.
- Postgres tests (and migrations) before Postgres is relied on.
- Fix stale docker-compose reference in the `code_exec.py` docstring.
- No CI, formatter or linter yet.
- `benchmarks/custom/` is empty.

## Revision history
| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-10-05 | Seeded by /sdlc-init |
