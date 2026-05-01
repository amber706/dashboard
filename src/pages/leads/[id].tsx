import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  User as UserIcon, Phone, Loader2, ChevronRight, Clock, History,
  Sparkles, Activity, Trophy, XCircle, ArrowLeft, ExternalLink,
  CheckCircle2, AlertTriangle, Send, Edit3, Save, X as XIcon,
  PhoneOff, ShieldAlert, Voicemail, Headphones,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_STATUS_PICKLIST, LEAD_SCORE_RATING_PICKLIST, LEVEL_OF_CARE_PICKLIST, INSURANCE_PROVIDER_PICKLIST } from "@/lib/zoho-picklists";
import { supabase } from "@/lib/supabase";
import { useAuditView } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Lead {
  id: string;
  zoho_lead_id: string | null;
  first_name: string | null;
  last_name: string | null;
  primary_phone: string | null;
  primary_phone_normalized: string | null;
  email: string | null;
  stage: string | null;
  outcome_category: "won" | "lost" | "in_progress" | null;
  outcome_set_at: string | null;
  insurance_provider: string | null;
  insurance_qualified: boolean | null;
  program_interest: string[] | null;
  urgency: string | null;
  relationship_to_patient: string | null;
  callback_preference: string | null;
  first_touch_source_category: string | null;
  first_touch_medium: string | null;
  first_touch_campaign: string | null;
  notes: string | null;
  is_active: boolean | null;
  lead_score: string | null;
  member_id: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  owner: { id: string; full_name: string | null; email: string | null } | null;
}

interface CallRow {
  id: string;
  ctm_call_id: string;
  status: string;
  started_at: string | null;
  talk_seconds: number | null;
  ctm_raw_payload: any;
  callback_status: string | null;
  callback_completed_at: string | null;
  callback_notes: string | null;
  manager_notes: string | null;
  specialist_disposition: string | null;
  score: { composite_score: number | null; needs_supervisor_review: boolean } | null;
}

interface AlertRow {
  id: string;
  call_session_id: string;
  alert_type: string;
  severity: string;
  status: string;
  trigger_excerpt: string;
  classified_at: string;
}

interface OutcomeEvent {
  id: string;
  from_stage: string | null;
  to_stage: string | null;
  from_category: string | null;
  to_category: string | null;
  transitioned_at: string;
  source: string;
}

interface ExtractionRow {
  field_name: string;
  extracted_value: string | null;
  confidence: number;
  status: string;
  updated_at: string;
}

