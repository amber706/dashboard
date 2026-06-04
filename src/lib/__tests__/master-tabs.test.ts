// master-tabs.test.ts — guards the master-tab ⇄ sidebar-section contract.
//
// Regression: the Phase 2/3/4 reporting dashboards (/reporting/admissions,
// /reporting/executive, /reporting/bd) all live in nav section "Reporting"
// (see layout.tsx), but no master tab claimed that section in its `sections`
// list — and the sidebar only renders items whose section is in the active
// tab's `sections` (layout.tsx: `tabSections.includes(item.section)`). The
// dashboards were built, routed and flagged, yet rendered nowhere in the nav.
// These tests pin both halves of the contract: the route resolves to a tab,
// and that tab surfaces the Reporting section.

import { describe, expect, it } from "vitest";
import { MASTER_TABS, getActiveMasterTab } from "@/lib/master-tabs";

// The nav sections that the reporting dashboards declare in layout.tsx.
const REPORTING_SECTION = "Reporting";

describe("master-tabs reporting surface", () => {
  it("some master tab claims the Reporting section", () => {
    const owners = MASTER_TABS.filter((t) => t.sections.includes(REPORTING_SECTION));
    expect(owners.length).toBeGreaterThan(0);
  });

  it.each([
    "/reporting/admissions",
    "/reporting/executive",
    "/reporting/bd",
  ])("%s resolves to a tab whose sidebar shows the Reporting section", (path) => {
    const tab = getActiveMasterTab(path);
    expect(tab.sections).toContain(REPORTING_SECTION);
  });
});
