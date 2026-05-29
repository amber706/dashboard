// /analytics/op-payer-mix — Phase 1C payer-mix dashboard.
//
// Classifies leads in the window into AHCCCS / Commercial / Other Payer /
// DUI / DV / Unclassified using the insurance-wins precedence from
// CONFIRMED.md #24 + the treatment-lead gate from CONFIRMED.md #12.
// Driven by the reporting_op_payer_mix RPC.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ShieldCheck, CreditCard, HelpCircle, Gavel, Users } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import {
  useOpPayerMix,
  type PayerBucket,
} from "@/features/op-reporting/hooks/useOpPayerMix";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { ExportButton } from "@/features/op-reporting/components/ExportButton";
import { SavedViewsControl } from "@/features/op-reporting/components/SavedViewsControl";
import { downloadCsv, dateStampedName } from "@/lib/exportCsv";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;

const BUCKET_COLOR: Record<PayerBucket, string> = {
  "AHCCCS Lead": "#5BA3D4",
  "Commercial Lead": "#10B981",
  "Other Payer Lead": "#8A78D4",
  "DUI": "#E5C879",
  "DV": "#E89077",
  "Unclassified": "#6B7A95",
};

export default function OpPayerMix() {
  const { preset, range, setPreset } = useDashboardRange("L30D");
  const [filters, setFilters] = useFilterUrlState();
  const { data, isLoading, error } = useOpPayerMix(range, filters);
  const pipelineFilterActive = filters.pipelines.length > 0;

  const unclassifiedShare =
    data && data.total > 0 ? data.treatment.unclassified / data.total : null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Payer mix"
          subtitle="Lead classification by insurance + star fallback. Insurance-wins precedence per CONFIRMED.md #24; DUI/DV gate per #12."
        />
        <div className="flex items-center gap-2">
          <ExportButton
            disabled={!data || data.rows.length === 0}
            onExport={() => downloadCsv(dateStampedName("op-payer-mix"), data?.rows ?? [])}
          />
          <RangePicker preset={preset} range={range} onChange={setPreset} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <FilterBar filters={filters} onChange={setFilters} />
        <SavedViewsControl pageKey="op-payer-mix" filters={filters} onApply={setFilters} />
      </div>

      {pipelineFilterActive && (
        <div className="text-xs text-muted-foreground">
          Pipeline filter doesn't apply on this page — leads aren't attributed to a
          pipeline until they convert to deals. Channel + LOC filters are honored.
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* KPI tiles for the major buckets */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {isLoading || !data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard label="AHCCCS Leads" value={fmtNumber(data.treatment.ahcccs)} severity="info" icon={ShieldCheck} />
            <MetricCard label="Commercial Leads" value={fmtNumber(data.treatment.commercial)} severity="success" icon={CreditCard} />
            <MetricCard label="Other Payer" value={fmtNumber(data.treatment.other_payer)} severity="info" icon={Users} />
            <MetricCard
              label="DUI / DV"
              value={fmtNumber(
                (data.rows.find((r) => r.bucket === "DUI")?.count ?? 0) +
                (data.rows.find((r) => r.bucket === "DV")?.count ?? 0),
              )}
              severity="warning"
              icon={Gavel}
            />
            <MetricCard
              label="Unclassified"
              value={fmtNumber(data.treatment.unclassified)}
              severity="danger"
              icon={HelpCircle}
              delta={unclassifiedShare != null ? { value: fmtPct(unclassifiedShare), direction: "flat", vs: "of all leads" } : undefined}
            />
          </>
        )}
      </div>

      {/* Data quality nudge */}
      {data && unclassifiedShare != null && unclassifiedShare > 0.15 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">{fmtPct(unclassifiedShare)}</span> of leads
            in this window are Unclassified — neither Insurance Type nor a 3/4/5-star
            Lead Score Rating is set. These leads can't roll into the AHCCCS /
            Commercial payer split until one or the other is captured at intake.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle>Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[340px]">
            {isLoading || !data ? (
              <Skeleton className="h-full w-full" />
            ) : data.rows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No leads in window.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.rows}
                    dataKey="count"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    innerRadius={60}
                    label={(entry) => `${entry.bucket} ${(((entry.count as number) / data.total) * 100).toFixed(0)}%`}
                  >
                    {data.rows.map((r) => (
                      <Cell key={r.bucket} fill={BUCKET_COLOR[r.bucket as PayerBucket] ?? "#888"} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => fmtNumber(value)}
                    contentStyle={{
                      backgroundColor: "rgba(15, 37, 73, 0.95)",
                      border: "1px solid rgba(91, 163, 212, 0.3)",
                      color: "white",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Buckets</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sorted by count desc. Shares are of all leads in the window (not
              just treatment leads).
            </p>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-4">Bucket</th>
                      <th className="py-2 pr-4 text-right">Count</th>
                      <th className="py-2 pr-0 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.bucket} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <span
                            className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                            style={{ backgroundColor: BUCKET_COLOR[r.bucket as PayerBucket] ?? "#888" }}
                          />
                          {r.bucket}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.count)}</td>
                        <td className="py-2 pr-0 text-right tabular-nums">{fmtPct(r.share)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[#5BA3D4]/40 font-medium">
                      <td className="py-2 pr-4">Total</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(data.total)}</td>
                      <td className="py-2 pr-0 text-right tabular-nums">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