const OUTCOME_CLASS: Record<string, string> = {
  won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  lost: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

const OUTCOME_LABEL: Record<string, string> = {
  won: "Admitted",
  lost: "Churned",
  in_progress: "In progress",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

export default function LeadDetail() {
  const params = useParams();
  const leadId = (params as any).id ?? "";
  useAuditView("lead", leadId);

  const [lead, setLead] = useState<Lead | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [events, setEvents] = useState<OutcomeEvent[]>([]);
  const [extractions, setExtractions] = useState<ExtractionRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const { toast } = useToast();

  async function pushToZoho() {
    if (!lead) return;
    setPushing(true);
    try {
      const { data, error } = await supabase.functions.invoke("zoho-writeback", {
        body: { lead_id: lead.id },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "zoho-writeback failed");
      toast({ title: "Pushed to Zoho", description: `${data.action ?? "synced"}: ${data.zoho_lead_id ?? lead.id}` });
      // Re-fetch the lead so the new zoho_lead_id (if any) shows up.
      const { data: refreshed } = await supabase.from("leads").select(`*, owner:profiles!leads_owner_id_fkey(full_name, email)`).eq("id", lead.id).maybeSingle();
      if (refreshed) setLead(refreshed as unknown as Lead);
    } catch (e) {
      toast({ title: "Push failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setPushing(false);
    }
  }

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const [leadRes, callsRes, eventsRes, extRes] = await Promise.all([
        supabase
          .from("leads")
          .select(`*, owner:profiles!leads_owner_id_fkey(full_name, email)`)
          .eq("id", leadId)
          .maybeSingle(),
        supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, status, started_at, talk_seconds, ctm_raw_payload,
            callback_status, callback_completed_at, callback_notes, manager_notes,
            specialist_disposition,
            score:call_scores(composite_score, needs_supervisor_review)`)
          .eq("lead_id", leadId)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(50),
        supabase
          .from("lead_outcome_events")
          .select("*")
          .eq("lead_id", leadId)
          .order("transitioned_at", { ascending: false })
          .limit(50),
        supabase
          .from("field_extractions")
          .select("field_name, extracted_value, confidence, status, updated_at")
          .eq("lead_id", leadId)
          .not("extracted_value", "is", null)
          .order("confidence", { ascending: false }),
      ]);
      if (cancelled) return;
      if (leadRes.error || !leadRes.data) {
        setError(leadRes.error?.message ?? "Lead not found");
        setLoading(false);
        return;
      }
      setLead(leadRes.data as unknown as Lead);
      const callRows = ((callsRes.data ?? []) as any[]).map((c) => ({ ...c, score: Array.isArray(c.score) ? c.score[0] : c.score })) as CallRow[];
      setCalls(callRows);
      setEvents((eventsRes.data ?? []) as OutcomeEvent[]);
      setExtractions((extRes.data ?? []) as ExtractionRow[]);

      // Fetch alerts for any call belonging to this lead. Done after calls load
      // so we have the call IDs to filter on.
      const callIds = callRows.map((c) => c.id);
      if (callIds.length > 0) {
        const { data: alertRows } = await supabase
          .from("high_priority_alerts")
          .select("id, call_session_id, alert_type, severity, status, trigger_excerpt, classified_at")
          .in("call_session_id", callIds)
          .order("classified_at", { ascending: false });
        if (!cancelled) setAlerts((alertRows ?? []) as AlertRow[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading lead…
        </CardContent></Card>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-destructive">{error ?? "Lead not found"}</p>
            <Link href="/admin/leads"><Button variant="outline" size="sm">Back to leads</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.primary_phone_normalized || "Unknown lead";
  const cat = lead.outcome_category ?? "in_progress";
  const stageEvents = events.filter((e) => e.from_stage !== e.to_stage);
  const timeline = buildTimeline(calls, alerts, extractions, stageEvents);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <Link href="/admin/leads" className="text-xs text-muted-foreground hover:underline flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> All leads
      </Link>

      {/* Identity strip */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold truncate">{displayName}</h1>
                <Badge className={`${OUTCOME_CLASS[cat]} border text-[10px] uppercase`} variant="outline">
                  {OUTCOME_LABEL[cat]}
                </Badge>
                {lead.stage && <Badge variant="outline" className="text-[10px]">stage: {lead.stage}</Badge>}
                {lead.is_active === false && <Badge variant="outline" className="text-[10px] opacity-60">inactive</Badge>}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                {lead.primary_phone_normalized && (
                  <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {lead.primary_phone_normalized}</span>
                )}
                {lead.email && <span>{lead.email}</span>}
                {lead.owner && (
                  <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" /> {lead.owner.full_name ?? lead.owner.email}</span>
                )}
                <span>created {fmtDate(lead.created_at)}</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={pushToZoho} disabled={pushing} className="gap-1.5" title={lead.zoho_lead_id ? "Update existing Zoho lead with current data" : "Create a new Zoho lead from this record"}>
                {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {lead.zoho_lead_id ? "Update Zoho" : "Push to Zoho"}
              </Button>
              {lead.zoho_lead_id && (
                <a
                  href={`https://crm.zoho.com/crm/tab/Leads/${lead.zoho_lead_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex"
                >
                  <Button variant="outline" size="sm" className="gap-1">
                    Open in Zoho <ExternalLink className="w-3 h-3" />
                  </Button>
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: unified timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4" /> Timeline
                <Badge variant="outline" className="text-[10px] ml-1">{timeline.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No activity recorded for this lead yet.</p>
              ) : (
                <Timeline events={timeline} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: facts (editable) + extractions + notes */}
        <div className="space-y-4">
          <EditableLeadFacts lead={lead} onSaved={(updated) => setLead(updated)} />

          {(lead.first_touch_source_category || lead.first_touch_campaign) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Marketing attribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {lead.first_touch_source_category && (
                  <FactRow label="First touch" value={`${lead.first_touch_source_category}${lead.first_touch_medium ? ` / ${lead.first_touch_medium}` : ""}`} />
                )}
                {lead.first_touch_campaign && (
                  <FactRow label="Campaign" value={lead.first_touch_campaign} />
                )}
              </CardContent>
            </Card>
          )}

          {extractions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Captured from calls
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  {extractions.slice(0, 12).map((f, i) => (
                    <div key={`${f.field_name}-${i}`} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground capitalize">{f.field_name.replace(/_/g, " ")}</div>
                        <div className="truncate">{f.extracted_value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}

type TimelineEventType = "call" | "alert" | "extraction_burst" | "stage_change" | "callback";

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  ts: string;
  // Render payload (kept loose since each type is a different shape)
  payload: any;
}

function buildTimeline(
  calls: CallRow[],
  alerts: AlertRow[],
  extractions: ExtractionRow[],
  stageEvents: OutcomeEvent[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const c of calls) {
    if (c.started_at) {
      events.push({ id: `call-${c.id}`, type: "call", ts: c.started_at, payload: c });
    }
    if (c.callback_completed_at && c.callback_status) {
      events.push({
        id: `cb-${c.id}`,
        type: "callback",
        ts: c.callback_completed_at,
        payload: { call: c, status: c.callback_status, notes: c.callback_notes },
      });
    }
  }

  for (const a of alerts) {
    events.push({ id: `alert-${a.id}`, type: "alert", ts: a.classified_at, payload: a });
  }

  for (const e of stageEvents) {
    events.push({ id: `stage-${e.id}`, type: "stage_change", ts: e.transitioned_at, payload: e });
  }

  // Group field extractions by day so we don't flood the feed with one row per
  // captured field (extractions land in batches when score-call processes a transcript).
  const byDay = new Map<string, ExtractionRow[]>();
  for (const f of extractions) {
    const day = (f.updated_at ?? "").slice(0, 10);
    if (!day) continue;
    const arr = byDay.get(day) ?? [];
    arr.push(f);
    byDay.set(day, arr);
  }
  for (const [day, fields] of byDay.entries()) {
    // Use the latest updated_at within the day as the event timestamp.
    const latest = fields.reduce((acc, f) => f.updated_at > acc ? f.updated_at : acc, fields[0].updated_at);
    events.push({
      id: `ext-${day}`,
      type: "extraction_burst",
      ts: latest,
      payload: { day, fields },
    });
  }

  return events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="space-y-3">
      {events.map((e) => <TimelineRow key={e.id} event={e} />)}
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  if (event.type === "call") {
    const c = event.payload as CallRow;
    const agent = c.ctm_raw_payload?.agent;
    const agentName = agent?.name ?? agent?.email ?? null;
    const Icon = c.status === "voicemail" ? Voicemail : c.status === "missed" || c.status === "abandoned" ? PhoneOff : Headphones;
    const iconColor = c.status === "voicemail" ? "text-blue-500" : c.status === "missed" || c.status === "abandoned" ? "text-rose-500" : "text-emerald-500";
    return (
      <div className="space-y-1">
        <Link href={`/live/${c.id}`} className="block">
          <div className="flex items-start gap-3 text-sm hover:bg-accent/50 transition-colors rounded px-2 -mx-2 py-1.5">
            <Icon className={`w-4 h-4 ${iconColor} shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">Call</span>
                <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                {c.specialist_disposition && (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {c.specialist_disposition.replace(/_/g, " ")}
                  </Badge>
                )}
                {c.score?.needs_supervisor_review && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 gap-1">
                    <AlertTriangle className="w-3 h-3" /> needs review
                  </Badge>
                )}
                {c.score?.composite_score != null && (
                  <span className={`text-xs font-semibold tabular-nums ${scoreColor(c.score.composite_score)}`}>{c.score.composite_score}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                {fmtTime(c.started_at)}
                <span>· <Clock className="w-3 h-3 inline-block" /> {fmtDur(c.talk_seconds)}</span>
                {agentName && <span>· {agentName}</span>}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          </div>
        </Link>
        {c.manager_notes && (
          <div className="ml-7 text-xs bg-amber-500/10 border border-amber-500/30 rounded p-2 text-amber-900 dark:text-amber-200">
            <span className="font-semibold uppercase text-[10px] tracking-wide">Coaching note · </span>
            {c.manager_notes}
          </div>
        )}
      </div>
    );
  }

  if (event.type === "alert") {
    const a = event.payload as AlertRow;
    return (
      <div className="flex items-start gap-3 text-sm px-2 -mx-2 py-1.5">
        <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Alert</span>
            <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">
              {a.alert_type.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{a.severity}</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{a.status}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{fmtTime(a.classified_at)}</div>
          <p className="text-xs italic text-muted-foreground mt-1 line-clamp-2">"{a.trigger_excerpt}"</p>
        </div>
      </div>
    );
  }

  if (event.type === "callback") {
    const { call, status, notes } = event.payload as { call: CallRow; status: string; notes: string | null };
    const ok = status === "completed";
    return (
      <div className="flex items-start gap-3 text-sm px-2 -mx-2 py-1.5">
        {ok
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          : <XCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Callback</span>
            <Badge variant="outline" className="text-[10px] capitalize">{status}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {fmtTime(call.callback_completed_at)} (re: <Link href={`/live/${call.id}`} className="text-primary hover:underline">{fmtTime(call.started_at)}</Link>)
          </div>
          {notes && <p className="text-xs italic text-muted-foreground mt-1">"{notes}"</p>}
        </div>
      </div>
    );
  }

  if (event.type === "stage_change") {
    const e = event.payload as OutcomeEvent;
    const Icon = e.to_category === "won" ? Trophy : e.to_category === "lost" ? XCircle : Activity;
    const iconColor = e.to_category === "won" ? "text-emerald-500" : e.to_category === "lost" ? "text-rose-500" : "text-blue-500";
    return (
      <div className="flex items-start gap-3 text-sm px-2 -mx-2 py-1.5">
        <Icon className={`w-4 h-4 ${iconColor} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Stage</span>
            {e.from_stage && <span className="text-xs text-muted-foreground">{e.from_stage} →</span>}
            <span className="text-sm font-medium">{e.to_stage ?? "—"}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {fmtTime(e.transitioned_at)} · via {e.source}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "extraction_burst") {
    const { fields } = event.payload as { day: string; fields: ExtractionRow[] };
    return (
      <div className="flex items-start gap-3 text-sm px-2 -mx-2 py-1.5">
        <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Captured from call</span>
            <Badge variant="outline" className="text-[10px]">{fields.length} field{fields.length === 1 ? "" : "s"}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{fmtTime(event.ts)}</div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {fields.slice(0, 6).map((f, i) => (
              <span key={`${f.field_name}-${i}`} className="capitalize">
                <span className="opacity-70">{f.field_name.replace(/_/g, " ")}:</span>{" "}
                <span className="text-foreground">{f.extracted_value}</span>
              </span>
            ))}
            {fields.length > 6 && <span className="opacity-60">+{fields.length - 6} more</span>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

const EDITABLE_URGENCY = ["", "high", "medium", "low"];
const EDITABLE_RELATIONSHIP = ["", "self", "parent", "spouse", "child", "sibling", "friend", "other"];
const EDITABLE_CALLBACK = ["", "morning", "afternoon", "evening", "anytime", "do_not_call"];

function EditableLeadFacts({ lead, onSaved }: { lead: Lead; onSaved: (lead: Lead) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Local form state — initialized from the lead prop, reset on cancel.
  const initial = () => ({
    first_name: lead.first_name ?? "",
    last_name: lead.last_name ?? "",
    email: lead.email ?? "",
    insurance_provider: lead.insurance_provider ?? "",
    insurance_qualified: lead.insurance_qualified,
    urgency: lead.urgency ?? "",
    relationship_to_patient: lead.relationship_to_patient ?? "",
    callback_preference: lead.callback_preference ?? "",
    // Single-value editor backed by an array column — the Zoho field
    // it maps to (Level_of_Care_Requested) is a single picklist.
    program_interest: (lead.program_interest && lead.program_interest[0]) ?? "",
    stage: lead.stage ?? "",
    notes: lead.notes ?? "",
    lead_score: lead.lead_score ?? "",
    member_id: lead.member_id ?? "",
    owner_id: lead.owner_id ?? "",
  });
  const [form, setForm] = useState(initial);
  function reset() { setForm(initial()); }

  // Active admissions reps for the Owner dropdown — loaded once on mount.
  interface RepOption { id: string; full_name: string | null; email: string | null }
  const [reps, setReps] = useState<RepOption[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .in("role", ["specialist", "manager", "admin"])
        .order("full_name");
      setReps((data ?? []) as RepOption[]);
    })();
  }, []);

  async function save() {
    setSaving(true);
    const patch: Record<string, unknown> = {
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      email: form.email.trim() || null,
      insurance_provider: form.insurance_provider.trim() || null,
      insurance_qualified: form.insurance_qualified,
      urgency: form.urgency || null,
      relationship_to_patient: form.relationship_to_patient || null,
      callback_preference: form.callback_preference || null,
      program_interest: form.program_interest ? [form.program_interest] : null,
      stage: form.stage || null,
      notes: form.notes.trim() || null,
      lead_score: form.lead_score || null,
      member_id: form.member_id.trim() || null,
      owner_id: form.owner_id || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", lead.id)
      .select(`*, owner:profiles!leads_owner_id_fkey(full_name, email)`)
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: "Lead fields updated. Use 'Update Zoho' to push." });
    onSaved(data as unknown as Lead);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Facts on file</span>
          {!editing
            ? <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={() => { reset(); setEditing(true); }}>
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </Button>
            : <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={() => { reset(); setEditing(false); }} disabled={saving}>
                  <XIcon className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button size="sm" className="h-7 px-2 gap-1" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </Button>
              </div>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {editing ? (
          <>
            <FieldPair label="First name">
              <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="h-8 text-sm" />
            </FieldPair>
            <FieldPair label="Last name">
              <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="h-8 text-sm" />
            </FieldPair>
            <FieldPair label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-8 text-sm" />
            </FieldPair>
            <FieldPair label="Insurance provider (→ Zoho picklist)">
              <PicklistSelect
                value={form.insurance_provider}
                options={INSURANCE_PROVIDER_PICKLIST}
                onChange={(v) => setForm({ ...form, insurance_provider: v })}
              />
            </FieldPair>
            <FieldPair label="Member ID (→ Zoho Member_ID)">
              <Input value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })} placeholder="Insurance policy / member number" className="h-8 text-sm" />
            </FieldPair>
            <FieldPair label="Admissions rep (lead owner → Zoho Owner)">
              <select
                value={form.owner_id}
                onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
                className="h-8 px-2 rounded-md border bg-background text-sm w-full"
              >
                <option value="">— None —</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name ?? r.email ?? r.id}
                  </option>
                ))}
              </select>
            </FieldPair>
            <FieldPair label="Insurance qualified">
              <select
                value={form.insurance_qualified == null ? "" : String(form.insurance_qualified)}
                onChange={(e) => setForm({ ...form, insurance_qualified: e.target.value === "" ? null : e.target.value === "true" })}
                className="h-8 px-2 rounded-md border bg-background text-sm w-full"
              >
                <option value="">Unknown</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </FieldPair>
            <FieldPair label="Urgency">
              <select
                value={form.urgency}
                onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                className="h-8 px-2 rounded-md border bg-background text-sm w-full"
              >
                {EDITABLE_URGENCY.map((u) => <option key={u} value={u}>{u || "—"}</option>)}
              </select>
            </FieldPair>
            <FieldPair label="Relationship to patient">
              <select
                value={form.relationship_to_patient}
                onChange={(e) => setForm({ ...form, relationship_to_patient: e.target.value })}
                className="h-8 px-2 rounded-md border bg-background text-sm w-full"
              >
                {EDITABLE_RELATIONSHIP.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
              </select>
            </FieldPair>
            <FieldPair label="Callback preference">
              <select
                value={form.callback_preference}
                onChange={(e) => setForm({ ...form, callback_preference: e.target.value })}
                className="h-8 px-2 rounded-md border bg-background text-sm w-full"
              >
                {EDITABLE_CALLBACK.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ") || "—"}</option>)}
              </select>
            </FieldPair>
            <FieldPair label="Requested level of care (→ Zoho Level_of_Care_Requested)">
              <PicklistSelect
                value={form.program_interest}
                options={LEVEL_OF_CARE_PICKLIST}
                onChange={(v) => setForm({ ...form, program_interest: v })}
              />
            </FieldPair>
            <FieldPair label="Interaction status (→ Zoho Lead_Status)">
              <PicklistSelect
                value={form.stage}
                options={LEAD_STATUS_PICKLIST}
                onChange={(v) => setForm({ ...form, stage: v })}
              />
            </FieldPair>
            <FieldPair label="Lead score (→ Zoho Lead_Score_Rating)">
              <PicklistSelect
                value={form.lead_score}
                options={LEAD_SCORE_RATING_PICKLIST}
                onChange={(v) => setForm({ ...form, lead_score: v })}
              />
            </FieldPair>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Notes</div>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="text-sm min-h-[70px]" />
            </div>
          </>
        ) : (
          <>
            <FactRow label="First name" value={lead.first_name ?? "—"} />
            <FactRow label="Last name" value={lead.last_name ?? "—"} />
            <FactRow label="Email" value={lead.email ?? "—"} />
            <FactRow label="Insurance provider" value={lead.insurance_provider ?? "—"} />
            <FactRow label="Member ID" value={lead.member_id ?? "—"} />
            <FactRow label="Admissions rep" value={lead.owner?.full_name ?? lead.owner?.email ?? "—"} />
            <FactRow label="Insurance qualified" value={lead.insurance_qualified == null ? "—" : (lead.insurance_qualified ? "Yes" : "No")} />
            <FactRow label="Urgency" value={lead.urgency ?? "—"} />
            <FactRow label="Relationship to patient" value={lead.relationship_to_patient ?? "—"} />
            <FactRow label="Callback preference" value={lead.callback_preference ?? "—"} />
            <FactRow label="Requested level of care" value={lead.program_interest && lead.program_interest.length > 0 ? lead.program_interest.join(", ") : "—"} />
            <FactRow label="Interaction status" value={lead.stage ?? "—"} />
            <FactRow label="Lead score rating" value={lead.lead_score ?? "—"} />
            {lead.notes && (
              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground mb-1">Notes</div>
                <div className="text-sm whitespace-pre-wrap">{lead.notes}</div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FieldPair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

// Renders a Zoho-picklist dropdown. If the current value isn't in the
// canonical picklist (legacy data, manual entry, etc), it's shown as
// the selected option with a "(legacy)" suffix so it stays preserved
// until the manager actively picks a canonical value.
function PicklistSelect({ value, options, onChange }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const isLegacy = !!value && !options.includes(value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 px-2 rounded-md border bg-background text-sm w-full"
    >
      <option value="">— None —</option>
      {isLegacy && <option value={value}>{value} (current — not in Zoho picklist)</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
