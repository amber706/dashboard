# CLAUDE.md — Admissions Copilot

Shared project brain. Every teammate's Claude Code reads this file automatically on startup.
Keep it accurate: when a convention changes, update this file in the same PR.

> Domain context that only the Cornerstone team knows is marked **`TODO(amber)`**.
> Fill those in — they're the parts a new dev (or a fresh Claude) can't infer from code.

---

## What this is

A reporting + workflow dashboard for **Cornerstone Healing Center's** admissions, business
development (BD), and call-center operations. It reads CRM and call data (synced from Zoho CRM
and CTM) into Supabase, normalizes it into a canonical reporting taxonomy, and renders executive
/ ops / BD dashboards plus an admissions-rep workflow ("copilot").

- **Primary user:** Amber Vaughan, CMO. Managers and admins use the analytics; specialists use the call workflow.
- **Not a public app.** Auth-gated; every page is role- and feature-flag-gated.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript (strict), Vite 6, **no Next.js / no SSR** |
| Routing | `wouter` (client-side; routes declared in `src/App.tsx`) |
| UI | shadcn/ui (new-york style) + Radix + Tailwind v4 (`@tailwindcss/vite`) |
| Data fetching | TanStack Query (`retry: false`, no refetch-on-focus — see `src/App.tsx`) |
| Backend | **Supabase** (Postgres + Auth + RPCs). Project ref `fortdxbbazifklqwydnk` (`cornerstone-admissions-dev`) |
| Charts | `recharts` |
| Forms | `react-hook-form` + `zod` |
| Hosting | **Vercel** (SPA; `vercel.json` rewrites all paths to `/index.html`) |
| Tests | `vitest` |

Path alias: `@/` → `src/`.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # production build
npm run preview      # serve the build locally
npm run typecheck    # tsc --noEmit (strict) — run before pushing
npm run test         # vitest run
npm run lint:metrics # metric-literal guard (see "The metric-literal rule" below)
```

Before pushing, run `npm run typecheck && npm run test && npm run lint:metrics`.

## Environment

Create `.env.local` (gitignored) with:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

The app throws on startup if these are missing (`src/lib/supabase.ts`). Get values from the
Supabase project settings or a teammate — see `docs/ACCESS_SETUP.md`.

---

## Architecture map

```
src/
  App.tsx              # ALL routes + role/feature gating live here. Read this first.
  main.tsx             # entry
  lib/
    supabase.ts        # Supabase client (custom processLock — see comment in file)
    api-client.ts      # apiFetch shim: routes legacy /api/* paths to Supabase RPCs/queries
    auth-context.tsx   # auth state; Role = "specialist" | "manager" | "admin"
    role-context.tsx   # current role + role lens
    feature-flags-context.tsx  # module_*/page_* flags, toggled in /admin/settings
    metrics/
      definitions.ts   # CANONICAL taxonomy — the single source of truth (see below)
      schemas.ts       # zod schemas for reporting payloads
  pages/               # one file per route (admin/, analytics/, bd/, ops/, leads/, executive/)
  components/          # ui/ (shadcn primitives) + feature dirs (bd/, ops/, calls/, ...)
  features/            # larger feature bundles (op-reporting, executive-analytics, analytics-warehouse)
  hooks/               # shared hooks (e.g. use-ops-api)
