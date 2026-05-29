// /analytics/op-rep-activity — Phase 1C rep activity dashboard.
//
// Reads from reporting.op_rep_activity_daily via the manager/admin-gated
// reporting_op_rep_activity RPC. Shows per-rep totals for the window:
// inbound/outbound/missed/over-2min calls + meetings count + meetings
// broken out by type (Drop / Event / In-Service / Tour / Standard / Other).
//
// Note: the CTM agent → user_identity mapping is deferred (Phase 1B
// chunk 2 scaffold stub), so calls currently aggregate under
// "Unattributed". Meetings are properly mapped via Zoho Owner.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/dashboard/MetricCard";
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Calendar,
} from "lucide-react";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import {
  useOpRepActivity,
  type RepActivityRow,
  type RepRole,
} from "@/features/op-reporting/hooks/useOpRepActivity";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");

const ROLE_LABEL: Record<RepRole, string> = {
  admissions_rep: "Admissions",
  bd_rep: "BD",
  other: "Other",
};

const ROLE_TONE: Record<RepRole, string> = {
  admissions_rep: "bg-[#5BA3D4]/10 text-[#5BA3D4] border-[#5BA3D4]/30",
  bd_rep: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30",
  other: "bg-muted text-muted-foreground",
};

const MEETING_TYPE_ORDER = ["Drop", "Event", "In-Service", "Tour", "Standard Meeting", "Other"];

function MeetingTypesCell({ byType }: { byType: Record<string, number> | null }) {
  if (!byType || Object.keys(byType).length === 0) return <span className="text-muted-foreground">—</span>;
  // Sort by canonical order, then by count desc for any unknowns.
  const entries = Object.entries(byType).sort((a, b) => {
    const ai = MEETING_TYPE_ORDER.indexOf(a[0]);
    const bi = MEETING_TYPE_ORDER.indexOf(b[0]);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b[1] - a[1];
  });
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="outline" className="text-[10px] font-normal">
          {k}: {v}
        </Badge>
      ))}
    </div>
  );
}

function RepRow({ row }: { row: RepActivityRow }) {
  const totalCalls = row.inbound_calls + row.outbound_calls;
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 font-medium">
        <div className="flex items-center gap-2">
          <span>{row.full_name ?? "—"}</span>
          {row.role_derived && (
            <span className={`text-[10px] px-2 py-0.5 rounded border ${ROLE_TONE[row.role_derived]}`}>
              {ROLE_LABEL[row.role_derived]}
            </span>
          )}
        </div>
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(row.active_days)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(totalCalls)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(row.inbound_calls)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(row.outbound_calls)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(row.missed_calls)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(row.calls_over_2min)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(row.meetings_count)}</td>
      <td className="py-2 pr-0">
        <MeetingTypesCell byType={row.meetings_by_type} />
      </td>
    </tr>
  );
}

export default function OpRepActivity() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useOpRepActivity(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Rep Activity"
          subtitle="Per-rep call + meeting totals from reporting.op_rep_activity_daily. Cache rebuilds at 02:00 Phoenix."
        />
        <RangePicker preset={preset} range={range} onChange={setPreset} />
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Window totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {isLoading || !data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard label="Inbound Calls" value={fmtNumber(data.totals.inbound_calls)} severity="info" icon={PhoneIncoming} />
            <MetricCard label="Outbound Calls" value={fmtNumber(data.totals.outbound_calls)} severity="info" icon={PhoneOutgoing} />
            <MetricCard label="Missed Calls" value={fmtNumber(data.totals.missed_calls)} severity="danger" icon={PhoneMissed} />
            <MetricCard label="Calls > 2 min" value={fmtNumber(data.totals.calls_over_2min)} severity="success" icon={Clock} />
            <MetricCard label="Meetings" value={fmtNumber(data.totals.meetings_count)} severity="info" icon={Calendar} />
          </>
        )}
      </div>

      {/* Note about CTM → user_identity */}
      {data?.unattributed && (data.unattributed.inbound_calls + data.unattributed.outbound_calls) > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">
              {fmtNumber(data.unattributed.inbound_calls + data.unattributed.outbound_calls)}
            </span>{" "}
            calls in this window are unattributed to a specialist — the CTM-agent →
            user_identity mapping is a Phase 1C follow-up. Meetings are correctly mapped
            via Zoho Owner.
          </CardContent>
        </Card>
      )}

      {/* Per-rep table */}
      <Card>
        <CardHeader>
          <CardTitle>By specialist</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sorted by total calls. `Active days` is the count of distinct Phoenix-local
            days the specialist had at least one call or meeting recorded.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-60 w-full" />
          ) : data.rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">No rep activity in this window.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Specialist</th>
                    <th className="py-2 pr-4 text-right">Active days</th>
                    <th className="py-2 pr-4 text-right">Total calls</th>
                    <th className="py-2 pr-4 text-right">Inbound</th>
                    <th className="py-2 pr-4 text-right">Outbound</th>
                    <th className="py-2 pr-4 text-right">Missed</th>
                    <th className="py-2 pr-4 text-right">&gt; 2 min</th>
                    <th className="py-2 pr-4 text-right">Meetings</th>
                    <th className="py-2 pr-0">Meeting types</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <RepRow key={r.owner_user_id ?? "_"} row={r} />
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
