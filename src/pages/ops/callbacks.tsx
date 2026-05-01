import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  PhoneOff, Loader2, Phone, Clock, CheckCircle2, X, Voicemail,
  AlertTriangle, ChevronDown, ChevronRight, Activity, MessageSquare, Download,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type CbStatus = "pending" | "completed" | "skipped" | "unreachable";

interface CallbackRow {
  id: string;
  ctm_call_id: string;
  status: string;                      // call_sessions.status — missed/abandoned/voicemail
  caller_phone_normalized: string | null;
  caller_name: string | null;
  started_at: string | null;
  ring_seconds: number | null;
  ctm_raw_payload: any;
  callback_status: CbStatus | null;
  callback_completed_at: string | null;
  callback_notes: string | null;
  lead: { id: string; outcome_category: string | null; first_name: string | null; last_name: string | null } | null;
  callback_completed_by_profile: { full_name: string | null; email: string | null } | null;
}

const STATUS_LABEL: Record<CbStatus, string> = {
  pending: "Pending",
  completed: "Called back",
  skipped: "Skipped",
  unreachable: "Unreachable",
};

const STATUS_CLASS: Record<CbStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  skipped: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  unreachable: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ageSince(s: string | null): string {
  if (!s) return "—";
  const ms = Date.now() - new Date(s).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function OpsCallbacks() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CbStatus | "all">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("call_sessions")
      .select(`
        id, ctm_call_id, status, caller_phone_normalized, caller_name,
        started_at, ring_seconds, ctm_raw_payload,
        callback_status, callback_completed_at, callback_notes,
        lead:leads!call_sessions_lead_id_fkey(id, outcome_category, first_name, last_name),
        callback_completed_by_profile:profiles!call_sessions_callback_completed_by_fkey(full_name, email)
      `)
      // Include both:
      //  - missed/abandoned/voicemail calls (auto-flagged for callback)
      //  - answered calls the specialist explicitly dispositioned as needs_callback
      // The trigger from migration 030 sets callback_status=pending on the latter.
      .or("status.in.(missed,abandoned,voicemail),specialist_disposition.eq.needs_callback")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (filter !== "all") q = q.eq("callback_status", filter);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as CallbackRow[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Audit: viewing the callback queue exposes caller PHI.
  useEffect(() => {
    logAudit("view", "callbacks", null, { filter, surface: "callback_queue" });
  }, [filter]);

  // Top-line counts (across all statuses, not the current filter, so the
  // tile counts stay stable as the filter changes).
  const [counts, setCounts] = useState({ pending: 0, completed_today: 0, breached: 0, total: 0 });
  useEffect(() => {
    (async () => {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const breachedCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // pending > 1h
      const [pending, completedToday, breached, total] = await Promise.all([
        supabase.from("call_sessions").select("id", { count: "exact", head: true })
          .or("status.in.(missed,abandoned,voicemail),specialist_disposition.eq.needs_callback")
          .eq("callback_status", "pending"),
        supabase.from("call_sessions").select("id", { count: "exact", head: true })
          .eq("callback_status", "completed")
          .gte("callback_completed_at", startOfDay.toISOString()),
        supabase.from("call_sessions").select("id", { count: "exact", head: true })
          .or("status.in.(missed,abandoned,voicemail),specialist_disposition.eq.needs_callback")
          .eq("callback_status", "pending")
          .lt("started_at", breachedCutoff),
        supabase.from("call_sessions").select("id", { count: "exact", head: true })
          .or("status.in.(missed,abandoned,voicemail),specialist_disposition.eq.needs_callback"),
      ]);
      setCounts({
        pending: pending.count ?? 0,
        completed_today: completedToday.count ?? 0,
        breached: breached.count ?? 0,
        total: total.count ?? 0,
      });
    })();
  }, [rows]);

  async function setStatus(rowId: string, status: CbStatus, notes?: string) {
    setSavingId(rowId);
    const patch: Record<string, unknown> = { callback_status: status };
    if (status === "completed" || status === "skipped" || status === "unreachable") {
      patch.callback_completed_at = new Date().toISOString();
      if (user?.id) patch.callback_completed_by = user.id;
    } else {
      patch.callback_completed_at = null;
      patch.callback_completed_by = null;
    }
    if (notes !== undefined) patch.callback_notes = notes.trim() || null;
    await supabase.from("call_sessions").update(patch).eq("id", rowId);
    setSavingId(null);
    load();
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <PhoneOff className="w-6 h-6" /> Callback queue
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Missed, abandoned, and voicemail calls waiting to be returned. Mark each one as you work it.
        </p>
      </div>

      {/* Top tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Pending" value={counts.pending} accent={counts.pending > 0 ? "amber" : undefined}
          active={filter === "pending"} onClick={() => setFilter(filter === "pending" ? "all" : "pending")} />
        <Tile label="SLA breached (>1h pending)" value={counts.breached} accent={counts.breached > 0 ? "rose" : undefined} />
        <Tile label="Completed today" value={counts.completed_today} accent="emerald" />
        <Tile label="Total this window" value={counts.total} />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {(["pending", "completed", "skipped", "unreachable", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : STATUS_LABEL[f]}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0}
          className="ml-auto gap-1.5"
          onClick={() => { logAudit("export", "callbacks", null, { format: "csv", count: rows.length, filter }); downloadCsv(`callbacks-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
            { key: "caller_name", label: "Caller name" },
            { key: "caller_phone_normalized", label: "Phone" },
            { key: "started_at", label: "Call time", format: (v) => v ? new Date(v).toISOString() : "" },
            { key: "status", label: "Call status" },
            { key: "callback_status", label: "Callback status" },
            { key: "callback_completed_at", label: "Completed at", format: (v) => v ? new Date(v).toISOString() : "" },
            { key: "callback_completed_by_profile", label: "Completed by", format: (v) => v?.full_name ?? v?.email ?? "" },
            { key: "callback_notes", label: "Notes" },
            { key: "ctm_raw_payload", label: "Tracking", format: (v) => v?.tracking_label ?? "" },
            { key: "lead", label: "Outcome", format: (v) => v?.outcome_category ?? "" },
          ]); }}
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading callbacks…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && rows.length === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          No callbacks in this filter. {filter === "pending" && "Inbox zero — nice."}
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const cb = r.callback_status ?? "pending";
          const isOpen = expandedId === r.id;
          const callerName = r.caller_name
            ?? [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ")
            ?? r.caller_phone_normalized
            ?? "Unknown";
          const isVoicemail = r.status === "voicemail";
          const breached = cb === "pending" && r.started_at
            && (Date.now() - new Date(r.started_at).getTime() > 60 * 60 * 1000);

          return (
            <Card key={r.id} className={breached ? "border-l-4 border-l-rose-500" : ""}>
              <CardHeader className="cursor-pointer pb-3" onClick={() => setExpandedId(isOpen ? null : r.id)}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      {isVoicemail
                        ? <Voicemail className="w-4 h-4 text-blue-500 shrink-0" />
                        : <PhoneOff className="w-4 h-4 text-rose-500 shrink-0" />}
                      <span className="font-medium text-sm">{callerName}</span>
                      <Badge className={`${STATUS_CLASS[cb]} text-[10px]`} variant="secondary">{STATUS_LABEL[cb]}</Badge>
                      {breached && (
                        <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400 gap-1">
                          <AlertTriangle className="w-3 h-3" /> SLA breached
                        </Badge>
                      )}
                      {r.lead?.outcome_category && r.lead.outcome_category !== "in_progress" && (
                        <Badge variant="outline" className="text-[10px]">
                          {r.lead.outcome_category === "won" ? "previously admitted" : "previously closed lost"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap pl-6">
                      {r.caller_phone_normalized && (
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.caller_phone_normalized}</span>
                      )}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(r.started_at)} · {ageSince(r.started_at)}</span>
                      {r.ctm_raw_payload?.tracking_label && (
                        <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {r.ctm_raw_payload.tracking_label}</span>
                      )}
                      {r.callback_completed_at && (
                        <span>Worked by {r.callback_completed_by_profile?.full_name ?? r.callback_completed_by_profile?.email ?? "?"} {fmtTime(r.callback_completed_at)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>

              {isOpen && (
                <CardContent className="border-t pt-4 space-y-3">
                  {r.callback_notes && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3" /> Notes
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{r.callback_notes}</p>
                    </div>
                  )}

                  <CallbackNotesField
                    rowId={r.id}
                    initial={r.callback_notes ?? ""}
                    onSave={(notes) => setStatus(r.id, cb, notes)}
                    saving={savingId === r.id}
                  />

                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {cb !== "completed" && (
                      <Button size="sm" disabled={savingId === r.id} onClick={() => setStatus(r.id, "completed")} className="gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark called back
                      </Button>
                    )}
                    {cb !== "unreachable" && (
                      <Button size="sm" variant="outline" disabled={savingId === r.id} onClick={() => setStatus(r.id, "unreachable")} className="gap-1">
                        Unreachable
                      </Button>
                    )}
                    {cb !== "skipped" && (
                      <Button size="sm" variant="outline" disabled={savingId === r.id} onClick={() => setStatus(r.id, "skipped")} className="gap-1">
                        <X className="w-3.5 h-3.5" /> Skip
                      </Button>
                    )}
                    {cb !== "pending" && (
                      <Button size="sm" variant="ghost" disabled={savingId === r.id} onClick={() => setStatus(r.id, "pending")}>
                        Reopen
                      </Button>
                    )}
                    <div className="ml-auto flex gap-2">
                      {r.lead?.id && (
                        <Link href={`/leads/${r.lead.id}`} className="text-xs text-primary hover:underline">Open lead →</Link>
                      )}
                      <Link href={`/live/${r.id}`} className="text-xs text-primary hover:underline">Open call →</Link>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CallbackNotesField({ rowId, initial, onSave, saving }: {
  rowId: string;
  initial: string;
  onSave: (notes: string) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(initial);
  // Reset when the row changes (caller switched expanded row).
  useEffect(() => { setVal(initial); }, [rowId, initial]);
  const dirty = val.trim() !== (initial ?? "").trim();
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Notes for this callback</div>
      <Textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="What happened on the callback? Did you reach them? What's next?"
        className="min-h-[60px] text-sm"
      />
      {dirty && (
        <div className="mt-1 flex justify-end">
          <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(val)}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save notes"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent, active, onClick }: {
  label: string;
  value: number;
  accent?: "amber" | "rose" | "emerald";
  active?: boolean;
  onClick?: () => void;
}) {
  const accentClass = accent === "rose"
    ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
    : accent === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15"
      : accent === "emerald"
        ? "border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/15"
        : "";
  const interactive = onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : "";
  const activeClass = active ? "ring-2 ring-primary" : "";
  const Wrapper: any = onClick ? "button" : "div";
  return (
    <Wrapper onClick={onClick} className={`text-left border rounded-lg p-3 ${accentClass} ${interactive} ${activeClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </Wrapper>
  );
}
