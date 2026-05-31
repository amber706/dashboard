# Phase 2 Page Guide — the template every new dashboard page imitates

**Status:** Live; first consumer is `/reporting/admissions` (Phase 2B).
**Owner:** Claude (template), Amber (page-by-page scope).

This doc captures the structure every Phase 2+ dashboard page should follow.
The Admissions page is the worked example; Executive, BD, and Marketing pages
will copy this scaffold and swap the metric_key set.

---

## 1. The four layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  Page                /src/pages/reporting/<page>.tsx                 │
│  (composition)       Routes, layout, role-aware sections.            │
├──────────────────────────────────────────────────────────────────────┤
│  Components          /src/components/reporting/*                     │
│  (presentation)      KPICard / TrendChart / BarChart / MatrixTable / │
│                      DrilldownModal / AsOfBadge / EmptyState /        │
│                      LoadingSkeleton / ChartContainer.               │
├──────────────────────────────────────────────────────────────────────┤
│  Resolver            /src/lib/metrics/resolver.ts                    │
│  (substrate)         + /src/lib/metrics/use-metric.ts                │
│                      + /src/lib/metrics/keys/<page>.ts catalog.      │
├──────────────────────────────────────────────────────────────────────┤
│  RPCs                supabase/migrations/15x_op_*.sql                │
│  (data)              All metric reads go through op_* cached tables. │
└──────────────────────────────────────────────────────────────────────┘
```

**Rule:** pages never call Supabase directly. Drill-downs are the one
exception — they go through `getMetric(key).drilldown` config to read from
normalized mirrors with RLS enforced (page size capped at 100).

---

## 2. Building a new dashboard page — step by step

### Step 1 — Define the metric key catalog

Create `/src/lib/metrics/keys/<page>.ts`. Follow the Admissions example:

```ts
import { registerMetrics, type MetricDefinition } from "../resolver";

const METRICS: ReadonlyArray<MetricDefinition> = [
  {
    key: "<page>.<snake_case_name>",
    label: "Display label",
    description: "One-line description for tooltips and audit.",
    source_table: "reporting.op_<table>",
    supports_rep_scope: true,
    inverse: false, // true for down-is-good metrics (missed-call rate, etc.)
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: async (range, filters) => {
      // Read through an op_* RPC. Return ScalarResult | BreakdownResult | MatrixResult.
    },
  },
  // ...
];

registerMetrics(METRICS);

export const <PAGE>_METRICS = METRICS;
export type <Page>MetricKey = (typeof METRICS)[number]["key"];
```

Naming rules (from the Phase 2 brief):

- Every key follows `<page>.<snake_case>`. The page prefix is mandatory.
- Conversion ratios end in `_rate`. Percentages end in `_pct_*`. The
  formatter sniffs these and renders as a `%`.
- `inverse: true` for KPIs where "down is good" — `KPICard` flips the
  delta arrow color automatically.

### Step 2 — Write the page

Create `/src/pages/reporting/<page>.tsx`. Import the keys module for its
side effect (registration), then compose shared components:

```tsx
import "@/lib/metrics/keys/<page>"; // side effect — registers the catalog

import { KPICard, TrendChart, BarChart } from "@/components/reporting";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { pageSubtitle, showsByRepSections } from "@/lib/reporting/role_copy";
import { useAuth } from "@/lib/auth-context";

export default function MyPage() {
  const { role } = useAuth();
  const { preset, range, setPreset } = useUrlDateRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const showByRep = showsByRepSections(role);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* header + FilterBar */}
      <div className="grid grid-cols-3 gap-3">
        <KPICard metric="my_page.foo_total" range={range} filters={filters} />
        {/* ... */}
      </div>
      {/* etc. */}
    </div>
  );
}
```

### Step 3 — Register the route

Edit `/src/lib/feature-flags-context.tsx` and add a new `PageKey`:

```ts
| "page_reporting_<page>";
```

Edit `/src/App.tsx` and register the route:

```tsx
import MyPage from "@/pages/reporting/<page>";

<Route path="/reporting/<page>" component={Mod("page_reporting_<page>", MyPage)} />
```

`Mod` (feature-flag-only) for all-role pages; `MgrMod` for manager-only.

### Step 4 — Tests

Add a component test in `/src/lib/metrics/__tests__/<page>.test.ts` for the
resolver wiring (mock `supabase.rpc`, verify each resolver). Page-level
component tests live next to the page file as `<page>.test.tsx` and use
Testing Library with a mocked `useMetric`.

---

## 3. Role-aware copy

Pages adjust copy via `/src/lib/reporting/role_copy.ts`:

```ts
roleLabel("specialist", "MQLs")  // → "Your MQLs"
roleLabel("manager",    "MQLs")  // → "Team MQLs"
pageSubtitle("specialist")        // → "Your performance"
pageSubtitle("manager")           // → "Team performance"
showsByRepSections("specialist")  // → false
showsByRepSections("manager")     // → true
```

**Never hardcode "Your" / "Team" prefixes in a page file.** Pull through
the helper so future copy rules live in one place.

RLS handles data scoping server-side regardless of UI copy.

---

## 4. Loading + empty states

Every visual component (`KPICard`, `TrendChart`, `BarChart`, `MatrixTable`)
already handles its own loading + empty states via the shared
`LoadingSkeleton` + `EmptyState` components. Pages don't need to add their
own.

If you need to show a custom empty state (e.g. "User has no permissions"),
import `EmptyState` directly:

```tsx
<EmptyState
  title="No admits in this date range."
  hint="Try expanding the time filter."
/>
```

---

## 5. Drill-downs

Every `KPICard` and `MatrixTable` cell is clickable and opens a
`DrilldownModal`. The MVP wiring shows a placeholder; the real record
fetch reads from the metric definition's `drilldown` config:

```ts
drilldown: {
  source: "reporting.deals",         // normalized mirror, RLS-scoped
  scope: "deals_admitted",            // page narrows the WHERE clause
  conversion_denominator: "mqls",     // for ratio drill-downs
}
```

The drill-down query is the ONE exception to "frontend reads only from
op_*". It's allowed because:

1. Page size is capped at 100 rows.
2. Records need detail (full deal info, not aggregates).
3. RLS is enforced on the mirror.

Adding a new drill-down: extend the resolver's drill-down query, and the
modal will render the new columns automatically.

---

## 6. Performance budget

The Phase 2 brief specifies:

- Initial load on Vercel preview: **under 2s FMP** at 90-day dataset on
  4G throttle.
- **No chart fires more than one resolver call.**
- All charts hit TanStack Query cache on second filter change to the
  same value.

`useMetric` enforces #2 + #3 via stable cache keys (range + filters
serialize the same way across calls).

---

## 7. Acceptance gate for a new page

Before shipping a `Phase 2X` page, the brief requires:

- [ ] Every metric_key wired (no `notYetWired()` stubs).
- [ ] Resolver tests pass against seed data.
- [ ] Drift report: `verify_metrics.ts --scope=<page>` shows zero
      drift for a 30-day window.
- [ ] Amber walks the page under each role (specialist, manager, admin)
      and signs off in `/docs/PHASE_<N>_SIGNOFF.md`.

Until those land, the page stays behind its feature flag.

---

## Document changelog

- **2026-05-31 (rev 1)** — Initial draft alongside Phase 2B Admissions ship.
  Captures the substrate + page-layer pattern. Future Executive / BD /
  Marketing pages copy this scaffold.
