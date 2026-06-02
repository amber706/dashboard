/**
 * /reporting/executive — Phase 3 Executive dashboard.
 *
 * The second consumer of the Phase 2A resolver substrate (Admissions was
 * first). Composes the shared `/src/components/reporting/` library against
 * the 14 wired `executive.*` metric keys. Copies the Admissions page's
 * structure — see /docs/PHASE_2_PAGE_GUIDE.md.
 *
 * Audience: Amber + leadership. Manager/admin only (route is MgrMod-gated;
 * the breakdown RPCs also RAISE for non-managers), so there is no by-rep or
 * specialist framing here — every tile is team-wide.
 *
 * Architectural rules (non-negotiable per the brief):
 *   - All metric reads go through `useMetric` via the shared components.
 *     NEVER call Supabase RPCs directly from this page.
 *   - All components come from `@/components/reporting`.
 *   - Filter + range state lives in the URL via the op-reporting hooks.
 */

import { useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/section-header";

import { AsOfBadge, BarChart, KPICard, TrendChart } from "@/components/reporting";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

import { useAuth } from "@/lib/auth-context";
import { pageSubtitle } from "@/lib/reporting/role_copy";

// Side-effect import: registers all executive.* keys with the resolver.
import "@/lib/metrics/keys/executive";

type PipelineTab = "admits" | "vobs" | "mqls";

const PIPELINE_TAB_KEY: Record<PipelineTab, string> = {
  admits: "executive.admits_by_pipeline",
  vobs: "executive.vobs_by_pipeline",
  mqls: "executive.mqls_by_pipeline",
};

export default function ExecutiveReportingPage() {
  const { role } = useAuth();
  const { preset, range, setPreset } = useUrlDateRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const [pipelineTab, setPipelineTab] = useState<PipelineTab>("admits");

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <PageHeader title="Executive" subtitle={pageSubtitle(role)} />
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

      {/* ── Top-line KPIs — 4 tiles with month-over-month deltas ────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard metric="executive.admits_total" range={range} filters={filters} />
        <KPICard metric="executive.vobs_total" range={range} filters={filters} />
        <KPICard metric="executive.mqls_total" range={range} filters={filters} />
        <KPICard metric="executive.mql_to_admit_rate" range={range} filters={filters} />
      </div>

      {/* ── Volume trends — 3 area charts ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrendChart metric="executive.mqls_total" range={range} filters={filters} title="MQLs" />
        <TrendChart metric="executive.vobs_total" range={range} filters={filters} title="VOBs" />
        <TrendChart metric="executive.admits_total" range={range} filters={filters} title="Admits" />
      </div>

      {/* ── Conversion funnel + Payer mix ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChart
          metric="executive.conversion_funnel"
          range={range}
          filters={filters}
          title="Conversion Funnel"
          subtitle="Leads → MQL → VOB → Admit over the window."
        />
        <BarChart
          metric="executive.payer_mix"
          range={range}
          filters={filters}
          title="Payer Mix"
          subtitle="Lead distribution across payer buckets."
        />
      </div>

      {/* ── Channel split — BD / Digital / ZocDoc ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChart
          metric="executive.admits_by_channel"
          range={range}
          filters={filters}
          title="Admits by Channel"
        />
        <BarChart
          metric="executive.mqls_by_channel"
          range={range}
          filters={filters}
          title="MQLs by Channel"
        />
      </div>

      {/* ── Pipeline split — tabbed across all five pipelines ───────────── */}
      <div className="space-y-3">
        <Tabs value={pipelineTab} onValueChange={(v) => setPipelineTab(v as PipelineTab)}>
          <TabsList>
            <TabsTrigger value="admits">Admits</TabsTrigger>
            <TabsTrigger value="vobs">VOBs</TabsTrigger>
            <TabsTrigger value="mqls">MQLs</TabsTrigger>
          </TabsList>
        </Tabs>
        <BarChart metric={PIPELINE_TAB_KEY[pipelineTab]} range={range} filters={filters} />
      </div>

      {/* ── Wins / Refer-out ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KPICard metric="executive.referred_out_total" range={range} filters={filters} />
        <BarChart
          metric="executive.referred_out_destinations"
          range={range}
          filters={filters}
          title="Refer-out Destinations"
        />
      </div>
    </div>
  );
}
