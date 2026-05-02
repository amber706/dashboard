// Admissions conversion funnel.
//
// Shows where leads leak across the eight admissions stages:
//   Inbound → Answered → Conversation (had transcript) → Lead created
//   → VOB started → VOB verified → Intake scheduled → Intake completed
//   → Admitted (outcome=won)
//
// Each stage shows: count, conversion rate to next stage, drop-off,
// % of inbound that survived to here. The single most-asked-for view
// in any admissions ops org because it answers "where are we losing
// people" without anyone running SQL.

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Phone, PhoneIncoming, MessageSquare, User as UserIcon, ShieldCheck,
  CheckCircle2, Calendar, Trophy, Loader2, AlertTriangle,
  ArrowDown, Filter,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";

type RangeKey = "7d" | "30d" | "90d" | "ytd" | "all";
const RANGE_LABEL: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "ytd": "Year to date",
  "all": "All time",
};

interface StageCount {
  key: string;
  label: string;
  description: string;
  icon: typeof Phone;
  count: number;
  // Stage-to-stage conversion: this stage's count / previous stage's count
  step_pct: number | null;
  // Top-of-funnel survival: this stage's count / inbound count
  survival_pct: number | null;
  // Drop-off from previous stage (count)
  dropoff: number | null;
}

function rangeStart(range: RangeKey): string | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (range === "7d") return new Date(now - 7 * day).toISOString();
  if (range === "30d") return new Date(now - 30 * day).toISOString();
  if (range === "90d") return new Date(now - 90 * day).toISOString();
  if (range === "ytd") {
    const start = new Date();
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  return null;
}

