// /analytics/op-sales-cycle — Phase 1C sales + placement cycle dashboard.
//
// Reads reporting.op_sales_cycle_daily (closing_date − lead_created_time on
// top-line admits) and reporting.op_placement_cycle_daily (same math on
// closed-referred-out deals). Both are empty until the Zoho conversion
// workflow that populates Lead_Created_Time ships — see OPEN_QUESTIONS #37.
//
// While waiting, the page shows a clear "data not yet collected" empty state
// plus the coverage stat (X of Y deals have Lead_Created_Time set) so an
// operator can see progress as the new workflow starts filling values in.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Clock, Hourglass, AlertCircle } from "lucide-react";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import { ExportButton } from "@/features/op-reporting/components/ExportButton";
import { downloadCsv, dateStampedName } from "@/lib/exportCsv";
import { useOpSalesCycle } from "@/features/op-reporting/hooks/useOpSalesCycle";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtDays = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toFixed(1)}d`;
const fmtPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;

export default function OpSalesCycle() {
  const { preset, range, setPreset } = useUrlDateRange("L30D");
  const { data, isLoading, error } = useOpSalesCycle(range);

  const coverage = data?.coverage ?? null;
  const noData =
    !isLoading &&
    data &&
    data.sales.length === 0 &&
    data.placement.length === 0;

  // Aggregate window stats for the KPI tiles.
  const salesAgg = (() => {
    if (!data || data.sales.length === 0) return null;
    let totalSample = 0;
    let weightedAvg = 0;
    for (const r of data.sales) {
      if (r.avg_days == null) continue;
      totalSample += r.sample_size;
      weightedAvg += Number(r.avg_days) * r.sample_size;
    }
    return totalSample > 0
      ? { avgDays: weightedAvg / totalSample, sampleSize: totalSample }
      : null;
  })();
  const placementAgg = (() => {
    if (!data || data.placement.length === 0) return null;
    let totalSample = 0;
    let weightedAvg = 0;
    for (const r of data.placement) {
      if (r.avg_days == null) continue;
      totalSample += r.sample_size;
      weightedAvg += Number(r.avg_days) * r.sample_size;
    }
    return totalSample > 0
      ? { avgDays: weightedAvg / totalSample, sampleSize: totalSample }
      : null;
  })();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Sales + Placement Cycle"
          subtitle="Closing date minus the originating Lead's Created Time. Reports out of reporting.op_sales_cycle_daily + op_placement_cycle_daily."
        />
        <div className="flex items-center gap-2">
          <ExportButton
            disabled={!data || data.sales.length === 0}
            onExport={() => downloadCsv(dateStampedName("op-sales-cycle"), data?.sales ?? [])}
            label="Export sales cycle"
          />
          <RangePicker preset={preset} range={range} onChange={setPreset} />
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Coverage banner: surfaces the Zoho-workflow gap clearly */}
      {coverage && (
        <Card
          className={
            coverage.with_lead_created_time === 0
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-[#10B981]/30 bg-[#10B981]/5"
          }
        >
          <CardContent className="p-4 flex items-start gap-3 text-sm">
            <AlertCircle
              className={
                coverage.with_lead_created_time === 0
                  ? "h-5 w-5 text-amber-500 mt-0.5"
                  : "h-5 w-5 text-[#10B981] mt-0.5"
              }
            />
            <div>
              <div className="font-medium">
                Lead_Created_Time coverage:{" "}
                {fmtNumber(coverage.with_lead_created_time)} of {fmtNumber(coverage.total_deals)} deals
                ({fmtPct(coverage.coverage_share)})
              </div>
              <div className="text-muted-foreground mt-1">
                {coverage.with_lead_created_time === 0 ? (
                  <>
                    No Deals have <code className="text-[11px]">Lead_Created_Time</code> populated yet
                    — Zoho doesn't auto-copy the Lead's Created Time onto the Deal at conversion. Add
                    a Lead Conversion → Field Update workflow in Zoho CRM
                    (see <code className="text-[11px]">OPEN_QUESTIONS #37</code>) to start filling the
                    field. Cycle-days math will populate the day after the next nightly sync runs.
                  </>
                ) : (
                  <>
                    {fmtNumber(coverage.total_deals - coverage.with_lead_created_time)} historical
                    deals are still missing the value; new conversions are being captured. The cycle
                    rollups below cover only the deals where this field is set.
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {isLoading || !data ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              label="Sales cycle (avg, weighted)"
              value={salesAgg ? fmtDays(salesAgg.avgDays) : "—"}
              severity={salesAgg ? "info" : "neutral"}
              icon={Clock}
              delta={
                salesAgg
                  ? { value: `${fmtNumber(salesAgg.sampleSize)} admits`, direction: "flat" }
                  : undefined
              }
            />
            <MetricCard
              label="Placement cycle (avg, weighted)"
              value={placementAgg ? fmtDays(placementAgg.avgDays) : "—"}
              severity={placementAgg ? "info" : "neutral"}
              icon={Hourglass}
              delta={
                placementAgg
                  ? { value: `${fmtNumber(placementAgg.sampleSize)} closed referrals`, direction: "flat" }
                  : undefined
              }
            />
          </>
        )}
      </div>

      {noData && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-2">
            <Clock className="h-8 w-8 mx-auto opacity-50" />
            <div className="font-medium">No cycle data in this window yet.</div>
            <div>
              Either the trailing-14-day window has no qualifying admits (or referred-out closes)
              with a Lead_Created_Time, or the Zoho workflow hasn't started populating the field.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sales cycle table */}
      {data && data.sales.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sales cycle, by admit date</CardTitle>
            <p className="text-sm text-muted-foreground">
              One row per (admit date × source × admitted LOC). Top-line pipelines only
              (Commercial-Cash, AHCCCS, ZocDoc) per CONFIRMED.md #3.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Admit date</th>
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">Admitted LOC</th>
                    <th className="py-2 pr-4 text-right">Avg days</th>
                    <th className="py-2 pr-4 text-right">P50</th>
                    <th className="py-2 pr-4 text-right">P90</th>
                    <th className="py-2 pr-0 text-right">N</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sales.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{r.date}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.source_category ?? "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.level_of_care_admitted ?? "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtDays(r.avg_days)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtDays(r.p50_days)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtDays(r.p90_days)}</td>
                      <td className="py-2 pr-0 text-right tabular-nums">{fmtNumber(r.sample_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Placement cycle table */}
      {data && data.placement.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Placement cycle, by closing date</CardTitle>
            <p className="text-sm text-muted-foreground">
              Closed-Referred-Out-Unattached deals. CONFIRMED.md #29.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Closing date</th>
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">Refer-out type</th>
                    <th className="py-2 pr-4 text-right">Avg days</th>
                    <th className="py-2 pr-4 text-right">P50</th>
                    <th className="py-2 pr-4 text-right">P90</th>
                    <th className="py-2 pr-0 text-right">N</th>
                  </tr>
                </thead>
                <tbody>
                  {data.placement.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{r.date}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.source_category ?? "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.refer_out_type ?? "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtDays(r.avg_days)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtDays(r.p50_days)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtDays(r.p90_days)}</td>
                      <td className="py-2 pr-0 text-right tabular-nums">{fmtNumber(r.sample_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
