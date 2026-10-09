# ADR: Adopt the Claude SDLC

- Date: 2026-10-05
- Status: proposed
- Issue / PR: #

## Context
The project is new (no commits yet) and will be built mostly with Claude Code. Shared, versioned project memory is needed before work starts so plans and reviews have stable context.

## Options
1. **Full Claude SDLC now** — hooks, CI workflows, test script, context files. Pros: guardrails from the first PR. Cons: the reference scripts target Node/Postgres and must be rewritten for a Python package.
2. **Context files first, rest later** — seed `docs/context/` only. Pros: cheap, useful immediately. Cons: hooks stay off until `.claude/sdlc.json` exists; no CI.

## Decision
Option 2 for now: `docs/context/` was seeded with `/sdlc-init context`. A full `/sdlc-init` turns on hooks and CI.

## Consequences
- Confirmed for full init: `develop` is the integration branch, `main` is production; tickets in GitHub Issues.
- Deviations from the reference implementation: Python stack (pytest, venv) instead of the Node reference scripts; SQLite for the default tests, plus a Postgres job once Postgres tests exist.
- Until then, `/plan`, `/build` and `/ship` are not gated by project hooks.