supabase/migrations/   # numbered SQL migrations (100_ … 186_). RPCs live here.
docs/                  # METRIC_DEFINITIONS.md, CONFIRMED.md, OPEN_QUESTIONS.md
scripts/               # check-metric-literals.sh, verify_metrics.ts
```

### Routing & gating (`src/App.tsx`)
- Routes are gated with helpers: `Mgr()` (manager+admin), `AdminOnly()`, `Mod(flag, …)` (feature-flag), `MgrMod(flag, …)` (flag + manager).
- Feature flags (`module_*`, `page_*`) are toggled by admins at `/admin/settings`. Adding a page usually means adding a `FeatureKey` and a gated `<Route>`.
- Roles: `specialist` | `manager` | `admin`. RLS enforces data access server-side; the route gates control which page shells are visible.

### Data flow
- Pages read from Supabase via **RPCs** (`supabase.rpc(...)`) and table queries, wrapped in TanStack Query.
- Reporting/warehouse pages (`/analytics/*`) read from `fact_*` / `dim_*` tables and `op_*` RPCs populated by an ETL + scheduled syncs (cron defined in migrations; 3-hour cadence + weekly full rebuild).
- `api-client.ts` is a compatibility shim from an earlier Replit backend — some legacy `/api/*` calls are routed to Supabase here; unrouted ones return a 501 stub.

---

## The reporting taxonomy (read before touching any metric)

This is the heart of the project and the easiest place to introduce silent, expensive bugs.

- **`src/lib/metrics/definitions.ts` is the ONLY file allowed to contain raw pipeline / stage /
  source-category / level-of-care / insurance / rep-profile string literals** (plus the SQL
  mapping tables). Everything else imports the constants.
- **`docs/METRIC_DEFINITIONS.md`** — the canonical definitions (what counts as an Admit, MQL, VOB, Win, Refer Out, etc.). 26 sections.
- **`docs/CONFIRMED.md`** — the 37 decisions Amber locked that explain *why* the taxonomy is shaped this way (Phase 1A acceptance gate, cleared 2026-05-27). When a definition seems surprising, the reason is here.
- **`docs/OPEN_QUESTIONS.md`** — unresolved/deferred questions. Check before assuming a rule exists.

### The metric-literal rule (enforced by CI)
`scripts/check-metric-literals.sh` (`npm run lint:metrics`) fails the build if a forbidden
literal (e.g. `"commercial_cash"`, `"Closed - Admitted"`, `"VOB - Approved"`) appears anywhere
in the reporting scope outside `definitions.ts`. **Always import from `definitions.ts` instead
of typing these strings.** If a value there is wrong, every chart and KPI is wrong.

Key facts baked into the taxonomy (don't "fix" these without checking CONFIRMED.md):
- **Five pipelines**, not four: `commercial_cash`, `ahcccs`, `zocdoc`, `dui_cash`, `dv_cash`.
- Only Commercial-Cash, AHCCCS, ZocDoc count toward top-line Admit/MQL/VOB KPIs. DUI & DV report on their own dimensions.
- `Closed - Referred Out Unattached` is a **Win**, not a loss (CONFIRMED.md #1).
- DUI "completion" counts as an admit-equivalent in specific places (migration 182).

---

## Conventions

- **TypeScript strict.** Keep `npm run typecheck` clean.
- **Comments:** the existing code uses comments to explain *why* (non-obvious constraints), not *what*. Match that — see the header comments in `supabase.ts` and `App.tsx` for the house style. Don't narrate obvious code.
- **Reporting strings:** never inline; import from `definitions.ts` (CI-enforced).
- **New analytics page:** add the `FeatureKey`, register a gated `<Route>` in `App.tsx`, and (if it reads new data) add the RPC as a new numbered migration.
- **Migrations:** additive, numbered sequentially (next after `186_`). Don't rewrite committed migrations.

## Git & PR workflow

- Remote: `github.com/amber706/dashboard` (the local dir is `admissions-copilot-frontend`).
- Work on a branch, open a PR, merge to `main`. History shows squash-merged PRs (`#NN`).
- Commit message style is mixed but two patterns dominate:
  - Conventional: `feat(bd): …`, `fix(chart-view): …`
  - Area-prefixed: `Payer Mix: …`, `Reporting: …`, `Op Overview: …`
  Match nearby history; lead with the area/feature.
- **Don't commit, push, or open PRs unless asked.** `.env.local` is gitignored — never commit secrets.

---

## Domain glossary — `TODO(amber)`

A new dev needs these to read the dashboards. Source of truth is `docs/METRIC_DEFINITIONS.md`;
this is the quick-reference. Fill / correct anything below:

- **VOB** — Verification of Benefits. *(see METRIC_DEFINITIONS.md §5)*
- **MQL** — Marketing Qualified Lead. *(§4)*
- **Admit** — a treatment admission. *(§6)*
- **Refer Out / Referred Out Unattached** — placing a caller at another provider. *(§7, §12; CONFIRMED.md #1)*
- **Payer Mix** — distribution of leads/admits across payer types (Commercial, AHCCCS, ZocDoc, …).
- **Op Rep / Admissions Rep vs BD Rep** — *(§22, §23)* `TODO(amber): one-line each, in plain terms`
- **CTM** — call-tracking source feeding call/attribution data. `TODO(amber): confirm what CTM stands for and what it feeds`
- **DUI / DV pipelines** — court-adjacent pipelines reported separately. `TODO(amber): one-liner on how the team thinks about these`
- `TODO(amber): anything else the team says "wait, what does that mean?" about`

## Project context — `TODO(amber)`

- **Phase status:** 1A (taxonomy lock) ✅, 1B (data layer) ✅, 1C (op reporting dashboards) ✅ as of the recent commits. `TODO(amber): what's the current phase / next milestone?`
- `TODO(amber): who's on the dev team and who owns what?`
- `TODO(amber): where do you track work — GitHub issues, ClickUp, Notion, Linear?`
