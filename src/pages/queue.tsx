// Unified work queue.
//
// Replaces six separate queue surfaces (Callbacks, VOB Queue, Intake Schedule,
// Outreach Gaps, Stuck Leads, Abandoned Calls) with one page that loads
// all of them in parallel, normalizes into a common row shape, and filters
// via segmented chips.
//
// Specialists see their own items by default; managers see everything and
// can drill in with the owner filter.
//
// Each row links to the right next step (lead detail, call detail, VOB
// editor on lead detail, etc) — same destinations the old pages used.

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  Phone, ShieldCheck, Calendar, PhoneIncoming, Hourglass, PhoneOff,
  Loader2, ChevronRight, User as UserIcon, Filter, AlertCircle, Clock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/lib/role-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";
import { IncidentCard, type Severity } from "@/components/dashboard/IncidentCard";

type QueueType = "callback" | "vob" | "intake" | "outreach" | "stuck" | "abandoned";

interface QueueItem {
  key: string;            // dedupe + react key
  type: QueueType;
  title: string;          // primary label (lead/caller name)
  subtitle: string;       // secondary line
  meta: string;           // status/age/due chip
  href: string;           // where the row leads on click
  owner_id: string | null;
  owner_name: string | null;
  insurance_provider: string | null;
  urgency: string | null;
  lead_quality_tier: "A" | "B" | "C" | "D" | null;
  lead_quality_score: number | null;
  // Sortable timestamp — earliest action needed first.
  sort_at: string;
  // Absolute timestamp of the last contact (missed call, lead created,
  // VOB submitted, intake scheduled — whichever is the relevant "when".)
  // Drives the date + age chips on the row.
  last_contact_at: string | null;
  // True for missed calls + abandoned calls. These get pinned to the
  // top of the queue per Amber's spec — a missed inbound is the
  // single highest-priority thing on the page.
  is_missed_call: boolean;
  // Context fields for callback / abandoned rows so a rep doesn't have
  // to leave this page to triage. Other types (VOB, intake, outreach,
  // stuck) leave these null and the chips just don't render.
  reason_label: string | null;          // "Missed call" / "Abandoned" / "Voicemail" / "Rep flagged: needs callback"
  ivr_queue: IvrQueue | null;           // DUI / Commercial / AHCCCS / BD / VOB / Alumni / Other
  tracking_label: string | null;        // raw CTM tracking_label for the "Source: ..." chip
  original_rep_name: string | null;     // specialist who handled the inbound (not necessarily the owner)
  caller_phone: string | null;          // dedupe key for the prior-calls lookup
  prior_calls: number;                  // 0 = first-time caller; >0 = returning
}

// IVR queue derived from CTM tracking_label. Cornerstone's tracking
// labels embed the routing intent ("DUI - Main", "Google Ads DUI PPC",
// "Treatment - Main", "BD Inbound" etc.), so we pattern-match — most
// specific bucket wins.
type IvrQueue = "DUI" | "Commercial" | "AHCCCS" | "BD" | "VOB" | "Alumni" | "Other";

function deriveIvr(trackingLabel: string | null | undefined): IvrQueue {
  const t = (trackingLabel ?? "").toLowerCase();
  if (!t) return "Other";
  if (t.includes("dui")) return "DUI";
  if (t.includes("ahcccs")) return "AHCCCS";
  if (t.includes("bd ") || t.includes("bd inbound") || t.includes("business development")) return "BD";
  if (t.includes("vob")) return "VOB";
  if (t.includes("alumni") || t.includes("readmit")) return "Alumni";
  if (t.includes("treatment") || t.includes("admissions") || t.includes("commercial") ||
      t.includes("organic") || t.includes("gmb") || t.includes("psychology today") ||
      t.includes("addictioncenter") || t.includes("ppc")) return "Commercial";
  return "Other";
}

