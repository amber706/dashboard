import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  TrendingUp, Loader2, Trophy, XCircle, Clock,
  Users, Activity, ChevronDown, ChevronRight, Phone, Calendar,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Category = "won" | "lost" | "in_progress";

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  stage: string | null;
  outcome_category: Category | null;
  outcome_set_at: string | null;
  first_touch_source_category: string | null;
  last_touch_call_id: string | null;
  first_touch_call_id: string | null;
  owner_id: string | null;
  created_at: string;
  last_touch_call: { id: string; ctm_call_id: string; started_at: string | null; ctm_raw_payload: any; specialist_id: string | null } | null;
  owner: { id: string; full_name: string | null; email: string | null } | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  won: "Admitted",
  lost: "Churned",
  in_progress: "In progress",
};

const CATEGORY_CLASS: Record<Category, string> = {
  won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  lost: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function OpsOutcomes() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [expandedSection, setExpandedSection] = useState<"specialist" | "source" | null>("specialist");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from("leads")
      .select(`
        id, first_name, last_name, primary_phone_normalized, stage,
        outcome_category, outcome_set_at, first_touch_source_category,
        last_touch_call_id, first_touch_call_id, owner_id, created_at,
        last_touch_call:call_sessions!leads_last_touch_call_id_fkey(id, ctm_call_id, started_at, ctm_raw_payload, specialist_id),
        owner:profiles!leads_owner_id_fkey(id, full_name, email)
      `)
      .gte("created_at", since)
      .order("outcome_set_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (filter !== "all") q = q.eq("outcome_category", filter);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setLeads((data ?? []) as unknown as LeadRow[]);
    setLoading(false);
  }, [filter, windowDays]);

  useEffect(() => { load(); }, [load]);

  // Rollups across the loaded leads.
  const { totals, conversionPct, bySpecialist, bySource } = useMemo(() => {
    const t: Record<Category, number> = { won: 0, lost: 0, in_progress: 0 };
    const spec = new Map<string, { name: string; won: number; lost: number; in_progress: number }>();
    const src = new Map<string, { won: number; lost: number; in_progress: number }>();

    for (const l of leads) {
      const cat = l.outcome_category ?? "in_progress";
      t[cat]++;

      // Specialist credit goes to the last_touch_call's specialist (if any),
      // else the lead owner. Reps with neither are bucketed as "Unattributed".
      const callSpecialist = l.last_touch_call?.specialist_id ?? null;
      const ownerSpecialist = l.owner?.id ?? null;
      const specId = callSpecialist ?? ownerSpecialist ?? "__unattributed__";
      const specName = specId === "__unattributed__"
        ? "Unattributed"
        : (l.owner?.full_name ?? l.owner?.email ?? "Unknown");
      const cur = spec.get(specId) ?? { name: specName, won: 0, lost: 0, in_progress: 0 };
      cur[cat]++;
      spec.set(specId, cur);

      const source = l.first_touch_source_category ?? "Unknown";
      const sCur = src.get(source) ?? { won: 0, lost: 0, in_progress: 0 };
      sCur[cat]++;
      src.set(source, sCur);
    }

    const closed = t.won + t.lost;
    const pct = closed > 0 ? Math.round((t.won / closed) * 100) : null;
    return {
      totals: t,
      conversionPct: pct,
      bySpecialist: [...spec.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
      bySource: [...src.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
    };
  }, [leads]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <TrendingUp className="w-6 h-6" /> Outcome attribution
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Which calls, specialists, and sources actually drove patients into treatment.
          Outcomes pull from Zoho lead stages; mappings are editable and additions are
          treated as in-progress until classified.
        </p>
      </div>

      {/* Top rollup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Last {windowDays} days</span>
            <div className="flex gap-1">
              {[7, 30, 90, 365].map((d) => (
                <Button key={d} size="sm" variant={windowDays === d ? "default" : "outline"} onClick={() => setWindowDays(d)}>
                  {d === 365 ? "1y" : `${d}d`}
                </Button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <RollupTile icon={<Trophy className="w-4 h-4" />} label="Admitted" value={totals.won} accent="emerald"
              active={filter === "won"} onClick={() => setFilter(filter === "won" ? "all" : "won")} />
            <RollupTile icon={<XCircle className="w-4 h-4" />} label="Churned" value={totals.lost} accent="rose"
              active={filter === "lost"} onClick={() => setFilter(filter === "lost" ? "all" : "lost")} />
            <RollupTile icon={<Clock className="w-4 h-4" />} label="In progress" value={totals.in_progress}
              active={filter === "in_progress"} onClick={() => setFilter(filter === "in_progress" ? "all" : "in_progress")} />
            <RollupTile icon={<Activity className="w-4 h-4" />} label="Conversion rate" value={conversionPct == null ? "—" : `${conversionPct}%`}
              sub={`${totals.won}/${totals.won + totals.lost} closed`} />
          </div>
        </CardContent>
      </Card>

      {/* Per-specialist + per-source breakdowns */}
      <div className="grid lg:grid-cols-2 gap-4">
        <BreakdownCard
          title="By specialist (last-touch credit)"
          icon={<Users className="w-4 h-4" />}
          rows={bySpecialist.map((r) => ({ id: r.id, label: r.name, won: r.won, lost: r.lost, in_progress: r.in_progress }))}
          expanded={expandedSection === "specialist"}
          onToggle={() => setExpandedSection(expandedSection === "specialist" ? null : "specialist")}
        />
        <BreakdownCard
          title="By marketing source (first-touch)"
          icon={<TrendingUp className="w-4 h-4" />}
          rows={bySource.map((r) => ({ id: r.source, label: r.source, ...r }))}
          expanded={expandedSection === "source"}
          onToggle={() => setExpandedSection(expandedSection === "source" ? null : "source")}
        />
      </div>

      {/* Lead list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Leads {filter !== "all" && <Badge className={`${CATEGORY_CLASS[filter as Category]} ml-2 text-[10px]`} variant="outline">filter: {CATEGORY_LABEL[filter as Category]}</Badge>}</span>
            {filter !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setFilter("all")}>Clear</Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}
          {!loading && !error && leads.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No leads in this window. Outcomes appear here once Zoho stages have been pulled and classified.
            </div>
          )}
          <div className="divide-y">
            {leads.map((l) => {
              const cat = l.outcome_category ?? "in_progress";
              const agent = l.last_touch_call?.ctm_raw_payload?.agent;
              const agentName = agent?.name ?? agent?.email ?? null;
              return (
                <div key={l.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                  <Badge className={`${CATEGORY_CLASS[cat]} border text-[10px] uppercase shrink-0`} variant="outline">
                    {CATEGORY_LABEL[cat]}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown lead"}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                      {l.stage && <span>stage: {l.stage}</span>}
                      {l.first_touch_source_category && <span>source: {l.first_touch_source_category}</span>}
                      {agentName && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {agentName}</span>}
                      {l.outcome_set_at && (
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDate(l.outcome_set_at)}</span>
                      )}
                    </div>
                  </div>
                  {l.last_touch_call_id && (
                    <Link href={`/live/${l.last_touch_call_id}`} className="text-xs text-primary hover:underline shrink-0 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Last call
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RollupTile({ icon, label, value, sub, accent, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  accent?: "emerald" | "rose";
  active?: boolean;
  onClick?: () => void;
}) {
  const accentClass = accent === "emerald"
    ? "border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/15"
    : accent === "rose"
      ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
      : "";
  const interactive = onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : "";
  const activeClass = active ? "ring-2 ring-primary" : "";
  const Wrapper: any = onClick ? "button" : "div";
  return (
    <Wrapper onClick={onClick} className={`text-left border rounded-lg p-3 ${accentClass} ${interactive} ${activeClass}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Wrapper>
  );
}

function BreakdownCard({ title, icon, rows, expanded, onToggle }: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ id: string; label: string; won: number; lost: number; in_progress: number }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visibleRows = expanded ? rows : rows.slice(0, 5);
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">{icon} {title}</span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">No data in window.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left py-1.5 pr-2">Name</th>
                <th className="text-right py-1.5 px-2">Admitted</th>
                <th className="text-right py-1.5 px-2">Churned</th>
                <th className="text-right py-1.5 px-2">In prog</th>
                <th className="text-right py-1.5 pl-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const closed = r.won + r.lost;
                const pct = closed > 0 ? Math.round((r.won / closed) * 100) : null;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5 pr-2 truncate max-w-[180px]">{r.label}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.won}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-rose-700 dark:text-rose-400">{r.lost}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.in_progress}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums font-medium">{pct == null ? "—" : `${pct}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!expanded && rows.length > 5 && (
          <div className="text-[11px] text-muted-foreground mt-2 text-center">+{rows.length - 5} more — click to expand</div>
        )}
      </CardContent>
    </Card>
  );
}
