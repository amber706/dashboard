// Admissions conversion funnel + pipeline view.
//
// Funnel stages (per Cornerstone's actual workflow):
//   1. Calls         — inbound CTM calls in window
//   2. Leads created — leads.created_at in window
//   3. MQL           — Zoho Deals.Created_Time in window
//   4. VOB ran       — Zoho Deals.VOB_Submitted_Date in window
//   5. Intake scheduled — Deal Stage entered an intake/tour scheduled state
//   6. Admitted      — Deal Admit_Date in window OR Stage="Closed - Admitted"
//
// Pipeline view (current snapshot, NOT windowed):
//   - Leads pipeline: leads grouped by stage, count + avg days idle
//   - Deals pipeline: open Zoho Deals grouped by Stage, count + avg days
//
// Backed by funnel-stats Edge Function (single round-trip, Zoho COQL on
// the server side).

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  PhoneIncoming, User as UserIcon, Briefcase, ShieldCheck,
  Calendar, Trophy, Loader2, AlertTriangle, ArrowDown, Filter, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";

type RangeKey = "mtd" | "7d" | "30d" | "90d" | "ytd" | "all";
const RANGE_LABEL: Record<RangeKey, string> = {
  mtd: "Month to date",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
  all: "All time",
};

interface FunnelStage {
  key: string;
  label: string;
  description: string;
  count: number;
  step_pct: number | null;
  survival_pct: number | null;
  dropoff: number | null;
}

interface PipelineRow {
  stage: string;
  count: number;
  avg_days_in_stage: number | null;
}

interface FunnelStatsResponse {
  ok: boolean;
  funnel: FunnelStage[];
  leads_pipeline: PipelineRow[];
  deals_pipeline: PipelineRow[];
  zoho_connected: boolean;
  zoho_warning?: string | null;
  zoho_errors?: string[];
  error?: string;
}

const STAGE_ICON: Record<string, typeof PhoneIncoming> = {
  calls: PhoneIncoming,
  leads: UserIcon,
  mql: Briefcase,
  vob_ran: ShieldCheck,
  intake_sched: Calendar,
  admitted: Trophy,
};

function rangeBounds(range: RangeKey): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  if (range === "mtd") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), end };
  }
  if (range === "ytd") {
    return { start: new Date(now.getFullYear(), 0, 1).toISOString(), end };
  }
  if (range === "all") {
    return { start: new Date(2020, 0, 1).toISOString(), end };
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return { start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(), end };
}

