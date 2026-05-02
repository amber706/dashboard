// PriorConversationsPanel — what we already know about this caller.
//
// Renders on /live/[id] and /leads/[id]. Aggregates everything we have
// from earlier calls with the same caller so a rep on a callback / live
// pickup sees the context immediately:
//
//   - Total prior calls + last contact date
//   - Most recent AI summary
//   - Manager-pinned notes from any prior call
//   - Recent dispositions
//   - Top extracted facts (insurance, urgency, substance, court status)
//   - Number of Zoho Deals + recent deal stages (admission opportunities)
//   - One-line list of all prior calls with click-through to /live/[id]
//
// Props:
//   - leadId  — preferred. Resolves to all the lead's call_session ids.
//   - phone   — fallback when lead isn't yet linked to call_sessions.
//   - excludeCallId — current call (don't include it in "prior" history).
//
// Renders nothing when there are zero prior calls (this is the rep's first
// contact, so there's nothing to surface).

import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  History, Sparkles, Pin, Phone, Clock, ShieldCheck, Briefcase,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PriorCall {
  id: string;
  ctm_call_id: string;
  status: string | null;
  started_at: string | null;
  talk_seconds: number | null;
  caller_name: string | null;
  caller_phone_normalized: string | null;
  ai_summary: string | null;
  ai_summary_generated_at: string | null;
  manager_notes: string | null;
  callback_notes: string | null;
  specialist_disposition: string | null;
  disposition_set_at: string | null;
  composite_score: number | null;
  compliance_flags: any[] | null;
  specialist_name: string | null;
}

interface KeyExtraction {
  field_name: string;
  extracted_value: string;
  confidence: number;
}

interface ZohoDealSummary {
  id: string;
  name: string | null;
  stage: string | null;
  closing_date: string | null;
  amount: number | null;
  modified_at: string | null;
}

