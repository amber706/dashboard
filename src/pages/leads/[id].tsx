import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  User as UserIcon, Phone, Loader2, ChevronRight, Clock, History,
  Sparkles, Activity, Trophy, XCircle, ArrowLeft, ExternalLink,
  CheckCircle2, AlertTriangle, Send, Edit3, Save, X as XIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_STATUS_PICKLIST, LEAD_SCORE_RATING_PICKLIST, LEVEL_OF_CARE_PICKLIST } from "@/lib/zoho-picklists";
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
  created_at: string;
  updated_at: string;
  owner: { full_name: string | null; email: string | null } | null;
}

interface CallRow {
  id: string;
  ctm_call_id: string;
  status: string;
  started_at: string | null;
  talk_seconds: number | null;
  ctm_raw_payload: any;
  score: { composite_score: number | null; needs_supervisor_review: boolean } | null;
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
      setCalls(((callsRes.data ?? []) as any[]).map((c) => ({ ...c, score: Array.isArray(c.score) ? c.score[0] : c.score })));
      setEvents((eventsRes.data ?? []) as OutcomeEvent[]);
      setExtractions((extRes.data ?? []) as ExtractionRow[]);
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
        {/* Left: call timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4" /> Calls ({calls.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {calls.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No calls linked to this lead.</p>
              ) : (
                <div className="space-y-1.5">
                  {calls.map((c) => {
                    const agent = c.ctm_raw_payload?.agent;
                    const agentName = agent?.name ?? agent?.email ?? null;
                    return (
                      <Link key={c.id} href={`/live/${c.id}`} className="block">
                        <div className="border-b py-2 text-sm hover:bg-accent/50 transition-colors flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{fmtTime(c.started_at)}</span>
                              <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                              {c.score?.needs_supervisor_review && (
                                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 gap-1">
                                  <AlertTriangle className="w-3 h-3" /> needs review
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <Clock className="w-3 h-3" /> {fmtDur(c.talk_seconds)}
                              {agentName && <span>· {agentName}</span>}
                            </div>
                          </div>
                          {c.score?.composite_score != null && (
                            <span className={`text-sm font-semibold ${scoreColor(c.score.composite_score)}`}>{c.score.composite_score}</span>
                          )}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Outcome event timeline */}
          {stageEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Stage history
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stageEvents.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 text-sm">
                      <div className="pt-0.5">
                        {e.to_category === "won" ? <Trophy className="w-3.5 h-3.5 text-emerald-500" /> :
                         e.to_category === "lost" ? <XCircle className="w-3.5 h-3.5 text-rose-500" /> :
                         <Clock className="w-3.5 h-3.5 text-blue-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          {e.from_stage ? <><span className="text-muted-foreground">{e.from_stage}</span> → </> : null}
                          <span className="font-medium">{e.to_stage ?? "—"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtTime(e.transitioned_at)} · via {e.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
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
  });
  const [form, setForm] = useState(initial);
  function reset() { setForm(initial()); }

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
            <FieldPair label="Insurance provider">
              <Input value={form.insurance_provider} onChange={(e) => setForm({ ...form, insurance_provider: e.target.value })} className="h-8 text-sm" />
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
