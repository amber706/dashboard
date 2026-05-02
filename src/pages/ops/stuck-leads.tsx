import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Hourglass, Loader2, Phone, Clock, AlertTriangle,
  ChevronRight, User as UserIcon, Filter, Download, Activity,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";

// A "stuck" lead is one that:
//  - is in_progress (not won/lost — closed leads are fine to be inactive)
//  - has not had a stage transition in STUCK_DAYS days
//  - was created within the lookback window
//
// "Time in stage" = now - latest lead_outcome_events.transitioned_at for the lead,
// falling back to leads.created_at if no events exist.

const STUCK_DAYS_OPTIONS = [3, 5, 7, 14] as const;
const LOOKBACK_DAYS = 90;
const PAGE_LIMIT = 200;

interface StuckLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  stage: string | null;
  insurance_provider: string | null;
  urgency: string | null;
  created_at: string;
  owner: { id: string; full_name: string | null; email: string | null } | null;
  last_transition_at: string | null;
  days_in_stage: number;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function OpsStuckLeads() {
  const [leads, setLeads] = useState<StuckLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stuckDays, setStuckDays] = useState<number>(5);
  const [stageFilter, setStageFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const lookbackISO = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: leadRows, error: lErr } = await supabase
      .from("leads")
      .select(`id, first_name, last_name, primary_phone_normalized, stage,
        insurance_provider, urgency, created_at,
        owner:profiles!leads_owner_id_fkey(id, full_name, email)`)
      .eq("outcome_category", "in_progress")
      .gte("created_at", lookbackISO)
      .not("stage", "is", null)
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (lErr) {
      setError(lErr.message);
      setLoading(false);
      return;
    }

    // Pull latest stage transition per lead.
    const leadIds = (leadRows ?? []).map((l: any) => l.id);
    if (leadIds.length === 0) {
      setLeads([]);
      setLoading(false);
      return;
    }
    const { data: events } = await supabase
      .from("lead_outcome_events")
      .select("lead_id, transitioned_at, from_stage, to_stage")
      .in("lead_id", leadIds)
      .order("transitioned_at", { ascending: false });

    const lastStageMove = new Map<string, string>();
    for (const e of (events ?? []) as any[]) {
      // Only count actual stage moves, not category-only transitions
      if (e.from_stage === e.to_stage) continue;
      if (!lastStageMove.has(e.lead_id)) {
        lastStageMove.set(e.lead_id, e.transitioned_at);
      }
    }

    const enriched: StuckLead[] = (leadRows ?? []).map((l: any) => {
      const lastTransition = lastStageMove.get(l.id) ?? l.created_at;
      const days = (Date.now() - new Date(lastTransition).getTime()) / (1000 * 60 * 60 * 24);
      return {
        ...l,
        owner: Array.isArray(l.owner) ? l.owner[0] : l.owner,
        last_transition_at: lastStageMove.get(l.id) ?? null,
        days_in_stage: Math.floor(days),
      };
    });
    setLeads(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { logAudit("view", "leads", null, { surface: "ops_stuck_leads" }); }, []);

  const stages = useMemo(() => {
    const seen = new Map<string, number>();
    for (const l of leads) {
      if (!l.stage) continue;
      seen.set(l.stage, (seen.get(l.stage) ?? 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const filtered = useMemo(() => {
    return leads
      .filter((l) => l.days_in_stage >= stuckDays)
      .filter((l) => stageFilter === "all" || l.stage === stageFilter)
      .sort((a, b) => b.days_in_stage - a.days_in_stage);
  }, [leads, stuckDays, stageFilter]);

  const counts = useMemo(() => {
    const veryStuck = filtered.filter((l) => l.days_in_stage >= 14).length;
    return { total: filtered.length, veryStuck };
  }, [filtered]);

  return (
    <PageShell
      number="02"
      eyebrow="LEAKAGE"
      eyebrowAccent="coral"
      title="Stuck leads"
      subtitle="In-progress leads that haven't moved stages in N days. Sitting in &quot;Awaiting VOB&quot; forever because nobody updated Zoho? They show up here."
    >

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Tile label="Stuck leads" value={counts.total} accent={counts.total > 0 ? "amber" : undefined} />
        <Tile label="Stuck 14+ days" value={counts.veryStuck} accent={counts.veryStuck > 0 ? "rose" : undefined} />
        <Tile label="Distinct stages" value={stages.length} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Filter className="w-3 h-3" /> No stage move in
        </span>
        {STUCK_DAYS_OPTIONS.map((d) => (
          <Button key={d} size="sm" variant={stuckDays === d ? "default" : "outline"} onClick={() => setStuckDays(d)}>
            {d}d
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">Stage:</span>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="text-xs border rounded px-2 py-1 bg-background"
        >
          <option value="all">All ({leads.filter((l) => l.days_in_stage >= stuckDays).length})</option>
          {stages.map(([stage, n]) => (
            <option key={stage} value={stage}>{stage} ({n})</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={filtered.length === 0}
          className="ml-auto gap-1.5"
          onClick={() => {
            logAudit("export", "leads", null, { format: "csv", count: filtered.length, surface: "ops_stuck_leads", stuck_days: stuckDays });
            downloadCsv(`stuck-leads-${new Date().toISOString().slice(0, 10)}.csv`, filtered, [
              { key: "first_name", label: "First name" },
              { key: "last_name", label: "Last name" },
              { key: "primary_phone_normalized", label: "Phone" },
              { key: "stage", label: "Current stage" },
              { key: "days_in_stage", label: "Days in stage" },
              { key: "owner", label: "Owner", format: (v) => v?.full_name ?? v?.email ?? "" },
              { key: "insurance_provider", label: "Insurance" },
              { key: "urgency", label: "Urgency" },
              { key: "last_transition_at", label: "Last transition", format: (v) => v ? new Date(v).toISOString() : "(never moved)" },
              { key: "created_at", label: "Lead created", format: (v) => v ? new Date(v).toISOString() : "" },
            ]);
          }}
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && filtered.length === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          Nothing stuck at this threshold. Either everyone's flowing through stages, or the cutoff is too tight.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {filtered.map((l) => {
          const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown";
          const veryStuck = l.days_in_stage >= 14;
          return (
            <Link key={l.id} href={`/leads/${l.id}`} className="block">
              <Card className={`hover:bg-accent/30 transition-colors ${veryStuck ? "border-l-4 border-l-rose-500" : "border-l-4 border-l-amber-500"}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{name}</span>
                        {l.stage && (
                          <Badge variant="outline" className="text-[10px]">{l.stage}</Badge>
                        )}
                        <Badge variant="outline" className={`text-[10px] gap-1 ${veryStuck ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : "border-amber-500/40 text-amber-700 dark:text-amber-400"}`}>
                          <Hourglass className="w-3 h-3" /> {l.days_in_stage}d in stage
                        </Badge>
                        {l.urgency === "high" && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">high urgency</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        {l.primary_phone_normalized && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {l.primary_phone_normalized}</span>}
                        {l.insurance_provider && <span>{l.insurance_provider}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        <span><Activity className="w-3 h-3 inline-block" /> Last move: {l.last_transition_at ? fmtTime(l.last_transition_at) : <span className="">never moved</span>}</span>
                        <span>· <Clock className="w-3 h-3 inline-block" /> Created {fmtTime(l.created_at)}</span>
                      </div>
                      {l.owner && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <UserIcon className="w-3 h-3" /> Owner: {l.owner.full_name ?? l.owner.email}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: "amber" | "rose" }) {
  const accentClass = accent === "rose"
    ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
    : accent === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15"
      : "";
  return (
    <div className={`border rounded-lg p-3 ${accentClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}
