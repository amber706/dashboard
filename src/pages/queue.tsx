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
}

// Descriptive labels (Hot / Warm / Cool / Cold) instead of opaque A–D
// tier letters — sales-funnel vocabulary every admissions team already
// uses internally, so the badge reads without needing a legend.
const TIER_TONE: Record<string, string> = {
  A: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
  B: "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/10",
  C: "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10",
  D: "border-zinc-500/40 text-zinc-600 dark:text-zinc-400 bg-zinc-500/10",
};
const TIER_LABEL: Record<string, string> = {
  A: "Hot",
  B: "Warm",
  C: "Cool",
  D: "Cold",
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
        // OR answered + needs_callback disposition.
        supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, caller_name, caller_phone_normalized, started_at, status,
            specialist_id, specialist_disposition, callback_status,
            lead_id,
            lead:leads!call_sessions_lead_id_fkey(id, first_name, last_name, owner_id, insurance_provider, urgency, lead_quality_tier, lead_quality_score, owner:profiles!leads_owner_id_fkey(full_name, email))`)
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

        // Abandoned: status=abandoned + no callback yet.
        supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, caller_name, caller_phone_normalized, started_at,
            specialist_id, callback_status,
            lead_id,
            lead:leads!call_sessions_lead_id_fkey(id, first_name, last_name, owner_id, insurance_provider, urgency, lead_quality_tier, lead_quality_score, owner:profiles!leads_owner_id_fkey(full_name, email))`)
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
        const name = c.caller_name
          ?? [lead?.first_name, lead?.last_name].filter(Boolean).join(" ")
          ?? c.caller_phone_normalized
          ?? "Unknown";
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
          });
        }
      }

      // Abandoned
      for (const c of (abandonedRes.data ?? []) as any[]) {
        const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead;
        const owner = lead?.owner ? (Array.isArray(lead.owner) ? lead.owner[0] : lead.owner) : null;
        const name = c.caller_name
          ?? [lead?.first_name, lead?.last_name].filter(Boolean).join(" ")
          ?? c.caller_phone_normalized
          ?? "Unknown";
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
        });
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

    // Quality-first: tier A → B → C → D → null, then by urgency timestamp
    // Urgency-first (default): intake first (soonest), then oldest action
    return [...list].sort((a, b) => {
      if (sortBy === "quality") {
        const ar = a.lead_quality_tier ? TIER_RANK[a.lead_quality_tier] : 99;
        const br = b.lead_quality_tier ? TIER_RANK[b.lead_quality_tier] : 99;
        if (ar !== br) return ar - br;
        const aScore = a.lead_quality_score ?? -1;
        const bScore = b.lead_quality_score ?? -1;
        if (aScore !== bScore) return bScore - aScore;
      }
      // Urgency fallback: intake ascending (soonest first), others oldest first
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
        <Button size="sm" variant={sortBy === "urgency" ? "default" : "outline"} onClick={() => setSortBy("urgency")} className="h-8">
          Most urgent
        </Button>
        <Button size="sm" variant={sortBy === "quality" ? "default" : "outline"} onClick={() => setSortBy("quality")} className="h-8">
          Hottest first
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

function QueueRow({ item, showOwner }: { item: QueueItem; showOwner: boolean }) {
  const Icon = TYPE_ICON[item.type];
  return (
    <Link href={item.href} className="block">
      <Card className="hover:bg-accent/40 transition-colors">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className={`text-[10px] gap-1 ${TYPE_TONE[item.type]}`}>
              <Icon className="w-3 h-3" /> {TYPE_LABEL[item.type]}
            </Badge>
            {item.lead_quality_tier && (
              <Badge variant="outline" className={`text-[10px] font-semibold ${TIER_TONE[item.lead_quality_tier]}`} title={`Quality score: ${item.lead_quality_score ?? "—"} of 100`}>
                {TIER_LABEL[item.lead_quality_tier]}
              </Badge>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{item.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                {item.subtitle && <span className="truncate">{item.subtitle}</span>}
                {item.insurance_provider && <span>· {item.insurance_provider}</span>}
                {showOwner && item.owner_name && (
                  <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> {item.owner_name}</span>
                )}
                {item.urgency === "high" && (
                  <Badge variant="outline" className="text-[10px] gap-1 border-rose-500/40 text-rose-700 dark:text-rose-400">
                    <AlertCircle className="w-2.5 h-2.5" /> high urgency
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums shrink-0 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {item.meta}
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