const IVR_TONE: Record<IvrQueue, string> = {
  DUI:        "border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/10",
  Commercial: "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/10",
  AHCCCS:     "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
  BD:         "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10",
  VOB:        "border-cyan-500/40 text-cyan-700 dark:text-cyan-400 bg-cyan-500/10",
  Alumni:     "border-pink-500/40 text-pink-700 dark:text-pink-400 bg-pink-500/10",
  Other:      "border-zinc-500/30 text-zinc-500 bg-zinc-500/5",
};

function deriveReason(status: string | null, disposition: string | null): string {
  if (disposition === "needs_callback") return "Rep flagged: needs callback";
  switch (status) {
    case "missed":    return "Missed call (we didn't pick up)";
    case "abandoned": return "Caller abandoned (hung up before pickup)";
    case "voicemail": return "Left voicemail";
    default:          return status ?? "";
  }
}

// Three priority levels using clinical-team vocabulary:
//   Urgent       — work first (tier A: AHCCCS + high urgency + clinical risk)
//   High priority — work next (tier B)
//   Routine      — fits where it fits (tiers C + D)
//
// The DB still stores 4 tiers (A/B/C/D) for fine-grained sort precision;
// we just collapse C and D into "Routine" in the UI so reps don't have
// to internalize four buckets when three is enough.
const TIER_TONE: Record<string, string> = {
  A: "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/10",
  B: "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10",
  C: "border-zinc-500/40 text-zinc-600 dark:text-zinc-400 bg-zinc-500/10",
  D: "border-zinc-500/40 text-zinc-600 dark:text-zinc-400 bg-zinc-500/10",
};
const TIER_LABEL: Record<string, string> = {
  A: "Urgent",
  B: "High priority",
  C: "Routine",
  D: "Routine",
};
const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

const TYPE_LABEL: Record<QueueType, string> = {
  callback: "Callback",
  vob: "VOB",
  intake: "Intake",
  outreach: "Outreach",
  stuck: "Stuck",
  abandoned: "Abandoned",
};

const TYPE_ICON: Record<QueueType, typeof Phone> = {
  callback: PhoneOff,
  vob: ShieldCheck,
  intake: Calendar,
  outreach: PhoneIncoming,
  stuck: Hourglass,
  abandoned: Phone,
};

const TYPE_TONE: Record<QueueType, string> = {
  callback: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  vob: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  intake: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  outreach: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  stuck: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  abandoned: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
};

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// "Today 3:42pm" / "Yesterday 11:08am" / "Tue May 14, 3:42pm" — the
// callback queue's primary "when did this happen" chip. Specialists
// don't want to do mental math on relative durations alone; they want
// to see the actual time the missed call came in.
function fmtCallTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const isYesterday = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }) + ` ${time}`;
}

