// Intake schedule.
//
// Once VOB clears, the lead is ready to come in for intake. This page
// is the command center for scheduled appointments — today, tomorrow,
// the week ahead, and recent no-shows. Specialists schedule from
// /leads/[id]; managers triage and adjust here.
//
// Status flow:
//   scheduled -> intake is on the books
//   completed -> patient walked in (close the loop, often paired with outcome=won)
//   no_show   -> patient didn't make it (track for follow-up campaigns)
//   rescheduled -> appointment moved (intake_scheduled_at gets bumped)
//   cancelled -> called off

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  Calendar, Loader2, Phone, ChevronRight, User as UserIcon,
  CheckCircle2, XCircle, Clock, AlertCircle, ShieldCheck, Filter,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";
import { logAudit } from "@/lib/audit";

type IntakeStatus = "scheduled" | "completed" | "no_show" | "rescheduled" | "cancelled";

const STATUS_LABEL: Record<IntakeStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  no_show: "No-show",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<IntakeStatus, string> = {
  scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  no_show: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  rescheduled: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  cancelled: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
};

interface IntakeRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  insurance_provider: string | null;
  vob_status: string | null;
  intake_scheduled_at: string;
  intake_status: IntakeStatus | null;
  intake_location: string | null;
  intake_notes: string | null;
  intake_completed_at: string | null;
  intake_no_show_at: string | null;
  scheduler: { full_name: string | null; email: string | null } | null;
  owner: { full_name: string | null; email: string | null } | null;
}

type RangeKey = "today" | "tomorrow" | "this_week" | "next_week" | "past_7d" | "all";

const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  next_week: "Next week",
  past_7d: "Past 7 days",
  all: "All",
};

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeStr(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function rangeBounds(range: RangeKey): { gte?: string; lt?: string } {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDayAfter = new Date(startOfTomorrow); startOfDayAfter.setDate(startOfDayAfter.getDate() + 1);
  // Sunday-start "this week"
  const startOfThisWeek = new Date(startOfToday); startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());
  const startOfNextWeek = new Date(startOfThisWeek); startOfNextWeek.setDate(startOfNextWeek.getDate() + 7);
  const startOfWeekAfter = new Date(startOfNextWeek); startOfWeekAfter.setDate(startOfWeekAfter.getDate() + 7);
  const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  switch (range) {
    case "today": return { gte: startOfToday.toISOString(), lt: startOfTomorrow.toISOString() };
    case "tomorrow": return { gte: startOfTomorrow.toISOString(), lt: startOfDayAfter.toISOString() };
    case "this_week": return { gte: startOfThisWeek.toISOString(), lt: startOfNextWeek.toISOString() };
    case "next_week": return { gte: startOfNextWeek.toISOString(), lt: startOfWeekAfter.toISOString() };
    case "past_7d": return { gte: past7d.toISOString(), lt: now.toISOString() };
    case "all": return {};
  }
}

