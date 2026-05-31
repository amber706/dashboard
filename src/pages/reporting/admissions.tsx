/**
 * /reporting/admissions — Phase 2B Admissions dashboard.
 *
 * The first real consumer of the Phase 2A resolver substrate. Composes the
 * shared `/src/components/reporting/` library against the 23 wired
 * `admissions.*` metric keys. Future dashboards (Executive, BD, Marketing)
 * copy this file's structure — see /docs/PHASE_2_PAGE_GUIDE.md.
 *
 * Architectural rules (non-negotiable per the brief):
 *   - All metric reads go through `useMetric` via the shared components.
 *     NEVER call Supabase RPCs directly from this page.
 *   - All components used come from `@/components/reporting`. New variants
 *     get added to the shared library, not one-offed here.
 *   - Filter state lives in URL query params via `FilterBar` + the
 *     `useFilterUrlState` hook — no local component state for filters.
 *   - RLS scopes data server-side; the UI flips copy via `role_copy.ts`.
 */

import { useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/section-header";

import {
  AsOfBadge,
  BarChart,
  KPICard,
  MatrixTable,
  TrendChart,
} from "@/components/reporting";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

import { useAuth } from "@/lib/auth-context";
import { pageSubtitle, showsByRepSections } from "@/lib/reporting/role_copy";

// Side-effect import: registers all 23 admissions.* keys with the resolver.
import "@/lib/metrics/keys/admissions";

type MatrixTab = "mqls" | "vobs" | "admits";

const MATRIX_TAB_KEY: Record<MatrixTab, string> = {
  mqls: "admissions.mqls_by_rep_by_loc",
  vobs: "admissions.vobs_by_rep_by_loc",
  admits: "admissions.admits_by_rep_by_loc",
};

export default function AdmissionsPage() {
  const { role } = useAuth();
  const { preset, range, setPreset } = useUrlDateRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const [matrixTab, setMatrixTab] = useState<MatrixTab>("admits");

  const showByRep = showsByRepSections(role);

  // Specialist (UserRole = "rep") view: inbound/outbound switch to the
  // by-rep variants so RLS narrows the per-rep slice to just the logged-in
  // user. Managers + admins get the team-wide totals.
  const inboundKey =
    role === "rep"
      ? "admissions.inbound_calls_by_rep"
      : "admissions.inbound_calls_team";
  const outboundKey =
    role === "rep"
      ? "admissions.outbound_calls_by_rep"
      : "admissions.outbound_calls_team";

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Admissions"
          subtitle={pageSubtitle(role)}
        />
        <div className="flex items-center gap-2">
          <RangePicker preset={preset} range={range} onChange={setPreset} />
        </div>
      </div>

      <div className="flex justify-end -mt-3">
        <AsOfBadge />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      {/* ── (b) Conversion ratios — 3 KPI tiles ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPICard metric="admissions.mql_to_vob_rate" range={range} filters={filters} />
        <KPICard metric="admissions.vob_to_admit_rate" range={range} filters={filters} />
        <KPICard metric="admissions.mql_to_admit_rate" range={range} filters={filters} />
      </div>

      {/* ── (c) Call activity — 4 KPI tiles (one Coming Soon placeholder) ─ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          metric="admissions.missed_call_pct_team"
          range={range}
          filters={filters}
        />
        <KPICard metric={inboundKey} range={range} filters={filters} />
        <KPICard metric={outboundKey} range={range} filters={filters} />
        <KPICard
          metric=""
          range={range}
          filters={filters}
          labelOverride="Call quality"
          placeholder
        />
      </div>

      {/* ── (d) Volume trends — 3 area charts ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrendChart
          metric="admissions.mqls_total"
          range={range}
          filters={filters}
          title="MQLs"
        />
        <TrendChart
          metric="admissions.vobs_total"
          range={range}
          filters={filters}
          title="VOBs"
        />
        <TrendChart
          metric="admissions.admits_total"
          range={range}
          filters={filters}
          title="Admits"
        />
      </div>

      {/* ── (e) By LOC ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BarChart
          metric="admissions.mqls_by_requested_loc"
          range={range}
          filters={filters}
          title="MQLs by Requested LOC"
          subtitle="Requested at lead time (CONFIRMED.md #21)."
        />
        <BarChart
          metric="admissions.vobs_by_requested_loc"
          range={range}
          filters={filters}
          title="VOBs by Requested LOC"
          subtitle="Requested at lead time."
        />
        <BarChart
          metric="admissions.admits_by_admitted_loc"
          range={range}
          filters={filters}
          title="Admits by Admitted LOC"
          subtitle="Admitted_Level_of_Care on the Deal — may differ from Requested LOC."
        />
      </div>

      {/* ── (f) By Rep — manager + admin only ──────────────────────────── */}
      {showByRep && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <BarChart
            metric="admissions.mqls_by_rep"
            range={range}
            filters={filters}
            title="MQLs by Rep"
          />
          <BarChart
            metric="admissions.vobs_by_rep"
            range={range}
            filters={filters}
            title="VOBs by Rep"
          />
          <BarChart
            metric="admissions.admits_by_rep"
            range={range}
            filters={filters}
            title="Admits by Rep"
          />
        </div>
      )}

      {/* ── (g) Rep × LOC matrix — manager + admin only ─────────────────── */}
      {showByRep && (
        <div className="space-y-3">
          <Tabs value={matrixTab} onValueChange={(v) => setMatrixTab(v as MatrixTab)}>
            <TabsList>
              <TabsTrigger value="admits">Admits</TabsTrigger>
              <TabsTrigger value="vobs">VOBs</TabsTrigger>
              <TabsTrigger value="mqls">MQLs</TabsTrigger>
            </TabsList>
          </Tabs>
          <MatrixTable
            metric={MATRIX_TAB_KEY[matrixTab]}
            range={range}
            filters={filters}
          />
        </div>
      )}

      {/* ── (h) Closed Lost ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KPICard
          metric="admissions.closed_lost_total"
          range={range}
          filters={filters}
        />
        <BarChart
          metric="admissions.closed_lost_by_reason"
          range={range}
          filters={filters}
          title="Closed Lost by Reason"
        />
      </div>
      {showByRep && (
        <BarChart
          metric="admissions.closed_lost_by_rep"
          range={range}
          filters={filters}
          title="Closed Lost by Rep"
        />
      )}
    </div>
  );
}