export default function QueuePage() {
  const { user } = useAuth();
  const { role } = useRole();
  const isManager = role === "manager" || role === "admin";
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueType | "all">("all");
  // Specialists default to "mine"; managers default to "all team".
  const [scope, setScope] = useState<"mine" | "all">(isManager ? "all" : "mine");
  // Sort: "urgency" (default — oldest action needed first) or "quality"
  // (highest-tier leads at top so reps work the best leads first).
  const [sortBy, setSortBy] = useState<"urgency" | "quality">("urgency");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Pull all six sources in parallel. Each source maps into the QueueItem
      // shape so the render path doesn't have to know about the underlying
      // tables.
      const sevenAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const ninetyAgoISO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const startOfWeek = new Date(); startOfWeek.setHours(0, 0, 0, 0); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const sevenDaysOutISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const [callbackRes, vobRes, intakeRes, leadsAllRes, abandonedRes] = await Promise.all([
        // Callbacks: missed/abandoned/voicemail with callback_status='pending'
        // OR answered + needs_callback disposition. Also pulls
        // ctm_raw_payload (for IVR/source derivation) and the
        // specialist_profile (original rep) so the card can render
        // full context without a second round-trip.
        supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, caller_name, caller_phone_normalized, started_at, status,
            specialist_id, specialist_disposition, callback_status, ctm_raw_payload,
            lead_id,
            lead:leads!call_sessions_lead_id_fkey(id, first_name, last_name, owner_id, insurance_provider, urgency, lead_quality_tier, lead_quality_score, owner:profiles!leads_owner_id_fkey(full_name, email)),
            specialist_profile:profiles!call_sessions_specialist_id_fkey(full_name, email)`)
          .or("callback_status.eq.pending")
          .gte("started_at", sevenAgoISO)
          .order("started_at", { ascending: true })
          .limit(200),

        // VOB: leads with status pending or in_progress.
        supabase
          .from("leads")
          .select(`id, first_name, last_name, primary_phone_normalized, insurance_provider, urgency,
            vob_status, owner_id, created_at, lead_quality_tier, lead_quality_score,
            owner:profiles!leads_owner_id_fkey(full_name, email)`)
          .in("vob_status", ["pending", "in_progress"])
          .order("created_at", { ascending: true })
          .limit(200),

        // Intake: leads scheduled in the last week or next week, status scheduled/rescheduled.
        supabase
          .from("leads")
          .select(`id, first_name, last_name, primary_phone_normalized, insurance_provider, urgency,
            intake_scheduled_at, intake_status, owner_id, lead_quality_tier, lead_quality_score,
            owner:profiles!leads_owner_id_fkey(full_name, email)`)
          .gte("intake_scheduled_at", startOfWeek.toISOString())
          .lt("intake_scheduled_at", sevenDaysOutISO)
          .in("intake_status", ["scheduled", "rescheduled"])
          .order("intake_scheduled_at", { ascending: true })
          .limit(200),

        // For outreach + stuck — pull active leads in window once and derive both.
        supabase
          .from("leads")
          .select(`id, first_name, last_name, primary_phone_normalized, insurance_provider, urgency,
            outcome_category, owner_id, created_at, lead_quality_tier, lead_quality_score,
            owner:profiles!leads_owner_id_fkey(full_name, email)`)
          .eq("outcome_category", "in_progress")
          .gte("created_at", ninetyAgoISO)
          .limit(500),

        // Abandoned: status=abandoned + no callback yet. Same context
        // joins as the Callbacks query above so the card can render
        // reason / IVR / source / original rep without re-fetching.
        supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, caller_name, caller_phone_normalized, started_at, status,
            specialist_id, specialist_disposition, callback_status, ctm_raw_payload,
            lead_id,
            lead:leads!call_sessions_lead_id_fkey(id, first_name, last_name, owner_id, insurance_provider, urgency, lead_quality_tier, lead_quality_score, owner:profiles!leads_owner_id_fkey(full_name, email)),
            specialist_profile:profiles!call_sessions_specialist_id_fkey(full_name, email)`)
          .eq("status", "abandoned")
          .is("callback_status", null)
          .gte("started_at", sevenAgoISO)
          .order("started_at", { ascending: true })
          .limit(100),
      ]);

      const merged: QueueItem[] = [];

      // Callbacks
      for (const c of (callbackRes.data ?? []) as any[]) {
        const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead;
        const owner = lead?.owner ? (Array.isArray(lead.owner) ? lead.owner[0] : lead.owner) : null;
        const specProfile = c.specialist_profile
          ? (Array.isArray(c.specialist_profile) ? c.specialist_profile[0] : c.specialist_profile)
          : null;
        const name = c.caller_name
          ?? [lead?.first_name, lead?.last_name].filter(Boolean).join(" ")
          ?? c.caller_phone_normalized
          ?? "Unknown";
        const trackingLabel = (c.ctm_raw_payload?.tracking_label as string | null) ?? null;
        merged.push({
          key: `cb:${c.id}`,
          type: "callback",
          title: name,
          subtitle: c.caller_phone_normalized ?? "",
          meta: c.started_at ? `${fmtAge(c.started_at)} since call` : "",
          href: lead?.id ? `/leads/${lead.id}` : `/live/${c.id}`,
          owner_id: lead?.owner_id ?? c.specialist_id ?? null,
          owner_name: owner?.full_name ?? owner?.email ?? null,
          insurance_provider: lead?.insurance_provider ?? null,
          urgency: lead?.urgency ?? null,
          lead_quality_tier: lead?.lead_quality_tier ?? null,
          lead_quality_score: lead?.lead_quality_score ?? null,
          sort_at: c.started_at ?? new Date().toISOString(),
          last_contact_at: c.started_at ?? null,
          is_missed_call: true,
          reason_label: deriveReason(c.status as string | null, c.specialist_disposition as string | null),
          ivr_queue: deriveIvr(trackingLabel),
          tracking_label: trackingLabel,
          original_rep_name: specProfile?.full_name ?? specProfile?.email ?? null,
          caller_phone: c.caller_phone_normalized ?? null,
          prior_calls: 0,
        });
      }

      // VOB
      for (const l of (vobRes.data ?? []) as any[]) {
        const owner = Array.isArray(l.owner) ? l.owner[0] : l.owner;
        const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unnamed";
        merged.push({
          key: `vob:${l.id}`,
          type: "vob",
          title: name,
          subtitle: l.primary_phone_normalized ?? "",
          meta: l.vob_status === "in_progress" ? "VOB in progress" : "VOB pending",
          href: `/leads/${l.id}`,
          owner_id: l.owner_id ?? null,
          owner_name: owner?.full_name ?? owner?.email ?? null,
          insurance_provider: l.insurance_provider ?? null,
          urgency: l.urgency ?? null,
          lead_quality_tier: l.lead_quality_tier ?? null,
          lead_quality_score: l.lead_quality_score ?? null,
          sort_at: l.created_at ?? new Date().toISOString(),
          last_contact_at: l.created_at ?? null,
          is_missed_call: false,
          reason_label: null,
          ivr_queue: null,
          tracking_label: null,
          original_rep_name: null,
          caller_phone: null,
          prior_calls: 0,
        });
      }

      // Intake
      for (const l of (intakeRes.data ?? []) as any[]) {
        const owner = Array.isArray(l.owner) ? l.owner[0] : l.owner;
        const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unnamed";
        merged.push({
          key: `intake:${l.id}`,
          type: "intake",
          title: name,
          subtitle: l.primary_phone_normalized ?? "",
          meta: fmtDateTime(l.intake_scheduled_at),
          href: `/leads/${l.id}`,
          owner_id: l.owner_id ?? null,
          owner_name: owner?.full_name ?? owner?.email ?? null,
          insurance_provider: l.insurance_provider ?? null,
          urgency: l.urgency ?? null,
          lead_quality_tier: l.lead_quality_tier ?? null,
          lead_quality_score: l.lead_quality_score ?? null,
          sort_at: l.intake_scheduled_at ?? new Date().toISOString(),
          last_contact_at: l.intake_scheduled_at ?? null,
          is_missed_call: false,
          reason_label: null,
          ivr_queue: null,
          tracking_label: null,
          original_rep_name: null,
          caller_phone: null,
          prior_calls: 0,
        });
      }

      // Outreach + Stuck — both derive from the active-leads query.
      // For each lead, look up most-recent call to compute the gap.
      const leadIds = ((leadsAllRes.data ?? []) as any[]).map((l: any) => l.id) as string[];
      const callsByLead = new Map<string, { lastIn: string | null; lastOut: string | null; lastAny: string | null }>();
      if (leadIds.length > 0) {
        const { data: leadCalls } = await supabase
          .from("call_sessions")
          .select("lead_id, direction, started_at")
          .in("lead_id", leadIds);
        for (const c of (leadCalls ?? []) as any[]) {
          if (!c.lead_id) continue;
          const cur = callsByLead.get(c.lead_id) ?? { lastIn: null, lastOut: null, lastAny: null };
          if (c.direction === "inbound" && (!cur.lastIn || (c.started_at && c.started_at > cur.lastIn))) cur.lastIn = c.started_at;
          if (c.direction === "outbound" && (!cur.lastOut || (c.started_at && c.started_at > cur.lastOut))) cur.lastOut = c.started_at;
          if (!cur.lastAny || (c.started_at && c.started_at > cur.lastAny)) cur.lastAny = c.started_at;
          callsByLead.set(c.lead_id, cur);
        }
      }

      const STALE_OUTREACH_DAYS = 3;
      const STUCK_DAYS = 5;
      const staleOutreachMs = Date.now() - STALE_OUTREACH_DAYS * 24 * 60 * 60 * 1000;
      const stuckMs = Date.now() - STUCK_DAYS * 24 * 60 * 60 * 1000;

      for (const l of (leadsAllRes.data ?? []) as any[]) {
        const owner = Array.isArray(l.owner) ? l.owner[0] : l.owner;
        const calls = callsByLead.get(l.id);
        const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unnamed";

        // OUTREACH: had inbound, no recent outbound.
        if (calls?.lastIn) {
          const lastOutMs = calls.lastOut ? new Date(calls.lastOut).getTime() : 0;
          if (lastOutMs < staleOutreachMs) {
            merged.push({
              key: `outreach:${l.id}`,
              type: "outreach",
              title: name,
              subtitle: l.primary_phone_normalized ?? "",
              meta: calls.lastOut ? `${fmtAge(calls.lastOut)} since outbound` : "never called back",
              href: `/leads/${l.id}`,
              owner_id: l.owner_id ?? null,
              owner_name: owner?.full_name ?? owner?.email ?? null,
              insurance_provider: l.insurance_provider ?? null,
              urgency: l.urgency ?? null,
              lead_quality_tier: l.lead_quality_tier ?? null,
              lead_quality_score: l.lead_quality_score ?? null,
              sort_at: calls.lastOut ?? l.created_at ?? new Date().toISOString(),
              last_contact_at: calls.lastOut ?? calls.lastIn ?? l.created_at ?? null,
              is_missed_call: false,
              reason_label: null,
              ivr_queue: null,
              tracking_label: null,
              original_rep_name: null,
              caller_phone: null,
              prior_calls: 0,
            });
          }
        }

        // STUCK: no activity at all in 5+ days, lead older than 5 days.
        const leadCreatedMs = l.created_at ? new Date(l.created_at).getTime() : 0;
        const lastActivityMs = calls?.lastAny ? new Date(calls.lastAny).getTime() : leadCreatedMs;
        if (leadCreatedMs > 0 && leadCreatedMs < stuckMs && lastActivityMs < stuckMs) {
          merged.push({
            key: `stuck:${l.id}`,
            type: "stuck",
            title: name,
            subtitle: l.primary_phone_normalized ?? "",
            meta: `${fmtAge(calls?.lastAny ?? l.created_at)} idle`,
            href: `/leads/${l.id}`,
            owner_id: l.owner_id ?? null,
            owner_name: owner?.full_name ?? owner?.email ?? null,
            insurance_provider: l.insurance_provider ?? null,
            urgency: l.urgency ?? null,
            lead_quality_tier: l.lead_quality_tier ?? null,
            lead_quality_score: l.lead_quality_score ?? null,
            sort_at: calls?.lastAny ?? l.created_at ?? new Date().toISOString(),
            last_contact_at: calls?.lastAny ?? l.created_at ?? null,
            is_missed_call: false,
            reason_label: null,
            ivr_queue: null,
            tracking_label: null,
            original_rep_name: null,
            caller_phone: null,
            prior_calls: 0,
          });
        }
      }

      // Abandoned
      for (const c of (abandonedRes.data ?? []) as any[]) {
        const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead;
        const owner = lead?.owner ? (Array.isArray(lead.owner) ? lead.owner[0] : lead.owner) : null;
        const specProfile = c.specialist_profile
          ? (Array.isArray(c.specialist_profile) ? c.specialist_profile[0] : c.specialist_profile)
          : null;
        const name = c.caller_name
          ?? [lead?.first_name, lead?.last_name].filter(Boolean).join(" ")
          ?? c.caller_phone_normalized
          ?? "Unknown";
        const trackingLabel = (c.ctm_raw_payload?.tracking_label as string | null) ?? null;
        merged.push({
          key: `abandoned:${c.id}`,
          type: "abandoned",
          title: name,
          subtitle: c.caller_phone_normalized ?? "",
          meta: c.started_at ? fmtAge(c.started_at) + " ago" : "",
          href: lead?.id ? `/leads/${lead.id}` : `/live/${c.id}`,
          owner_id: lead?.owner_id ?? c.specialist_id ?? null,
          owner_name: owner?.full_name ?? owner?.email ?? null,
          insurance_provider: lead?.insurance_provider ?? null,
          urgency: lead?.urgency ?? null,
          lead_quality_tier: lead?.lead_quality_tier ?? null,
          lead_quality_score: lead?.lead_quality_score ?? null,
          sort_at: c.started_at ?? new Date().toISOString(),
          last_contact_at: c.started_at ?? null,
          is_missed_call: true,
          reason_label: deriveReason(c.status as string | null, c.specialist_disposition as string | null),
          ivr_queue: deriveIvr(trackingLabel),
          tracking_label: trackingLabel,
          original_rep_name: specProfile?.full_name ?? specProfile?.email ?? null,
          caller_phone: c.caller_phone_normalized ?? null,
          prior_calls: 0,
        });
      }

      // First-time-caller detection for missed-call rows. One batched
      // query over every distinct caller phone in the visible callbacks
      // + abandoned rows, grouped client-side. Each row gets a
      // prior_calls count = number of call_sessions for that phone
      // BEFORE this row's started_at. 0 = first-time.
      const missedRows = merged.filter((r) => r.is_missed_call && r.caller_phone);
      const phones = Array.from(new Set(missedRows.map((r) => r.caller_phone as string)));
      if (phones.length > 0) {
        const earliestStartMs = Math.min(...missedRows.map((r) => new Date(r.sort_at).getTime()));
        const earliestIso = new Date(earliestStartMs).toISOString();
        const { data: priors } = await supabase
          .from("call_sessions")
          .select("caller_phone_normalized")
          .in("caller_phone_normalized", phones)
          .lt("started_at", earliestIso)
          .limit(5000);
        const priorByPhone = new Map<string, number>();
        for (const p of (priors ?? []) as any[]) {
          const k = p.caller_phone_normalized as string;
          priorByPhone.set(k, (priorByPhone.get(k) ?? 0) + 1);
        }
        for (const r of missedRows) {
          if (r.caller_phone) r.prior_calls = priorByPhone.get(r.caller_phone) ?? 0;
        }
      }

      // De-dupe by key (stuck and outreach can both fire for the same lead;
      // we keep both since they're different actions, but the same lead can't
      // appear twice in callbacks/vob/etc.)
      const seen = new Set<string>();
      const deduped = merged.filter((m) => {
        if (seen.has(m.key)) return false;
        seen.add(m.key);
        return true;
      });

      // Default sort handled in the render path so the sortBy toggle can
      // re-order without re-fetching.
      setItems(deduped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Counts per type — across the current scope (mine vs all)
  const filteredItems = useMemo(() => {
    const list = items.filter((i) => {
      if (scope === "mine" && i.owner_id !== user?.id) return false;
      if (filter !== "all" && i.type !== filter) return false;
      return true;
    });

    // Sort policy:
    //
    //   1. Missed calls (callback + abandoned) ALWAYS pin to the top —
    //      per Amber's spec, an inbound we didn't pick up is the single
    //      highest-priority thing on the page, regardless of the toggle.
    //      Within missed calls, freshest first so the still-hot caller
    //      gets a return ring before they go elsewhere.
    //   2. Inside the rest of the queue:
    //        - "By priority" → tier A → B → C → D, score tiebreaker
    //        - "Oldest first" → intake (soonest) first, else oldest age
    return [...list].sort((a, b) => {
      // Missed calls always win.
      if (a.is_missed_call && !b.is_missed_call) return -1;
      if (b.is_missed_call && !a.is_missed_call) return 1;
      if (a.is_missed_call && b.is_missed_call) {
        // Freshest missed call first.
        return a.sort_at < b.sort_at ? 1 : -1;
      }

      if (sortBy === "quality") {
        const ar = a.lead_quality_tier ? TIER_RANK[a.lead_quality_tier] : 99;
        const br = b.lead_quality_tier ? TIER_RANK[b.lead_quality_tier] : 99;
        if (ar !== br) return ar - br;
        const aScore = a.lead_quality_score ?? -1;
        const bScore = b.lead_quality_score ?? -1;
        if (aScore !== bScore) return bScore - aScore;
      }
      // Oldest-first fallback: intake ascending (soonest first), others oldest first
      if (a.type === "intake" && b.type !== "intake") return -1;
      if (b.type === "intake" && a.type !== "intake") return 1;
      return a.sort_at < b.sort_at ? -1 : 1;
    });
  }, [items, scope, filter, user?.id, sortBy]);

  const countsByType = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const it of items) {
      if (scope === "mine" && it.owner_id !== user?.id) continue;
      c.all++;
      c[it.type] = (c[it.type] ?? 0) + 1;
    }
    return c;
  }, [items, scope, user?.id]);

  return (
    <PageShell
      eyebrow="WORK QUEUE"
      title="Queue"
      subtitle="Everything that needs follow-up — callbacks, VOBs, intakes, outreach gaps, stuck leads, abandoned calls — in one feed. Filter by type or by owner."
      maxWidth={1400}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(["all", "callback", "vob", "intake", "outreach", "stuck", "abandoned"] as const).map((f) => {
          const c = countsByType[f] ?? 0;
          const label = f === "all" ? "All" : TYPE_LABEL[f as QueueType];
          return (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              className="h-8"
            >
              {label}
              <span className={`ml-1.5 ${filter === f ? "opacity-80" : "text-muted-foreground"}`}>{c}</span>
            </Button>
          );
        })}

        {isManager && (
          <>
            <span className="mx-2 h-5 w-px bg-border" />
            <Button size="sm" variant={scope === "mine" ? "default" : "outline"} onClick={() => setScope("mine")} className="h-8">
              Mine
            </Button>
            <Button size="sm" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")} className="h-8">
              All team
            </Button>
          </>
        )}

        <span className="mx-2 h-5 w-px bg-border" />
        <span className="text-xs text-muted-foreground">Sort:</span>
        <Button size="sm" variant={sortBy === "quality" ? "default" : "outline"} onClick={() => setSortBy("quality")} className="h-8">
          By priority
        </Button>
        <Button size="sm" variant={sortBy === "urgency" ? "default" : "outline"} onClick={() => setSortBy("urgency")} className="h-8">
          Oldest first
        </Button>
      </div>

      {loading && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && filteredItems.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground space-y-2">
            <div className="text-2xl">✓</div>
            <div>Queue's clean — nothing needs attention right now.</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-1.5">
        {filteredItems.map((it) => (
          <QueueRow key={it.key} item={it} showOwner={scope === "all"} />
        ))}
      </div>
    </PageShell>
  );
}

