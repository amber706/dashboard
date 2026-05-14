import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/score-card";
import { Phone, Calendar, ClipboardCheck, AlertTriangle } from "lucide-react";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useBdActivity } from "@/features/analytics-warehouse/hooks/useBdActivity";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

export default function WarehouseBdActivity() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useBdActivity(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="BD Activity Scorecard"
          subtitle="Calls, meetings, tasks per BD rep. Sourced directly from Zoho CRM (Calls / Events / Tasks)."
        />
        <RangePicker preset={preset} range={range} onChange={setPreset} />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard label="Calls" value={isLoading || !data ? "…" : fmtNumber(data.totals.calls)} icon={<Phone className="w-4 h-4" />} />
        <MetricCard label="Meetings" value={isLoading || !data ? "…" : fmtNumber(data.totals.meetings)} icon={<Calendar className="w-4 h-4" />} />
        <MetricCard label="Tasks completed" value={isLoading || !data ? "…" : fmtNumber(data.totals.tasksCompleted)} icon={<ClipboardCheck className="w-4 h-4" />} />
        <MetricCard label="Tasks open" value={isLoading || !data ? "…" : fmtNumber(data.totals.tasksOpen)} icon={<ClipboardCheck className="w-4 h-4" />} />
        <MetricCard
          label="Overdue"
          value={isLoading || !data ? "…" : fmtNumber(data.totals.tasksOverdue)}
          icon={<AlertTriangle className="w-4 h-4" />}
          changeType={data && data.totals.tasksOverdue > 0 ? "negative" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rep scorecard</CardTitle>
          <p className="text-sm text-muted-foreground">Sorted by total touches descending</p>
        </CardHeader>
        <CardContent className="overflow-auto">
          {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.reps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No BD activity in range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Rep</th>
                  <th className="pr-3 text-right">Calls</th>
                  <th className="pr-3 text-right">Outbound</th>
                  <th className="pr-3 text-right">Inbound</th>
                  <th className="pr-3 text-right">Meetings</th>
                  <th className="pr-3 text-right">Upcoming</th>
                  <th className="pr-3 text-right">Tasks done</th>
                  <th className="pr-3 text-right">Open</th>
                  <th className="pr-3 text-right">Overdue</th>
                  <th className="text-right">Touches</th>
                </tr>
              </thead>
              <tbody>
                {data.reps.map((r) => (
                  <tr key={r.rep_key} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{r.display_name}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.calls_total)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.calls_outbound)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.calls_inbound)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.meetings_total)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.meetings_upcoming)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.tasks_completed)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.tasks_open)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.tasks_overdue)}</td>
                    <td className="text-right tabular-nums font-semibold">{fmtNumber(r.total_touches)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Top 25 accounts by activity</CardTitle>
            <p className="text-sm text-muted-foreground">Calls + meetings + tasks</p>
          </CardHeader>
          <CardContent className="overflow-auto">
            {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No account activity in range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Account</th>
                    <th className="pr-3 text-right">Calls</th>
                    <th className="pr-3 text-right">Meetings</th>
                    <th className="pr-3 text-right">Tasks</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.account_key} className="border-t">
                      <td className="py-1.5 pr-3 font-medium truncate max-w-[220px]" title={a.account_name}>{a.account_name}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(a.calls)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(a.meetings)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(a.tasks)}</td>
                      <td className="text-xs text-muted-foreground">{fmtDate(a.last_activity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overdue tasks</CardTitle>
            <p className="text-sm text-muted-foreground">All open tasks past their due date</p>
          </CardHeader>
          <CardContent className="overflow-auto">
            {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nothing overdue — nice.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Subject</th>
                    <th className="pr-3">Rep</th>
                    <th className="pr-3">Account</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overdue.slice(0, 30).map((t) => (
                    <tr key={t.task_id} className="border-t">
                      <td className="py-1.5 pr-3 truncate max-w-[200px]" title={t.subject ?? ""}>{t.subject ?? "—"}</td>
                      <td className="pr-3">{t.rep}</td>
                      <td className="pr-3 truncate max-w-[160px]" title={t.account_name ?? ""}>{t.account_name ?? "—"}</td>
                      <td><Badge variant="destructive">{fmtDate(t.due_date)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity feed</CardTitle>
          <p className="text-sm text-muted-foreground">Latest 50 calls and meetings</p>
        </CardHeader>
        <CardContent className="overflow-auto">
          {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No recent activity in range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">When</th>
                  <th className="pr-3">Kind</th>
                  <th className="pr-3">Rep</th>
                  <th className="pr-3">Subject</th>
                  <th className="pr-3">Account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={`${r.kind}-${i}`} className="border-t">
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{fmtDate(r.when)}</td>
                    <td className="pr-3"><Badge variant="outline">{r.kind}</Badge></td>
                    <td className="pr-3">{r.rep}</td>
                    <td className="pr-3 truncate max-w-[220px]" title={r.subject ?? ""}>{r.subject ?? "—"}</td>
                    <td className="pr-3 truncate max-w-[160px]" title={r.account_name ?? ""}>{r.account_name ?? "—"}</td>
                    <td><Badge variant="secondary">{r.status_or_type ?? "—"}</Badge></td>
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
