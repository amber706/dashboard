import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/score-card";
import { Users, Trophy, TrendingUp } from "lucide-react";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useRepMetrics, type RepRow } from "@/features/analytics-warehouse/hooks/useRepMetrics";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtPct = (n: number | null | undefined, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);

export default function WarehouseRepMetrics() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useRepMetrics(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Rep Metrics"
          subtitle="Per-rep volume, conversion, payer mix. Dual-credit: admissions counselor + BD overlay."
        />
        <RangePicker preset={preset} onChange={setPreset} />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Total Leads" value={isLoading || !data ? "…" : fmtNumber(data.totals.leads)} icon={<Users className="w-4 h-4" />} />
        <MetricCard label="Total Admits" value={isLoading || !data ? "…" : fmtNumber(data.totals.admits)} icon={<Trophy className="w-4 h-4" />} />
        <MetricCard label="Overall Conversion" value={isLoading || !data ? "…" : fmtPct(data.totals.rate, 1)} icon={<TrendingUp className="w-4 h-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funnel by payer bucket</CardTitle>
          <p className="text-sm text-muted-foreground">Counts in window across all reps</p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? <Skeleton className="h-24 w-full" /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Payer</th>
                  <th className="pr-3 text-right">Leads</th>
                  <th className="pr-3 text-right">VOBs</th>
                  <th className="pr-3 text-right">Admits</th>
                  <th className="text-right">Conv %</th>
                </tr>
              </thead>
              <tbody>
                {data.funnel.map((r) => (
                  <tr key={r.payer} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{r.payer}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.leads)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.vobs)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.admits)}</td>
                    <td className="text-right tabular-nums">{fmtPct(r.leads > 0 ? r.admits / r.leads : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <RepBoardCard title="Admissions counselors" rows={data?.admitReps ?? []} loading={isLoading} />
      <RepBoardCard title="BD reps" rows={data?.bdReps ?? []} loading={isLoading} />
    </div>
  );
}

function RepBoardCard({ title, rows, loading }: { title: string; rows: RepRow[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">Sorted by admits descending</p>
      </CardHeader>
      <CardContent className="overflow-auto">
        {loading ? <Skeleton className="h-32 w-full" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No activity in range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Rep</th>
                <th className="pr-3 text-right">Leads</th>
                <th className="pr-3 text-right">VOBs</th>
                <th className="pr-3 text-right">Admits</th>
                <th className="pr-3 text-right">Commercial</th>
                <th className="pr-3 text-right">AHCCCS</th>
                <th className="pr-3 text-right">Self-pay</th>
                <th className="text-right">Conv %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rep_key} className="border-t">
                  <td className="py-1.5 pr-3 font-medium">{r.display_name}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNumber(r.leads)}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNumber(r.vobs)}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNumber(r.admits)}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNumber(r.byPayer.Commercial.admits)}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNumber(r.byPayer.AHCCCS.admits)}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtNumber(r.byPayer["Self-Pay"].admits)}</td>
                  <td className="text-right tabular-nums">{fmtPct(r.leads > 0 ? r.admits / r.leads : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