function QueueRow({ item, showOwner: _showOwner }: { item: QueueItem; showOwner: boolean }) {
  // Map queue urgency/tier into IncidentCard's severity scale so rows
  // pick up the same color-bar + pill treatment as /ops/alerts. Missed
  // calls are ALWAYS critical regardless of tier — losing an inbound is
  // the single worst outcome on this page. Otherwise tier A / high
  // urgency drive critical, tier B drives high, rest fall to low.
  const severity: Severity = item.is_missed_call || item.urgency === "high" || item.lead_quality_tier === "A"
    ? "critical"
    : item.lead_quality_tier === "B"
      ? "high"
      : "low";

  // Timing chips, stacked right-aligned. Two-line layout:
  //   • Date + time of the missed call / last activity (absolute)
  //   • Time elapsed since (relative duration)
  // Specialists asked for both — relative alone forces mental math,
  // absolute alone doesn't telegraph urgency.
  const timingChips: Array<{ icon?: typeof Phone; label: React.ReactNode; mono?: boolean; muted?: boolean; srLabel?: string }> = [];
  if (item.last_contact_at) {
    timingChips.push({
      icon: Calendar,
      label: fmtCallTime(item.last_contact_at),
      srLabel: "Date of contact",
    });
  }
  timingChips.push({
    icon: Clock,
    label: item.last_contact_at ? `${fmtAge(item.last_contact_at)} ago` : item.meta,
    muted: true,
    srLabel: "Time elapsed since contact",
  });

  // Context chips — phone, insurance, owner, tier. Owner is ALWAYS
  // shown (not gated on the "All team" toggle) so a specialist working
  // their own queue still sees who's already assigned to each item.
  const contextChips: Array<{ icon?: typeof Phone; label: React.ReactNode; mono?: boolean; muted?: boolean; srLabel?: string }> = [];

  // For missed-call rows, lead with the WHY (reason) + WHERE (IVR
  // queue) + WHO-CALLED (first-time vs returning). Reps triage these
  // first before they care about owner / insurance / phone.
  if (item.is_missed_call && item.reason_label) {
    contextChips.push({ label: item.reason_label, srLabel: "Why this is queued" });
  }
  if (item.is_missed_call && item.ivr_queue) {
    contextChips.push({
      label: <span className={IVR_TONE[item.ivr_queue] + " px-1.5 py-0.5 rounded border text-[10px]"}>IVR: {item.ivr_queue}</span>,
      srLabel: "IVR queue",
    });
  }
  if (item.is_missed_call && item.caller_phone) {
    contextChips.push({
      label: item.prior_calls === 0
        ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">First-time caller</span>
        : <span className="text-muted-foreground">Returning ({item.prior_calls} prior)</span>,
      srLabel: "Caller history",
    });
  }

  if (item.subtitle) {
    contextChips.push({ icon: Phone, label: item.subtitle, mono: true, srLabel: "Phone" });
  }
  if (item.insurance_provider) {
    contextChips.push({ label: item.insurance_provider, srLabel: "Insurance" });
  }
  if (item.is_missed_call && item.tracking_label) {
    contextChips.push({
      label: <span><span className="text-muted-foreground">Source:</span> {item.tracking_label}</span>,
      srLabel: "Call source",
    });
  }
  contextChips.push({
    icon: UserIcon,
    label: item.owner_name
      ? <span><span className="text-muted-foreground">Rep:</span> {item.owner_name}</span>
      : <span className="text-muted-foreground italic">Unassigned</span>,
    srLabel: "Assigned rep",
  });
  // For missed calls, also show the ORIGINAL rep who took the inbound
  // — different from owner_name (which is the lead owner). Tells the
  // person working the queue who they're following up after.
  if (item.is_missed_call && item.original_rep_name && item.original_rep_name !== item.owner_name) {
    contextChips.push({
      icon: UserIcon,
      label: <span><span className="text-muted-foreground">Original rep:</span> {item.original_rep_name}</span>,
      srLabel: "Original rep on the call",
    });
  }
  if (item.lead_quality_tier && !item.is_missed_call) {
    contextChips.push({
      label: <span className={item.lead_quality_tier === "A" ? "text-rose-600 dark:text-rose-400" : item.lead_quality_tier === "B" ? "text-amber-600 dark:text-amber-400" : ""}>{TIER_LABEL[item.lead_quality_tier]}</span>,
      srLabel: "Priority tier",
    });
  }

  // The "body" is the caller name — visually prominent, with a MISSED
  // CALL prefix when applicable so it pops in the feed without making
  // the rep read the chip row.
  const body = (
    <Link href={item.href} className="block hover:underline">
      {item.is_missed_call && (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400 mr-2 align-middle">
          <PhoneOff className="w-3 h-3" /> Missed call
        </span>
      )}
      <span className="font-semibold text-[15px] align-middle">{item.title}</span>
    </Link>
  );

  const actions = (
    <Link href={item.href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      Open <ChevronRight className="w-3 h-3" />
    </Link>
  );

  return (
    <IncidentCard
      severity={severity}
      category={item.is_missed_call ? "MISSED CALL" : TYPE_LABEL[item.type]}
      status="open"
      timingChips={timingChips}
      contextChips={contextChips}
      body={body}
      actions={actions}
      ariaLabel={`${item.is_missed_call ? "Missed call" : TYPE_LABEL[item.type]} for ${item.title}`}
    />
  );
}
