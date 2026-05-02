import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { Loader2, Users, Phone, Mail, Calendar, AlertTriangle, ChevronDown, ChevronRight, Headphones, MessageSquare, Sparkles, Search, Send, CheckCircle2, Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Lead {
  id: string;
  zoho_lead_id: string | null;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  primary_phone: string | null;
  email: string | null;
  program_interest: string[] | null;
  insurance_provider: string | null;
  urgency: string | null;
  relationship_to_patient: string | null;
  callback_preference: string | null;
  notes: string | null;
  is_active: boolean;
  outcome_category: "won" | "lost" | "in_progress" | null;
  outcome_set_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CallSummary {
  id: string;
  ctm_call_id: string;
  status: string;
  started_at: string | null;
  talk_seconds: number | null;
  ctm_raw_payload: any;
  score: { composite_score: number | null; needs_supervisor_review: boolean | null } | null;
}

interface FieldExtraction {
  field_name: string;
  extracted_value: string | null;
  confidence: number;
  source_signal: string | null;
  status: string;
  created_at: string;
}

const urgencyClass: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
function zoho_id_display(id: string | null): string | null { return id; }

type OutcomeFilter = "all" | "won" | "lost" | "in_progress";

export default function LeadsView() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("leads")
      .select("id, zoho_lead_id, first_name, last_name, primary_phone_normalized, primary_phone, email, program_interest, insurance_provider, urgency, relationship_to_patient, callback_preference, notes, is_active, outcome_category, outcome_set_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`first_name.ilike.${s},last_name.ilike.${s},primary_phone_normalized.ilike.${s},email.ilike.${s},insurance_provider.ilike.${s}`);
    }
    if (outcomeFilter !== "all") q = q.eq("outcome_category", outcomeFilter);
    const { data, error } = await q;
    if (error) setError(error.message);
    else setLeads((data ?? []) as Lead[]);
    setLoading(false);
  }, [search, outcomeFilter]);

  useEffect(() => { load(); }, [load]);

  // Log a list-view event keyed to the active filter so the audit
  // trail captures which slices got browsed.
  useEffect(() => {
    logAudit("view", "leads", null, { search: search || null, outcome_filter: outcomeFilter, surface: "admin_leads" });
  }, [search, outcomeFilter]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="w-6 h-6" /> Leads
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Callers identified by the AI extractor. Auto-populated from real CTM call transcripts.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, insurance…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "in_progress", "won", "lost"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={outcomeFilter === f ? "default" : "outline"}
              onClick={() => setOutcomeFilter(f)}
            >
              {f === "all" ? "All" : f === "won" ? "Admitted" : f === "lost" ? "Churned" : "In progress"}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { logAudit("export", "leads", null, { format: "csv", count: leads.length, search, outcome_filter: outcomeFilter }); downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, leads, [
            { key: "first_name", label: "First name" },
            { key: "last_name", label: "Last name" },
            { key: "primary_phone_normalized", label: "Phone" },
            { key: "email", label: "Email" },
            { key: "outcome_category", label: "Outcome" },
            { key: "urgency", label: "Urgency" },
            { key: "insurance_provider", label: "Insurance" },
            { key: "relationship_to_patient", label: "Relationship" },
            { key: "callback_preference", label: "Callback pref" },
            { key: "program_interest", label: "Program interest" },
            { key: "is_active", label: "Active" },
            { key: "created_at", label: "Created", format: (v) => v ? new Date(v).toISOString() : "" },
            { key: "updated_at", label: "Updated", format: (v) => v ? new Date(v).toISOString() : "" },
            { key: "zoho_lead_id", label: "Zoho lead ID" },
          ]); }}
          disabled={leads.length === 0}
          className="gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading leads…
        </CardContent></Card>
      )}
      {error && (<Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>)}
      {!loading && !error && leads.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">No leads yet. They populate as call transcripts get extracted.</CardContent></Card>
      )}

      <div className="space-y-2">
        {leads.map((lead) => (
          <LeadRow
            key={lead.id}
            lead={lead}
            expanded={expandedId === lead.id}
            onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
          />
        ))}
      </div>
    </div>
  );
}

