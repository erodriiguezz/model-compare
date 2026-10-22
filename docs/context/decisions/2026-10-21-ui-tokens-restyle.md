# ADR: Restyle with our own CSS tokens, not a UI kit

- Date: 2026-10-21
- Status: accepted
- Issue / PR: #34

## Context
The dashboard must match the approved concept canvas. `web/app/globals.css` already holds light tokens, and components use only those tokens.

## Options
1. **Tailwind or a component kit** — Pros: ready-made primitives. Cons: a new dependency and a rewrite of about 1,800 lines of CSS and markup for the same result.
2. **Replace the token values and primitives in `globals.css`** — Pros: no new dependency, existing class names keep working, pages move one milestone at a time. Cons: primitives are hand-written.

## Decision
Option 2. The concept palette becomes `:root` custom properties (ink, canvas, vendor colours, verdict pairs). Components use tokens only, so a dark theme later is an override of those variables.

## Consequences
- Light theme only for now.
- Shared pieces live in `components/ui/` (`VerdictChip`, `BarList`) and `components/States.tsx`.
- Pages not yet redesigned keep their class names and pick up the new look from the tokens.
