/**
 * Playwright config — Phase 2B end-to-end tests for /reporting/admissions.
 *
 * Test files live in `/e2e/*.spec.ts`. Each test spins up the Vite dev
 * server on port 5173 via the `webServer` option (Playwright will reuse
 * an already-running server if one is detected, so `npm run dev` can stay
 * up between test runs).
 *
 * Auth: most tests run against the local dev environment with the
 * specialist / manager / admin role faked via localStorage. The
 * Cornerstone Supabase auth flow isn't exercised here — the goal is to
 * verify the UI / routing / filter persistence layer, not to round-trip
 * a real session. RLS-aware end-to-end is a separate suite that needs a
 * test tenant + seeded data; out of scope for Phase 2B.
 *
 * Running:
 *   npx playwright install --with-deps   # one-time browser download
 *   npm run test:e2e
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The CI hook (when wired) will set CI=true; locally we keep the
  // default of `1` parallel worker so dev-server logs stay readable.
  fullyParallel: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 1,
  reporter: process.env.CI ? "list" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
