import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { StatCard } from "@/components/ops/stat-card";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { useRepWorkload, type RepWorkloadData } from "@/hooks/use-ops-api";
import {
  RefreshCw, Users, Phone, PhoneMissed, Clock,
  AlertTriangle, Target, TrendingUp, ShieldCheck, Zap,
  ChevronLeft, ChevronRight, Calendar,
} from "lucide-react";

function capacityBadge(status: string) {
  const styles: Record<string, string> = {
    available: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
    busy: "bg-amber-600/20 text-amber-400 border-amber-600/30",
    overloaded: "bg-red-600/20 text-red-400 border-red-600/30",
    idle: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };
  return <Badge className={`${styles[status] || styles.idle} text-[10px]`}>{status}</Badge>;
}

function capacityBarColor(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  if (score >= 25) return "bg-orange-500";
  return "bg-red-500";
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function OpsWorkloadContent() {
  const [, navigate] = useLocation();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const isToday = !selectedDate || selectedDate === todayStr();
  const { data, loading, error, refetch } = useRepWorkload({
    interval: isToday ? 20000 : 0,
    date: selectedDate || undefined,
  });

  const reps = data?.reps || [];
  const totalCalls = reps.reduce((sum, r) => sum + r.calls_today, 0);
  const totalMissed = reps.reduce((sum, r) => sum + r.missed_calls, 0);
  const totalOverdue = reps.reduce((sum, r) => sum + r.overdue_callbacks, 0);
  const overloaded = reps.filter((r) => r.capacity_status === "overloaded").length;
  const displayDate = selectedDate || todayStr();

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Rep Workload"
        subtitle="Agent capacity, performance metrics, and suggested actions"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1 border border-border/50">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSelectedDate(shiftDate(displayDate, -1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <div className="relative flex items-center gap-1.5 px-2">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium min-w-[5rem] text-center">{formatDateLabel(displayDate)}</span>
                <input
                  type="date"
                  value={displayDate}
                  max={todayStr()}
                  onChange={(e) => setSelectedDate(e.target.value === todayStr() ? "" : e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={isToday}
                onClick={() => {
                  const next = shiftDate(displayDate, 1);
                  setSelectedDate(next === todayStr() ? "" : next);
                }}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            {!isToday && (
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setSelectedDate("")}>
                Today
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={isToday ? "Active Reps" : "Reps"} value={reps.length} icon={<Users className="w-4 h-4 text-blue-400" />} loading={loading && !data} onClick={() => navigate("/ctm-agents")} />
        <StatCard label={isToday ? "Total Calls Today" : "Total Calls"} value={totalCalls} icon={<Phone className="w-4 h-4 text-emerald-400" />} loading={loading && !data} onClick={() => navigate(isToday ? "/ctm-calls?date=today" : "/ctm-calls")} />
        <StatCard label="Total Missed" value={totalMissed} icon={<PhoneMissed className="w-4 h-4 text-red-400" />} changeType={totalMissed > 5 ? "negative" : "neutral"} loading={loading && !data} onClick={() => navigate(isToday ? "/ctm-calls?date=today&status=missed" : "/ctm-calls?status=missed")} />
        <StatCard label="Overloaded Reps" value={overloaded} icon={<AlertTriangle className="w-4 h-4 text-orange-400" />} changeType={overloaded > 0 ? "negative" : "neutral"} loading={loading && !data} onClick={() => navigate("/ops/overview")} />
      </div>

      {loading && !data ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
        </div>
      ) : error && !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Unable to load workload data. The operations API may not be configured yet.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : reps.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No rep data available</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Rep workload data will appear once the operations engine is active</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {reps.map((rep: RepWorkloadData) => (
            <Card key={rep.rep_id} className="overflow-hidden border-border/50">
              <CardContent className="p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold shrink-0">
                      {rep.rep_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{rep.rep_name}</div>
                      <div className="text-[11px] text-muted-foreground">ID: {rep.rep_id}</div>
                    </div>
                  </div>
                  {capacityBadge(rep.capacity_status)}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Capacity</span>
                    <span className="font-medium">{rep.capacity_score}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${capacityBarColor(rep.capacity_score)}`}
                      style={{ width: `${Math.min(rep.capacity_score, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Each tile clickable. The title attribute is the
                    hard definition the manager hovers to learn what the
                    metric counts. Drilldown URLs already-supported via
                    the new specialist_id filter on /ctm-calls and
                    /ops/callbacks. */}
                <div className="grid grid-cols-4 gap-3">
                  <button
                    onClick={() => navigate(`/ctm-calls?date=today&specialist_id=${rep.rep_id}`)}
                    title="All call_sessions where this rep was the specialist with started_at >= start of today (caller picked up by them, plus their outbound dials)."
                    className="text-center p-2 rounded-md bg-muted/30 hover:bg-accent/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-center gap-1 text-blue-400 mb-0.5"><Phone className="w-3 h-3" /></div>
                    <div className="text-lg font-bold">{rep.calls_today}</div>
                    <div className="text-[10px] text-muted-foreground">Calls</div>
                  </button>
                  <button
                    onClick={() => navigate(`/ctm-calls?date=today&specialist_id=${rep.rep_id}&status=missed`)}
                    title="Today's calls where this rep was assigned but the call ended in status=missed or abandoned (no answer or caller hung up before connect)."
                    className="text-center p-2 rounded-md bg-muted/30 hover:bg-accent/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-center gap-1 text-red-400 mb-0.5"><PhoneMissed className="w-3 h-3" /></div>
                    <div className="text-lg font-bold">{rep.missed_calls}</div>
                    <div className="text-[10px] text-muted-foreground">Missed</div>
                  </button>
                  <button
                    onClick={() => navigate(`/ops/rep-leads/${rep.rep_id}`)}
                    title="Open Zoho leads owned by this rep, modified within the last 90 days, status not closed/disqualified. Click to drill into the actual lead rows with name, phone, status, source, lead score, notes, and a link out to Zoho."
                    className="text-center p-2 rounded-md bg-muted/30 hover:bg-accent/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-center gap-1 text-violet-400 mb-0.5"><Target className="w-3 h-3" /></div>
                    <div className="text-lg font-bold">{rep.open_leads}</div>
                    <div className="text-[10px] text-muted-foreground">Open Leads</div>
                  </button>
                  <button
                    onClick={() => navigate(`/ops/callbacks?status=pending&specialist_id=${rep.rep_id}`)}
                    title="Missed/abandoned calls owned by this rep from the last 48 hours that are still pending callback. SLA: should be returned within 1h."
                    className="text-center p-2 rounded-md bg-muted/30 hover:bg-accent/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-center gap-1 text-amber-400 mb-0.5"><Clock className="w-3 h-3" /></div>
                    <div className="text-lg font-bold">{rep.overdue_callbacks}</div>
                    <div className="text-[10px] text-muted-foreground">Overdue</div>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <button
                    onClick={() => navigate(`/ops/callbacks?status=pending&specialist_id=${rep.rep_id}`)}
                    title="Pending callbacks older than 1 hour for this rep. Same source as Overdue tile — SLA breach window."
                    className="flex items-center justify-between p-2 rounded-md bg-muted/20 hover:bg-accent/40 transition-colors cursor-pointer w-full"
                  >
                    <span className="text-muted-foreground">SLA Backlog</span>
                    <span className="font-medium">{rep.first_contact_sla_backlog}</span>
                  </button>
                  <button
                    onClick={() => navigate(`/ops/specialist/${rep.rep_id}`)}
                    title="Avg composite_score on this rep's calls over the last 7 days (0–100 scale). Click to open the specialist deep-dive."
                    className="flex items-center justify-between p-2 rounded-md bg-muted/20 hover:bg-accent/40 transition-colors cursor-pointer w-full"
                  >
                    <span className="text-muted-foreground">QA Trend</span>
                    <span className="font-medium flex items-center gap-1">
                      {rep.qa_trend != null ? (
                        <>
                          {rep.qa_trend >= 0 ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-red-400" />}
                          {rep.qa_trend}%
                        </>
                      ) : "—"}
                    </span>
                  </button>
                  <button
                    onClick={() => navigate(`/ops/callbacks?status=completed&specialist_id=${rep.rep_id}`)}
                    title="Average minutes from the original call's started_at to callback_completed_at, over the last 7 days of callbacks this rep marked completed. Outliers >14 days excluded."
                    className="flex items-center justify-between p-2 rounded-md bg-muted/20 hover:bg-accent/40 transition-colors cursor-pointer w-full"
                  >
                    <span className="text-muted-foreground">Avg CB Speed</span>
                    <span className="font-medium">{rep.avg_callback_speed_minutes != null ? `${rep.avg_callback_speed_minutes}m` : "—"}</span>
                  </button>
                </div>

                {rep.suggested_actions.length > 0 && (
                  <div className="pt-2 border-t space-y-1.5">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Suggested Actions
                    </div>
                    {rep.suggested_actions.map((action, i) => (
                      <div key={i} className="text-xs text-muted-foreground bg-amber-600/5 border border-amber-600/10 rounded-md px-3 py-1.5">
                        {action}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsWorkload() {
  return <OpsRoleGuard><OpsWorkloadContent /></OpsRoleGuard>;
}
