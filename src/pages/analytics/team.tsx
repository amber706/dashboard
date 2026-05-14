import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/score-card";
import { Trophy, TrendingUp, AlertTriangle } from "lucide-react";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useTeamPerformance } from "@/features/analytics-warehouse/hooks/useTeamPerformance";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtPct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);

export default function WarehouseTeam() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useTeamPerformance(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Team Performance"
          subtitle="Per-rep leaderboard with conversion, speed-to-close, stuck-lead ownership, and meeting activity."
        />
        <RangePicker preset={preset} range={range} onChange={setPreset} />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Average conversion" value={isLoading || !data ? "…" : fmtPct(data.avgConv)} icon={<TrendingUp className="w-4 h-4" />} />
        <MetricCard label="Avg stuck per rep" value={isLoading || !data ? "…" : data.avgStuck.toFixed(1)} icon={<AlertTriangle className="w-4 h-4" />} />
        <MetricCard label="Reps active in window" value={isLoading || !data ? "…" : fmtNumber(data.reps.length)} icon={<Trophy className="w-4 h-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
          <p className="text-sm text-muted-foreground">Sorted by admits, then conversion %</p>
        </CardHeader>
        <CardContent className="overflow-auto">
          {isLoading || !data ? <Skeleton className="h-48 w-full" /> : data.reps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activity in range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Rep</th>
                  <th className="pr-3">Role</th>
                  <th className="pr-3 text-right">Leads</th>
                  <th className="pr-3 text-right">VOBs</th>
                  <th className="pr-3 text-right">Admits</th>
                  <th className="pr-3 text-right">Lost</th>
                  <th className="pr-3 text-right">Conv %</th>
                  <th className="pr-3 text-right">Avg days</th>
                  <th className="pr-3 text-right">Stuck</th>
                  <th className="text-right">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {data.reps.map((r) => (
                  <tr key={r.rep_key} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{r.display_name}</td>
                    <td className="pr-3"><Badge variant="outline">{r.role ?? "—"}</Badge></td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.leads)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.vobs)}</td>
                    <td className="pr-3 text-right tabular-nums font-semibold">{fmtNumber(r.admits)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.lost)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtPct(r.convPct)}</td>
                    <td className="pr-3 text-right tabular-nums">{r.avgDaysToClose == null ? "—" : `${r.avgDaysToClose}d`}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.stuckOwned)}</td>
                    <td className="text-right tabular-nums">{fmtNumber(r.meetings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
