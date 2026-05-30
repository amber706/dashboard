# Onboarding — Admissions Copilot

Welcome. This guide gets a new developer productive on Cornerstone Healing Center's
admissions/BD/ops reporting dashboard. Open it in Claude Code — it'll help you act on each step.

## Day 1: get access & run it

1. **Get added to the three systems** — GitHub, Vercel, Supabase. See [`docs/ACCESS_SETUP.md`](docs/ACCESS_SETUP.md).
2. **Install Claude Code** and sign in with your own account: https://claude.com/claude-code
3. **Clone & run:**
   ```bash
   git clone https://github.com/amber706/dashboard.git admissions-copilot-frontend
   cd admissions-copilot-frontend
   npm install
   # create .env.local with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (see ACCESS_SETUP.md)
   npm run dev   # http://localhost:5173
   ```
4. **Get an app login** (separate from your Supabase access) — ask Amber for a manager/admin account so you can see the analytics pages.

## Day 1: understand the shape

Read these, in order — they're the fastest path to a working mental model:

1. [`CLAUDE.md`](CLAUDE.md) — stack, architecture map, conventions, commands. (Your Claude Code reads this automatically.)
2. [`src/App.tsx`](src/App.tsx) — **every route and its role/feature gating in one file.** The best map of what the app does.
3. [`docs/METRIC_DEFINITIONS.md`](docs/METRIC_DEFINITIONS.md) — what every metric means (Admit, MQL, VOB, Win, Refer Out…).
4. [`docs/CONFIRMED.md`](docs/CONFIRMED.md) — *why* the metrics are defined the way they are (37 locked decisions).

## The one rule that bites everyone

**Never type a reporting string literal** like `"commercial_cash"` or `"Closed - Admitted"`.
Import it from [`src/lib/metrics/definitions.ts`](src/lib/metrics/definitions.ts). CI (`npm run lint:metrics`)
will fail your build otherwise. That file is the single source of truth for the taxonomy — if a value
there is wrong, every chart is wrong.

## How the data works (the 30-second version)

Zoho CRM + CTM call data → scheduled syncs → Supabase (`fact_*` / `dim_*` tables + `op_*` RPCs,
normalized via the canonical taxonomy) → React pages read RPCs through TanStack Query → dashboards.
It's a Vite SPA (no Next.js/SSR), routed with `wouter`, deployed on Vercel.

## Before you push

```bash
npm run typecheck && npm run test && npm run lint:metrics
```
Then open a PR against `main`. Commit style: lead with the area — `feat(bd): …`, `Reporting: …`, `Op Overview: …`.

## Who to ask

- **Amber Vaughan** (amber@cornerstonehealingcenter.com) — product owner, domain/metric questions.
- `TODO(amber): add dev-team contacts and who owns which area.`
- `TODO(amber): where work is tracked (GitHub issues / ClickUp / Notion / Linear).`

## A good first task

`TODO(amber): pick a small, self-contained starter — e.g. "add a column to an existing analytics
table" or "fix a known data-quality note in docs/OPEN_QUESTIONS.md" — so a new dev can ship a PR on day 1–2.`