interface PanelData {
  prior_calls: PriorCall[];
  most_recent_summary: PriorCall | null;
  manager_notes: PriorCall[];           // calls that have a non-empty manager_notes
  key_extractions: KeyExtraction[];     // dedupe by field_name, latest wins
  zoho_deal_count: number | null;       // null = not loaded / no Zoho data
  zoho_recent_deals: ZohoDealSummary[];
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(s: string | null): string {
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

export function PriorConversationsPanel({
  leadId,
  phone,
  excludeCallId,
}: {
  leadId?: string | null;
  phone?: string | null;
  excludeCallId?: string | null;
}) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Find prior calls. Prefer lead_id (more accurate); fall back to phone.
      let callsQuery = supabase
        .from("call_sessions")
        .select(`
          id, ctm_call_id, status, started_at, talk_seconds,
          caller_name, caller_phone_normalized,
          ai_summary, ai_summary_generated_at,
          manager_notes, callback_notes,
          specialist_disposition, disposition_set_at,
          specialist:profiles(full_name, email),
          score:call_scores(composite_score, compliance_flags)
        `)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(20);
      if (leadId) {
        callsQuery = callsQuery.eq("lead_id", leadId);
      } else if (phone) {
        callsQuery = callsQuery.eq("caller_phone_normalized", phone);
      } else {
        if (!cancelled) { setData({ prior_calls: [], most_recent_summary: null, manager_notes: [], key_extractions: [], zoho_deal_count: null, zoho_recent_deals: [] }); setLoading(false); }
        return;
      }

      const { data: callRows, error } = await callsQuery;
      if (cancelled) return;
      if (error || !callRows) {
        setData({ prior_calls: [], most_recent_summary: null, manager_notes: [], key_extractions: [], zoho_deal_count: null, zoho_recent_deals: [] });
        setLoading(false);
        return;
      }

      const allCalls: PriorCall[] = (callRows as any[]).map((c) => {
        const spec = Array.isArray(c.specialist) ? c.specialist[0] : c.specialist;
        const score = Array.isArray(c.score) ? c.score[0] : c.score;
        return {
          id: c.id,
          ctm_call_id: c.ctm_call_id,
          status: c.status,
          started_at: c.started_at,
          talk_seconds: c.talk_seconds,
          caller_name: c.caller_name,
          caller_phone_normalized: c.caller_phone_normalized,
          ai_summary: c.ai_summary,
          ai_summary_generated_at: c.ai_summary_generated_at,
          manager_notes: c.manager_notes,
          callback_notes: c.callback_notes,
          specialist_disposition: c.specialist_disposition,
          disposition_set_at: c.disposition_set_at,
          composite_score: score?.composite_score ?? null,
          compliance_flags: score?.compliance_flags ?? null,
          specialist_name: spec?.full_name ?? spec?.email ?? null,
        };
      });

      // Exclude the current call
      const priorCalls = excludeCallId
        ? allCalls.filter((c) => c.id !== excludeCallId)
        : allCalls;

      if (priorCalls.length === 0) {
        if (!cancelled) {
          setData({ prior_calls: [], most_recent_summary: null, manager_notes: [], key_extractions: [], zoho_deal_count: null, zoho_recent_deals: [] });
          setLoading(false);
        }
        return;
      }

      // Most recent AI summary across all prior calls
      const mostRecentSummary = priorCalls.find((c) => c.ai_summary && c.ai_summary.trim().length > 0) ?? null;

      // Manager-noted calls (any non-empty manager_notes from a prior call)
      const managerNoted = priorCalls
        .filter((c) => c.manager_notes && c.manager_notes.trim().length > 0)
        .slice(0, 3);

      // Key extractions across all prior calls — joined to those call ids,
      // confidence >= 0.75, deduped by field_name (latest wins).
      const priorCallIds = priorCalls.map((c) => c.id);
      let keyExtractions: KeyExtraction[] = [];
      if (priorCallIds.length > 0) {
        const { data: extRows } = await supabase
          .from("field_extractions")
          .select("field_name, extracted_value, confidence, updated_at")
          .in("call_session_id", priorCallIds)
          .gte("confidence", 0.75)
          .order("updated_at", { ascending: false });
        const seen = new Set<string>();
        for (const e of (extRows ?? []) as any[]) {
          if (seen.has(e.field_name)) continue;
          if (!e.extracted_value) continue;
          seen.add(e.field_name);
          keyExtractions.push({ field_name: e.field_name, extracted_value: e.extracted_value, confidence: e.confidence });
        }
        // Drop fields that are usually noise; keep the high-signal ones for the panel
        const PROMOTE = new Set([
          "insurance_provider", "insurance_plan_type", "urgency", "presenting_substance",
          "presenting_mental_health", "court_status", "relationship_to_patient",
          "program_interest", "callback_preference", "patient_age", "date_of_birth",
          "current_psychiatric_meds", "history_of_suicide_attempts",
        ]);
        keyExtractions = [
          ...keyExtractions.filter((e) => PROMOTE.has(e.field_name)),
          ...keyExtractions.filter((e) => !PROMOTE.has(e.field_name)),
        ].slice(0, 10);
      }

      // Zoho deals — fire-and-forget; treat failure as no data.
      let zohoDealCount: number | null = null;
      let zohoRecentDeals: ZohoDealSummary[] = [];
      if (leadId) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const zRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoho-deals-for-lead`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ lead_id: leadId }),
          });
          if (zRes.ok) {
            const zJson = await zRes.json();
            if (zJson.ok) {
              zohoDealCount = zJson.deal_count ?? 0;
              zohoRecentDeals = (zJson.recent ?? []) as ZohoDealSummary[];
            }
          }
        } catch {
          // swallow — panel still works without Zoho
        }
      }

      if (!cancelled) {
        setData({
          prior_calls: priorCalls,
          most_recent_summary: mostRecentSummary,
          manager_notes: managerNoted,
          key_extractions: keyExtractions,
          zoho_deal_count: zohoDealCount,
          zoho_recent_deals: zohoRecentDeals,
        });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId, phone, excludeCallId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Looking up prior conversations…
        </CardContent>
      </Card>
    );
  }

  if (!data || data.prior_calls.length === 0) {
    // First-time caller — render nothing; the rep doesn't need a "no prior
    // history" message taking up space.
    return null;
  }

  const lastContact = data.prior_calls[0]?.started_at ?? null;

  return (
    <Card className="border-blue-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-500" />
            Prior conversations
          </span>
          <span className="text-xs text-muted-foreground font-normal flex items-center gap-3 flex-wrap">
            <span>{data.prior_calls.length} prior {data.prior_calls.length === 1 ? "call" : "calls"}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> last contact {fmtDate(lastContact)}
            </span>
            {data.zoho_deal_count != null && data.zoho_deal_count > 0 && (
              <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <Briefcase className="w-3 h-3" /> {data.zoho_deal_count} Zoho {data.zoho_deal_count === 1 ? "deal" : "deals"}
              </span>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              {expanded ? <><ChevronDown className="w-3 h-3" /> Collapse</> : <><ChevronRight className="w-3 h-3" /> Expand</>}
            </button>
          </span>
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-4">
            {/* WHAT WE KNOW (key extractions) */}
            {data.key_extractions.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> What we know
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-sm">
                  {data.key_extractions.map((e) => (
                    <div key={e.field_name} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground capitalize">{e.field_name.replace(/_/g, " ")}</div>
                        <div className="truncate">{e.extracted_value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* WHAT HAPPENED (most recent AI summary + manager notes) */}
            <div className="space-y-3">
              {data.most_recent_summary?.ai_summary && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" /> Last call summary
                    {data.most_recent_summary.ai_summary_generated_at && (
                      <span className="ml-auto text-[10px] font-normal text-muted-foreground/80" title={data.most_recent_summary.ai_summary_generated_at}>
                        {fmtDateTime(data.most_recent_summary.started_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-6">
                    {data.most_recent_summary.ai_summary}
                  </p>
                </div>
              )}

              {data.manager_notes.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Pin className="w-3 h-3" /> Manager notes
                  </div>
                  <div className="space-y-2">
                    {data.manager_notes.map((c) => (
                      <div key={c.id} className="text-xs border-l-2 border-blue-500/40 pl-2">
                        <div className="text-muted-foreground/80 mb-0.5">{fmtDateTime(c.started_at)} · {c.specialist_name ?? "—"}</div>
                        <div className="line-clamp-3">"{c.manager_notes}"</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.zoho_recent_deals.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Briefcase className="w-3 h-3" /> Zoho deals
                  </div>
                  <div className="space-y-1.5">
                    {data.zoho_recent_deals.map((d) => (
                      <div key={d.id} className="text-xs border rounded-md px-2 py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{d.name ?? "(unnamed deal)"}</div>
                          {d.stage && <div className="text-muted-foreground">{d.stage}</div>}
                        </div>
                        {d.modified_at && (
                          <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtDate(d.modified_at)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PRIOR CALLS LIST — one-line per call, click-through to detail */}
          <div className="border-t pt-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Phone className="w-3 h-3" /> Past calls
            </div>
            <div className="divide-y divide-border">
              {data.prior_calls.slice(0, 8).map((c) => (
                <Link key={c.id} href={`/live/${c.id}`} className="block">
                  <div className="py-1.5 text-xs hover:bg-accent/30 -mx-2 px-2 rounded-md flex items-center gap-3 transition-colors">
                    <div className="w-32 shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(c.started_at)}</div>
                    <Badge variant="outline" className="text-[10px]">{c.status ?? "—"}</Badge>
                    <span className="text-muted-foreground tabular-nums w-12 shrink-0">{fmtDur(c.talk_seconds)}</span>
                    {c.specialist_name && <span className="text-muted-foreground truncate flex-1 min-w-0">{c.specialist_name}</span>}
                    {c.specialist_disposition && (
                      <Badge variant="outline" className="text-[10px]">{c.specialist_disposition.replace(/_/g, " ")}</Badge>
                    )}
                    {c.compliance_flags && c.compliance_flags.length > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {c.compliance_flags.length}
                      </span>
                    )}
                    {c.composite_score != null && (
                      <span className={`shrink-0 font-semibold tabular-nums ${scoreColor(c.composite_score)}`}>{c.composite_score}</span>
                    )}
                  </div>
                </Link>
              ))}
              {data.prior_calls.length > 8 && (
                <div className="text-xs text-muted-foreground text-center pt-1.5">
                  + {data.prior_calls.length - 8} more in timeline below
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