function LeadRow({ lead, expanded, onToggle }: { lead: Lead; expanded: boolean; onToggle: () => void }) {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [extractions, setExtractions] = useState<FieldExtraction[] | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; message: string; zohoId?: string } | null>(null);
  const [zohoId, setZohoId] = useState<string | null>(lead.zoho_lead_id);

  async function pushToZoho() {
    setPushing(true);
    setPushResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("zoho-writeback", {
        body: { lead_id: lead.id },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "zoho-writeback failed");
      setPushResult({ ok: true, message: `${data.action ?? "synced"} as Zoho ID ${data.zoho_lead_id}`, zohoId: data.zoho_lead_id });
      if (data.zoho_lead_id) setZohoId(data.zoho_lead_id);
    } catch (e) {
      setPushResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPushing(false);
    }
  }

  useEffect(() => {
    if (!expanded || calls) return;
    (async () => {
      const [callsRes, extRes] = await Promise.all([
        supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, status, started_at, talk_seconds, ctm_raw_payload,
            score:call_scores(composite_score, needs_supervisor_review)`)
          .eq("lead_id", lead.id)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(20),
        supabase
          .from("field_extractions")
          .select("field_name, extracted_value, confidence, source_signal, status, created_at")
          .eq("lead_id", lead.id)
          .order("confidence", { ascending: false })
          .limit(50),
      ]);
      setCalls((callsRes.data ?? []) as unknown as CallSummary[]);
      setExtractions((extRes.data ?? []) as FieldExtraction[]);
    })();
  }, [expanded, lead.id, calls]);

  const displayName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "(no name)";

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <Link
                href={`/leads/${lead.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-base hover:underline"
              >
                {displayName}
              </Link>
              {lead.outcome_category && lead.outcome_category !== "in_progress" && (
                <Badge
                  className={lead.outcome_category === "won"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                    : "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"}
                  variant="outline"
                >
                  {lead.outcome_category === "won" ? "admitted" : "churned"}
                </Badge>
              )}
              {lead.urgency && (
                <Badge className={urgencyClass[lead.urgency] ?? ""} variant="secondary">{lead.urgency} urgency</Badge>
              )}
              {lead.relationship_to_patient && lead.relationship_to_patient !== "self" && (
                <Badge variant="outline" className="text-xs">calling for {lead.relationship_to_patient}</Badge>
              )}
              {!lead.is_active && <Badge variant="outline" className="text-xs">inactive</Badge>}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              {(lead.primary_phone_normalized || lead.primary_phone) && (
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {lead.primary_phone_normalized ?? lead.primary_phone}</span>
              )}
              {lead.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {lead.email}</span>}
              {lead.insurance_provider && <span>Insurance: <span className="font-medium text-foreground">{lead.insurance_provider}</span></span>}
              {lead.program_interest && lead.program_interest.length > 0 && (
                <span>Programs: <span className="font-medium text-foreground">{lead.program_interest.join(", ")}</span></span>
              )}
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Updated {fmtTime(lead.updated_at)}</span>
            </div>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-5">
          {!calls || !extractions ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading lead details…
            </div>
          ) : (
            <>
              {extractions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" /> Extracted fields ({extractions.length})
                  </h4>
                  <div className="grid md:grid-cols-2 gap-2">
                    {extractions.map((e, i) => (
                      <div key={i} className="border rounded-md p-2.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{e.field_name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {(e.confidence * 100).toFixed(0)}% · {e.status}
                          </span>
                        </div>
                        <div className="text-foreground mt-0.5">{e.extracted_value}</div>
                        {e.source_signal && (
                          <div className="text-xs text-muted-foreground mt-1">"{e.source_signal.slice(0, 200)}{e.source_signal.length > 200 ? "…" : ""}"</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                  <MessageSquare className="w-3 h-3" /> Calls ({calls.length})
                </h4>
                {calls.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No calls yet.</p>
                ) : (
                  <div className="space-y-2">
                    {calls.map((c) => {
                      const score = Array.isArray(c.score) ? c.score[0] : c.score;
                      const audio = c.ctm_raw_payload?.audio;
                      return (
                        <div key={c.id} className="border rounded-md p-2.5 text-sm">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-muted-foreground">{c.ctm_call_id}</span>
                              <Badge variant="outline" className="text-xs">{c.status}</Badge>
                              <span className="text-xs text-muted-foreground">{fmtTime(c.started_at)}</span>
                              <span className="text-xs text-muted-foreground">{fmtDur(c.talk_seconds)}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {score?.composite_score != null && (
                                <span className="text-xs">
                                  QA: <span className={`font-semibold ${scoreColor(score.composite_score)}`}>{score.composite_score}</span>
                                  {score.needs_supervisor_review && <Badge variant="outline" className="ml-1 text-[10px]">flagged</Badge>}
                                </span>
                              )}
                              {audio && (
                                <a href={String(audio)} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs hover:underline">
                                  <Headphones className="w-3 h-3" /> Recording
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t pt-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  Lead created {fmtTime(lead.created_at)}
                  {zoho_id_display(zohoId) && ` · Zoho ID ${zoho_id_display(zohoId)}`}
                </div>
                <div className="flex items-center gap-2">
                  {pushResult && (
                    <span className={`text-xs ${pushResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
                      {pushResult.ok && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                      {pushResult.message.slice(0, 120)}
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={pushToZoho} disabled={pushing}>
                    {pushing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Send className="w-3 h-3 mr-1.5" />}
                    {zohoId ? "Sync to Zoho" : "Push to Zoho"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
