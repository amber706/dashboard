# e2e/ — Playwright end-to-end tests

Phase 2B end-to-end coverage for the `/reporting/admissions` dashboard.

## Running

One-time setup (downloads ~200MB of browser binaries):

```bash
npx playwright install --with-deps chromium
```

Run the suite:

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright UI explorer
```

The Vite dev server gets spun up automatically by Playwright's `webServer`
config (`playwright.config.ts`); it reuses an existing server if one is
already running on port 5173, so `npm run dev` can stay up between runs.

## Test status

| Scenario | Status |
|---|---|
| Page route is reachable (no 404) | ✓ active |
| Page loads under a local 5s budget | ✓ active |
| Specialist sees "Your performance" + no by-rep | `fixme` — auth hook pending |
| Manager sees "Team performance" + by-rep visible | `fixme` — auth hook pending |
| Admin matches manager | `fixme` — auth hook pending |
| Filter chip → URL persistence | `fixme` — auth hook pending |
| URL reload → filter chips restore | `fixme` — auth hook pending |
| KPI tile click → DrilldownModal opens | `fixme` — auth hook pending |

The `.fixme()` tests are tracked (so they show up in the test list) but
skipped until the **auth test-hook** lands. Plan: add a `__test_role`
escape hatch to `src/lib/auth-context.tsx` that reads the role from
`localStorage.getItem("__test_role")` when `import.meta.env.MODE === "test"`,
so Playwright can flip the role per scenario without going through real
Supabase auth.

That test-hook is a small follow-up PR — not part of the Phase 2B build.

## CI integration

When CI gets wired (none currently):

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium
- name: Run e2e tests
  run: npm run test:e2e
  env:
    CI: true
```

CI mode automatically enables `fullyParallel: true`, `retries: 2`,
`workers: 4`, and `forbidOnly: true` per `playwright.config.ts`.
