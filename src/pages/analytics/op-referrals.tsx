// /analytics/op-referrals — BD referrals in + referred-out-closed.
//
// Reads reporting.op_referrals_daily via two RPCs:
//   - reporting_op_referrals_daily (daily series, channel breakdown)
//   - reporting_op_referred_out_breakdown (Refer_Out_Type × Pipeline rollup)
//
// Per CONFIRMED.md #27, a lead is "Referral In" when source_category =
// business_development OR BD_Rep is set (not -None-). Referred Out Closed
// is the closed_won_referred_out_unattached stage on Commercial-Cash.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Handshake, Globe, ArrowRightCircle, Users } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import { useOpReferrals } from "@/features/op-reporting/hooks/useOpReferrals";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;

const PIPELINE_LABEL: Record<string, string> = {
  commercial_cash: "Commercial-Cash",
  ahcccs: "AHCCCS",
  zocdoc: "ZocDoc",
  dui_cash: "DUI",
  dv_cash: "DV",
};

export default function OpReferrals() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const { data, isLoading, error } = useOpReferrals(range, filters);
  const locFilterActive = filters.locs.length > 0;
  const bdShare =
    data && data.totals.total_referrals_in > 0
      ? data.totals.bd_referrals_in / data.totals.total_referrals_in
      : null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Referrals"
          subtitle="BD-attributed lead inflow + closed referred-out deals, from reporting.op_referrals_daily."
        />
        <RangePicker preset={preset} range={range} onChange={setPreset} />
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {locFilterActive && (
        <div className="text-xs text-muted-foreground">
          LOC filter doesn't apply on this page — op_referrals_daily doesn't carry
          Level of Care. Pipeline + Channel filters are honored.
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              label="BD Referrals In"
              value={fmtNumber(data.totals.bd_referrals_in)}
              severity="success"
              icon={Handshake}
              delta={bdShare != null ? { value: fmtPct(bdShare), direction: "flat", vs: "of total" } : undefined}
            />
            <MetricCard
              label="Digital Referrals In"
              value={fmtNumber(data.totals.digital_referrals_in)}
              severity="info"
              icon={Globe}
            />
            <MetricCard
              label="Total Referrals In"
              value={fmtNumber(data.totals.total_referrals_in)}
              severity="info"
              icon={Users}
            />
            <MetricCard
              label="Referred Out (Closed)"
              value={fmtNumber(data.totals.referred_out_closed)}
              severity="warning"
              icon={ArrowRightCircle}
            />
          </>
        )}
      </div>

      {/* Daily trend */}
      <Card>
        <CardHeader>
          <CardTitle>Daily inflow by channel</CardTitle>
          <p className="text-sm text-muted-foreground">
            Lead-side referral-in counts split by Source Category. Closed
            referred-out is a deal-side metric — counted on Closing_Date.
          </p>
        </CardHeader>
        <CardContent className="h-[340px]">
          {isLoading || !data ? (
            <Skeleton className="h-full w-full" />
          ) : data.rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No referral activity in this window.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.rows}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15, 37, 73, 0.95)",
                    border: "1px solid rgba(91, 163, 212, 0.3)",
                    color: "white",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="bd_referrals_in"          name="BD"               stackId="in" fill="#10B981" />
                <Bar dataKey="digital_referrals_in"     name="Digital"          stackId="in" fill="#5BA3D4" />
                <Bar dataKey="other_referrals_in"       name="ZocDoc / Other"   stackId="in" fill="#8A78D4" />
                <Bar dataKey="referred_out_closed_count" name="Referred Out (Closed)"            fill="#E89077" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Refer-out breakdown by type */}
      <Card>
        <CardHeader>
          <CardTitle>Referred Out (Closed) breakdown</CardTitle>
          <p className="text-sm text-muted-foreground">
            By Refer_Out_Type custom picklist (Detox / Residential / Psych × Attached / Unattached) per CONFIRMED.md #37.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.breakdown.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">No closed referrals in this window.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Refer-Out Type</th>
                    <th className="py-2 pr-4">Pipeline</th>
                    <th className="py-2 pr-0 text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((b, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{b.refer_out_type ?? <span className="text-muted-foreground">(no type set)</span>}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{b.pipeline ? (PIPELINE_LABEL[b.pipeline] ?? b.pipeline) : "—"}</td>
                      <td className="py-2 pr-0 text-right tabular-nums">{fmtNumber(b.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