export default function OpsFunnel() {
  const [range, setRange] = useState<RangeKey>("mtd");
  const [insurance, setInsurance] = useState<"all" | "ahcccs" | "commercial" | "self_pay">("all");
  const [data, setData] = useState<FunnelStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { start, end } = rangeBounds(range);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/funnel-stats`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ start_date: start, end_date: end, insurance }),
      });
      const json = await res.json() as FunnelStatsResponse;
      if (!json.ok) throw new Error(json.error ?? "funnel-stats failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range, insurance]);

  useEffect(() => { load(); }, [load]);

  const biggestDrop = useMemo(() => {
    if (!data || data.funnel.length < 2) return null;
    let worst: { from: string; to: string; pct: number; count: number } | null = null;
    for (let i = 1; i < data.funnel.length; i++) {
      const prev = data.funnel[i - 1];
      const cur = data.funnel[i];
      if (prev.count === 0 || cur.dropoff == null || cur.dropoff <= 0) continue;
      const dropPct = (cur.dropoff / prev.count) * 100;
      if (!worst || dropPct > worst.pct) {
        worst = { from: prev.label, to: cur.label, pct: dropPct, count: cur.dropoff };
      }
    }
    return worst;
  }, [data]);

  return (
    <PageShell
      eyebrow="FUNNEL"
      title="Conversion funnel & pipeline"
      subtitle="Where leads leak across the admissions stages, and what's in flight right now. Funnel and Zoho pipeline are pulled together; Zoho metrics need the Deals scope on the OAuth token."
      maxWidth={1400}
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9 gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(["mtd", "7d", "30d", "90d", "ytd", "all"] as const).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="h-8">
            {RANGE_LABEL[r]}
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <span className="text-xs text-muted-foreground">Insurance:</span>
        {(["all", "ahcccs", "commercial", "self_pay"] as const).map((f) => (
          <Button key={f} size="sm" variant={insurance === f ? "default" : "outline"} onClick={() => setInsurance(f)} className="h-8">
            {f === "all" ? "All" : f === "ahcccs" ? "AHCCCS" : f === "commercial" ? "Commercial" : "Self-pay"}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {data?.zoho_warning && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold mb-1">Zoho Deals data isn't loading.</div>
              <div className="text-muted-foreground">{data.zoho_warning}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.zoho_errors && data.zoho_errors.length > 0 && (
        <Card className="border-destructive">
          <CardContent className="pt-4 pb-4 text-sm text-destructive">
            <div className="font-semibold mb-1">Zoho COQL errors:</div>
            <ul className="list-disc list-inside space-y-0.5">
              {data.zoho_errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* FUNNEL */}
      {!loading && data && (
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
                {data.funnel.map((s, i) => (
                  <FunnelStageRow key={s.key} stage={s} isFirst={i === 0} isLast={i === data.funnel.length - 1} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* PIPELINE — current state */}
          <div className="grid lg:grid-cols-2 gap-4">
            <PipelineCard
              title="Leads in flight"
              subtitle="Active leads grouped by stage (Cornerstone-side)"
              rows={data.leads_pipeline}
            />
            <PipelineCard
              title="Deals in flight"
              subtitle="Open Zoho Deals grouped by Stage"
              rows={data.deals_pipeline}
              emptyMessage={data.zoho_warning ? "Zoho Deals data not available — see warning above." : "No open deals."}
            />
          </div>
        </>
      )}

      {loading && !data && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Computing funnel + pipeline…
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function FunnelStageRow({ stage, isFirst, isLast }: { stage: FunnelStage; isFirst: boolean; isLast: boolean }) {
  const Icon = STAGE_ICON[stage.key] ?? UserIcon;
  const survival = stage.survival_pct ?? 0;
  const stepPct = stage.step_pct;
  const stepColor = stepPct == null ? "text-muted-foreground"
    : stepPct >= 70 ? "text-emerald-600 dark:text-emerald-400"
    : stepPct >= 40 ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";
  const barColor = isLast ? "bg-emerald-500" : "bg-blue-500/70";

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-44 shrink-0 flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{stage.label}</div>
            <div className="text-[10px] text-muted-foreground truncate">{stage.description}</div>
          </div>
        </div>

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

      {!isLast && (
        <div className="flex justify-center py-0.5">
          <ArrowDown className="w-3 h-3 text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
}

function PipelineCard({
  title,
  subtitle,
  rows,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  rows: PipelineRow[];
  emptyMessage?: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{title}</span>
          <Badge variant="outline" className="text-[10px]">{total} in flight</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">{emptyMessage ?? "Nothing in flight."}</div>
        ) : (
          <div className="space-y-1">
            {rows.slice(0, 10).map((r) => {
              const pct = total > 0 ? (r.count / total) * 100 : 0;
              const ageColor = r.avg_days_in_stage == null ? "text-muted-foreground"
                : r.avg_days_in_stage >= 14 ? "text-rose-600 dark:text-rose-400"
                : r.avg_days_in_stage >= 7 ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground";
              return (
                <div key={r.stage} className="flex items-center gap-3 text-sm">
                  <div className="w-44 truncate text-muted-foreground">{r.stage}</div>
                  <div className="flex-1 relative">
                    <div className="h-5 bg-muted rounded-md overflow-hidden">
                      <div
                        className="h-full bg-blue-500/60"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <div className="absolute inset-0 flex items-center px-2 text-xs tabular-nums">
                      <span className="font-medium">{r.count}</span>
                      <span className="text-muted-foreground ml-2">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className={`w-20 text-right text-xs tabular-nums ${ageColor}`}>
                    {r.avg_days_in_stage == null ? "—" : `${r.avg_days_in_stage}d avg`}
                  </div>
                </div>
              );
            })}
            {rows.length > 10 && (
              <div className="text-xs text-muted-foreground pt-1">+ {rows.length - 10} more stages</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
