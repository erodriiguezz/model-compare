# ADR: Next.js static export served by FastAPI

- Date: 2026-10-19
- Status: accepted
- Issue / PR: #2

## Context
The vanilla single-page dashboard cannot carry four pages (Compare, Models, Projects, Settings). `modelcompare serve` should stay the only command to run.

## Options
1. **Next.js static export, served by FastAPI** — `web/out` is mounted at `/`. Pros: one process, one URL, no CORS. Cons: needs `npm run build` before serving; no server-side rendering.
2. **Next.js server at runtime** — Pros: SSR, rewrites in production. Cons: two processes to start and supervise. Rejected.
3. **Vite SPA** — Pros: simpler build. Cons: no file-based routing or font handling; the team wants the Next ecosystem. Rejected.

## Decision
Option 1. `next.config.ts` sets `output: 'export'` and `trailingSlash: true` so each page is `<route>/index.html`, which Starlette's `StaticFiles(html=True)` serves; this keeps `/compare` free for the old `POST /compare` API alias. The API moves under `/api`, with the old root paths kept as aliases. If `web/out` is missing, `/` serves the old page.

## Consequences
- The web build is part of verify and QA setup.
- Pages fetch data client-side; `next dev` proxies `/api` to port 8000.
- Dark mode, charts and the page port follow in later milestones.
