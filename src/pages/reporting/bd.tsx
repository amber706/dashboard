/**
 * /reporting/bd — Phase 4 Business Development dashboard.
 *
 * Third consumer of the Phase 2A substrate (Admissions → Executive → BD).
 * Composes the shared `@/components/reporting` library against the 13 wired
 * `bd.*` metric keys. Manager/admin only (`MgrMod`; the funnel/referral RPCs
 * RAISE for non-managers).
 *
 * Architectural rules (per the brief): all reads via `useMetric` through the
 * shared components; filter + range state in the URL; no direct Supabase calls.
 */

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

import { PageHeader } from "@/components/section-header";

import { AsOfBadge, BarChart, KPICard, TrendChart } from "@/components/reporting";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

import { useAuth } from "@/lib/auth-context";
import { pageSubtitle } from "@/lib/reporting/role_copy";

// Side-effect import: registers all bd.* keys with the resolver.
import "@/lib/metrics/keys/bd";

type RepTab = "meetings" | "calls";

const REP_TAB_KEY: Record<RepTab, string> = {
  meetings: "bd.meetings_by_rep",
  calls: "bd.calls_by_bd_rep",
};

export default function BdReportingPage() {
  const { role } = useAuth();
  const { preset, range, setPreset } = useUrlDateRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const [repTab, setRepTab] = useState<RepTab>("meetings");

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <PageHeader title="Business Development" subtitle={pageSubtitle(role)} />
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

      {/* ── Top-line KPIs (MoM) ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard metric="bd.referrals_in_total" range={range} filters={filters} />
        <KPICard metric="bd.admits_from_bd" range={range} filters={filters} />
        <KPICard metric="bd.bd_mql_to_admit_rate" range={range} filters={filters} />
        <KPICard metric="bd.referred_out_total" range={range} filters={filters} />
      </div>

      {/* ── BD funnel + meetings KPIs ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard metric="bd.mqls_from_bd" range={range} filters={filters} />
        <KPICard metric="bd.vobs_from_bd" range={range} filters={filters} />
        <KPICard metric="bd.meetings_total" range={range} filters={filters} />
      </div>

      {/* ── Inflow + refer-out trends ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChart
          metric="bd.referrals_in_total"
          range={range}
          filters={filters}
          title="BD Referral Inflow"
        />
        <TrendChart
          metric="bd.referred_out_total"
          range={range}
          filters={filters}
          title="Referred Out (Wins)"
        />
      </div>

      {/* ── Channel mix + BD's share of admits ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChart
          metric="bd.referrals_in_by_channel"
          range={range}
          filters={filters}
          title="Referral Inflow by Channel"
        />
        <BarChart
          metric="bd.admits_by_source"
          range={range}
          filters={filters}
          title="Admits by Source"
          subtitle="How BD compares to Digital / Alumni / ZocDoc."
        />
      </div>

      {/* ── Refer-out destinations ──────────────────────────────────────── */}
      <BarChart
        metric="bd.referred_out_destinations"
        range={range}
        filters={filters}
        title="Refer-out Destinations"
      />

      {/* ── Meetings ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChart
          metric="bd.meetings_by_type"
          range={range}
          filters={filters}
          title="Meetings by Type"
        />
        <div className="space-y-3">
          <Tabs value={repTab} onValueChange={(v) => setRepTab(v as RepTab)}>
            <TabsList>
              <TabsTrigger value="meetings">Meetings</TabsTrigger>
              <TabsTrigger value="calls">Outbound Calls</TabsTrigger>
            </TabsList>
          </Tabs>
          <BarChart metric={REP_TAB_KEY[repTab]} range={range} filters={filters} />
        </div>
      </div>
    </div>
  );
}
