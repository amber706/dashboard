/**
 * e2e/executive.spec.ts — Phase 3 end-to-end tests for /reporting/executive.
 *
 * Mirrors e2e/admissions.spec.ts. Covers:
 *   1. Renders without crashing (route exists, shell appears).
 *   2. Subtitle reads "Team performance" for manager/admin.
 *   3. The page is manager/admin only (MgrMod) — a rep is gated out.
 *   4. Key sections appear (conversion funnel, payer mix, channel split,
 *      refer-out, pipeline tabs).
 *   5. Filter chips → URL query params persist across reloads.
 *   6. KPI tile click → DrilldownModal opens.
 *
 * Auth strategy (same as admissions): role-gated scenarios set a
 * `__test_role` value in localStorage that a future test-only hook on the
 * auth context would read. Until that hook lands, role-gated tests are marked
 * `.fixme()` so they're tracked but skipped. Auth-free tests run as-is.
 *
 * Unlike Admissions, this page has NO by-rep / specialist-hidden sections —
 * it's manager/admin only — so the role assertions cover the route gate +
 * header copy, not section toggles.
 *
 * To run locally:
 *   npx playwright install --with-deps  # first time only
 *   npm run test:e2e
 */

import { test, expect } from "@playwright/test";

const PAGE = "/reporting/executive";

test.describe("/reporting/executive — basic surface", () => {
  test("page is registered (route does not 404)", async ({ page }) => {
    // SPA route: Vite returns 200 + HTML regardless of auth state. We only
    // confirm the route is reachable (exists in App.tsx), not that the
    // dashboard content rendered — that depends on auth + role.
    const resp = await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    expect(resp).not.toBeNull();
    expect(resp!.status()).toBeLessThan(400);
    await expect(page.locator("html")).toBeAttached();
  });
});

// ── Role-gated scenarios ──────────────────────────────────────────────────
// Need a `__test_role` hook on the auth-context to fake role without real
// Supabase auth. The hook is a shared follow-up (see docs/PHASE_2_SIGNOFF.md
// and docs/PHASE_3_SIGNOFF.md).

test.describe("manager/admin gating + copy", () => {
  test.fixme("manager sees 'Team performance' + the Executive header", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "manager";
    });
    await page.goto(PAGE);
    await expect(page.getByText("Executive")).toBeVisible();
    await expect(page.getByText("Team performance")).toBeVisible();
  });

  test.fixme("admin matches manager", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "admin";
    });
    await page.goto(PAGE);
    await expect(page.getByText("Team performance")).toBeVisible();
  });

  test.fixme("specialist (rep) is gated out (MgrMod)", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "rep";
    });
    await page.goto(PAGE);
    // The route is MgrMod-gated; a rep should not see the Executive page
    // body. (Exact fallback copy depends on the MgrMod gate component —
    // assert the dashboard's own sections are absent.)
    await expect(page.getByText("Conversion Funnel")).not.toBeVisible();
  });
});

// ── Section presence (manager) ────────────────────────────────────────────

test.describe("executive sections render", () => {
  test.fixme("conversion funnel, payer mix, channel split, refer-out all appear", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "manager";
    });
    await page.goto(PAGE);
    await expect(page.getByText("Conversion Funnel")).toBeVisible();
    await expect(page.getByText("Payer Mix")).toBeVisible();
    await expect(page.getByText("Admits by Channel")).toBeVisible();
    await expect(page.getByText("Refer-out Destinations")).toBeVisible();
  });
});

// ── URL filter persistence ────────────────────────────────────────────────

test.describe("filter state lives in URL query params", () => {
  test.fixme("pipeline chip selection serializes to ?pipelines=...", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "manager";
    });
    await page.goto(PAGE);
    await page.getByRole("button", { name: /pipeline/i }).click();
    await page.getByRole("menuitem", { name: /commercial.cash/i }).click();
    await expect(page).toHaveURL(/[?&]pipelines=commercial_cash/);
  });

  test.fixme("reloading the URL restores the same filter set", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "manager";
    });
    await page.goto(`${PAGE}?pipelines=commercial_cash&sources=business_development`);
    await expect(page.getByText(/commercial.cash/i)).toBeVisible();
    await expect(page.getByText(/business development/i)).toBeVisible();
  });
});

// ── Drill-down modal ──────────────────────────────────────────────────────

test.describe("KPI tile drill-down", () => {
  test.fixme("clicking a top-line KPI opens DrilldownModal", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__test_role = "manager";
    });
    await page.goto(PAGE);
    await page.getByText(/Admits/i).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

// ── Performance budget (smoke) ────────────────────────────────────────────

test("page loads within 5 seconds on local dev", async ({ page }) => {
  const start = Date.now();
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  const ms = Date.now() - start;
  expect(ms).toBeLessThan(5000);
});