export default function OpsFunnel() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [insuranceFilter, setInsuranceFilter] = useState<"all" | "ahcccs" | "commercial" | "self_pay">("all");
  const [stages, setStages] = useState<StageCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sinceISO = rangeStart(range);

    try {
      // Anchor the funnel on calls — every funnel stage chains back to
      // an inbound call session. We pull the call ids in scope first, then
      // fan out to derive each subsequent stage.
      let callsQuery = supabase
        .from("call_sessions")
        .select("id, status, lead_id, talk_seconds")
        .eq("direction", "inbound");
      if (sinceISO) callsQuery = callsQuery.gte("started_at", sinceISO);

      const { data: callRows, error: cErr } = await callsQuery;
      if (cErr) throw cErr;
      const calls = (callRows ?? []) as Array<{
        id: string; status: string | null; lead_id: string | null; talk_seconds: number | null;
      }>;

      const inboundCount = calls.length;
      const answered = calls.filter((c) =>
        c.status && ["completed", "in_progress", "transferred"].includes(c.status)
      );
      const answeredIds = answered.map((c) => c.id);
      const answeredCount = answered.length;

      // "Real conversation": at least one transcript_chunk for the call.
      let conversationCount = 0;
      if (answeredIds.length > 0) {
        // Distinct call ids in transcript_chunks
        const { data: chunkRows } = await supabase
          .from("transcript_chunks")
          .select("call_session_id")
          .in("call_session_id", answeredIds);
        const distinctCalls = new Set<string>();
        for (const r of (chunkRows ?? []) as any[]) distinctCalls.add(r.call_session_id);
        conversationCount = distinctCalls.size;
      }

      // Leads created from these calls (any call with a lead_id)
      const leadIds = Array.from(new Set(answered.map((c) => c.lead_id).filter((id): id is string => Boolean(id))));
      const leadCreatedCount = leadIds.length;

      // Apply insurance filter to the lead set if requested
      let filteredLeadIds = leadIds;
      if (insuranceFilter !== "all" && leadIds.length > 0) {
        const ahcccsList = ["Mercy Care","AIHP","AZ Complete","Banner","Care 1st","Health Choice","Humana AHCCCS","Molina","State BHS","UHC AHCCCS"];
        let q = supabase.from("leads").select("id, insurance_provider").in("id", leadIds);
        if (insuranceFilter === "ahcccs") q = q.in("insurance_provider", ahcccsList);
        else if (insuranceFilter === "self_pay") q = q.ilike("insurance_provider", "%self%");
        else if (insuranceFilter === "commercial") q = q.not("insurance_provider", "in", `(${[...ahcccsList, null].map((v) => v ? `"${v}"` : "null").join(",")})`);
        const { data: lf } = await q;
        filteredLeadIds = ((lf ?? []) as any[]).map((r) => r.id);
      }

      // VOB started: vob_status not null
      let vobStartedCount = 0;
      let vobVerifiedCount = 0;
      let intakeScheduledCount = 0;
      let intakeCompletedCount = 0;
      let admittedCount = 0;
      if (filteredLeadIds.length > 0) {
        const { data: leadStages } = await supabase
          .from("leads")
          .select("id, vob_status, intake_scheduled_at, intake_status, outcome_category")
          .in("id", filteredLeadIds);
        for (const l of (leadStages ?? []) as any[]) {
          if (l.vob_status) vobStartedCount++;
          if (l.vob_status && ["verified_in_network", "verified_out_of_network"].includes(l.vob_status)) vobVerifiedCount++;
          if (l.intake_scheduled_at) intakeScheduledCount++;
          if (l.intake_status === "completed") intakeCompletedCount++;
          if (l.outcome_category === "won") admittedCount++;
        }
      }

      // Build stage list with conversion math
      const raw: Array<Pick<StageCount, "key" | "label" | "description" | "icon" | "count">> = [
        { key: "inbound", label: "Inbound calls", description: "All inbound CTM calls in window", icon: PhoneIncoming, count: inboundCount },
        { key: "answered", label: "Answered", description: "Status: completed, in_progress, or transferred", icon: Phone, count: answeredCount },
        { key: "conversation", label: "Real conversation", description: "Call had transcribed content (>0 chunks)", icon: MessageSquare, count: conversationCount },
        { key: "lead", label: "Lead created", description: "Caller linked to a leads row", icon: UserIcon, count: insuranceFilter === "all" ? leadCreatedCount : filteredLeadIds.length },
        { key: "vob_started", label: "VOB started", description: "Lead has any vob_status", icon: ShieldCheck, count: vobStartedCount },
        { key: "vob_verified", label: "VOB verified", description: "VOB came back in or out of network", icon: ShieldCheck, count: vobVerifiedCount },
        { key: "intake_scheduled", label: "Intake scheduled", description: "On the intake calendar", icon: Calendar, count: intakeScheduledCount },
        { key: "intake_completed", label: "Intake completed", description: "Patient walked in", icon: CheckCircle2, count: intakeCompletedCount },
        { key: "admitted", label: "Admitted", description: "Outcome flipped to won", icon: Trophy, count: admittedCount },
      ];

      const top = raw[0].count || 1;
      const computed: StageCount[] = raw.map((s, i) => {
        const prev = i === 0 ? null : raw[i - 1];
        const stepPct = prev && prev.count > 0 ? (s.count / prev.count) * 100 : null;
        const survivalPct = top > 0 ? (s.count / top) * 100 : null;
        const dropoff = prev ? prev.count - s.count : null;
        return { ...s, step_pct: stepPct, survival_pct: survivalPct, dropoff };
      });

      setStages(computed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range, insuranceFilter]);

  useEffect(() => { load(); }, [load]);

  const biggestDrop = useMemo(() => {
    if (stages.length < 2) return null;
    let worst: { from: string; to: string; pct: number; count: number } | null = null;
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1];
      const cur = stages[i];
      if (prev.count === 0 || cur.dropoff == null) continue;
      const dropPct = prev.count > 0 ? ((prev.count - cur.count) / prev.count) * 100 : 0;
      if (cur.dropoff > 0 && (!worst || dropPct > worst.pct)) {
        worst = { from: prev.label, to: cur.label, pct: dropPct, count: cur.dropoff };
      }
    }
    return worst;
  }, [stages]);

  return (
    <PageShell
      eyebrow="FUNNEL"
      title="Conversion funnel"
      subtitle="Where leads leak. Each row is a stage; the bar shows survival from inbound. Step % is conversion to that stage from the one before. Use this to find the biggest leak and fix it first."
      maxWidth={1400}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(["7d", "30d", "90d", "ytd", "all"] as const).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="h-8">
            {RANGE_LABEL[r]}
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <span className="text-xs text-muted-foreground">Insurance:</span>
        {(["all", "ahcccs", "commercial", "self_pay"] as const).map((f) => (
          <Button key={f} size="sm" variant={insuranceFilter === f ? "default" : "outline"} onClick={() => setInsuranceFilter(f)} className="h-8">
            {f === "all" ? "All" : f === "ahcccs" ? "AHCCCS" : f === "commercial" ? "Commercial" : "Self-pay"}
          </Button>
        ))}
      </div>

      {loading && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Computing funnel…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && (
        <>
          {biggestDrop && biggestDrop.pct > 30 && (
            <Card className="border-rose-500/30 bg-rose-500/5">
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <span className="font-semibold">Biggest leak:</span> <span className="text-muted-foreground">{biggestDrop.from}</span> → <span className="text-foreground">{biggestDrop.to}</span>{" "}
                  loses {Math.round(biggestDrop.pct)}% ({biggestDrop.count} {biggestDrop.count === 1 ? "person" : "people"}). Fix this stage first for the biggest impact on admits.
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Stages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stages.map((s, i) => (
                  <FunnelStage key={s.key} stage={s} isFirst={i === 0} isLast={i === stages.length - 1} />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}

function FunnelStage({ stage, isFirst, isLast }: { stage: StageCount; isFirst: boolean; isLast: boolean }) {
  const Icon = stage.icon;
  const survival = stage.survival_pct ?? 0;
  const stepPct = stage.step_pct;
  const stepColor = stepPct == null ? "text-muted-foreground"
    : stepPct >= 70 ? "text-emerald-600 dark:text-emerald-400"
    : stepPct >= 40 ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";
  // Color the bar by stage progression — earlier stages blue, later stages
  // shift toward emerald. Conveys "deeper in the funnel = closer to admit."
  const barColor = isLast ? "bg-emerald-500" : "bg-blue-500/70";

  return (
    <div>
      <div className="flex items-center gap-3">
        {/* Stage icon + label */}
        <div className="w-44 shrink-0 flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{stage.label}</div>
            <div className="text-[10px] text-muted-foreground truncate">{stage.description}</div>
          </div>
        </div>

        {/* Bar — width = % of top-of-funnel */}
        <div className="flex-1 min-w-0 relative">
          <div className="h-7 bg-muted rounded-md overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${Math.max(survival, 2)}%` }}
            />
          </div>
          <div className="absolute inset-0 flex items-center px-2 text-xs font-medium tabular-nums">
            <span>{stage.count.toLocaleString()}</span>
            {stage.survival_pct != null && (
              <span className="text-muted-foreground ml-2">{survival.toFixed(1)}% of inbound</span>
            )}
          </div>
        </div>

        {/* Step conversion + drop-off */}
        <div className="w-40 shrink-0 text-right">
          {!isFirst && stepPct != null ? (
            <>
              <div className={`text-sm font-semibold tabular-nums ${stepColor}`}>{stepPct.toFixed(0)}%</div>
              <div className="text-[10px] text-muted-foreground">
                step conversion · −{(stage.dropoff ?? 0).toLocaleString()} dropped
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground">top of funnel</div>
          )}
        </div>
      </div>

      {/* Connector arrow between rows */}
      {!isLast && (
        <div className="flex justify-center py-0.5">
          <ArrowDown className="w-3 h-3 text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
}