export default function OpsIntakes() {
  const { user } = useAuth();
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("this_week");
  const [statusFilter, setStatusFilter] = useState<IntakeStatus | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { gte, lt } = rangeBounds(range);
    let q = supabase
      .from("leads")
      .select(`
        id, first_name, last_name, primary_phone_normalized,
        insurance_provider, vob_status,
        intake_scheduled_at, intake_status, intake_location, intake_notes,
        intake_completed_at, intake_no_show_at,
        scheduler:profiles!leads_intake_scheduled_by_fkey(full_name, email),
        owner:profiles!leads_owner_id_fkey(full_name, email)
      `)
      .not("intake_scheduled_at", "is", null)
      .order("intake_scheduled_at", { ascending: true })
      .limit(300);
    if (gte) q = q.gte("intake_scheduled_at", gte);
    if (lt) q = q.lt("intake_scheduled_at", lt);
    if (statusFilter !== "all") q = q.eq("intake_status", statusFilter);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as IntakeRow[]);
    setLoading(false);
  }, [range, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, IntakeRow[]>();
    for (const r of rows) {
      const k = dayKey(r.intake_scheduled_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [rows]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const k = r.intake_status ?? "scheduled";
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  async function setStatus(leadId: string, status: IntakeStatus) {
    const update: Record<string, unknown> = { intake_status: status };
    if (status === "completed") {
      update.intake_completed_at = new Date().toISOString();
      update.intake_completed_by = user?.id ?? null;
    } else if (status === "no_show") {
      update.intake_no_show_at = new Date().toISOString();
    }
    const { error: e } = await supabase.from("leads").update(update).eq("id", leadId);
    if (e) {
      setError(e.message);
      return;
    }
    logAudit("intake.status", { lead_id: leadId, status });
    load();
  }

  return (
    <PageShell
      number="05"
      eyebrow="INTAKE"
      title="Intake schedule"
      subtitle="Patients scheduled for intake. Verify the day's appointments are still on, mark walk-ins completed, flag no-shows for follow-up campaigns."
      maxWidth={1400}
    >
      <div className="flex gap-2 flex-wrap items-center">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(["today", "tomorrow", "this_week", "next_week", "past_7d", "all"] as const).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="h-8">
            {RANGE_LABEL[r]}
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {(["all", "scheduled", "completed", "no_show", "rescheduled", "cancelled"] as const).map((s) => {
          const c = s === "all" ? rows.length : statusCounts[s] ?? 0;
          return (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)} className="h-8">
              {s === "all" ? "All" : STATUS_LABEL[s]}
              {statusFilter === s && <span className="ml-1.5 opacity-70">{c}</span>}
            </Button>
          );
        })}
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading schedule…
        </CardContent></Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && rows.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground space-y-2">
            <Calendar className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>No intakes in this range.</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {grouped.map(([day, dayRows]) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> {day}
                </span>
                <Badge variant="outline" className="text-[10px]">{dayRows.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {dayRows.map((r) => (
                  <IntakeRowCard key={r.id} row={r} onSetStatus={(s) => setStatus(r.id, s)} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

function IntakeRowCard({ row, onSetStatus }: { row: IntakeRow; onSetStatus: (s: IntakeStatus) => void }) {
  const status = row.intake_status ?? "scheduled";
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "(unnamed)";
  const isPast = new Date(row.intake_scheduled_at).getTime() < Date.now();
  return (
    <div className="border rounded-md p-3 flex items-start gap-3">
      <div className="w-16 text-sm font-medium tabular-nums shrink-0 pt-0.5">
        {timeStr(row.intake_scheduled_at)}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/leads/${row.id}`} className="font-medium truncate hover:underline">{name}</Link>
          <Badge variant="secondary" className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          {row.vob_status === "verified_in_network" && (
            <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="w-3 h-3" /> VOB ✓
            </Badge>
          )}
          {row.vob_status === "verified_out_of_network" && (
            <Badge variant="outline" className="text-[10px] gap-1 border-rose-500/40 text-rose-700 dark:text-rose-400">
              <ShieldCheck className="w-3 h-3" /> OON
            </Badge>
          )}
          {(row.vob_status === "pending" || row.vob_status === "in_progress") && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-3 h-3" /> VOB unfinished
            </Badge>
          )}
          {row.intake_location && <Badge variant="outline" className="text-[10px]">{row.intake_location}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          {row.primary_phone_normalized && (
            <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {row.primary_phone_normalized}</span>
          )}
          {row.insurance_provider && <span>· {row.insurance_provider}</span>}
          {row.owner && (
            <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> {row.owner.full_name ?? row.owner.email}</span>
          )}
          {row.scheduler && row.scheduler.full_name !== row.owner?.full_name && (
            <span className="text-[10px]">· scheduled by {row.scheduler.full_name ?? row.scheduler.email}</span>
          )}
        </div>
        {row.intake_notes && <div className="text-xs text-muted-foreground line-clamp-2">{row.intake_notes}</div>}
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        {status === "scheduled" && (
          <>
            {isPast && (
              <Button size="sm" variant="default" onClick={() => onSetStatus("completed")} className="h-8 gap-1">
                <CheckCircle2 className="w-3 h-3" /> Done
              </Button>
            )}
            {isPast && (
              <Button size="sm" variant="outline" onClick={() => onSetStatus("no_show")} className="h-8 gap-1">
                <XCircle className="w-3 h-3" /> No-show
              </Button>
            )}
          </>
        )}
        <Link href={`/leads/${row.id}`}>
          <Button size="sm" variant="ghost" className="h-8 gap-1">
            Lead <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
