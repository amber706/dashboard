// /bd — BD Performance Dashboard.
//
// KPIs (referrals in/out, admits, conversion, meetings), top referring
// accounts, per-BD-rep performance table. Driven by the structured
// Zoho fields Cornerstone uses: Deal.Referring_Company / Referred_Out /
// BD_Rep / Pipeline. Real-time via the bd-summary Edge Function.
//
// Filters:
//   - Date window (7/30/90/YTD)
//   - Pipeline (DUI / DV / Commercial / AHCCCS) — DUI and DV are completely
//     different service lines from treatment, so the multi-select matters
//   - Per-rep filter on the Per-BD-rep table
//
// Drilldowns:
//   - Each cell in the per-rep table (in/out/admits/meetings) opens a
//     side sheet with the underlying Deal records from bd-rep-deals
//   - Each row in top accounts → /bd/account?id=<X>

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, RefreshCw, TrendingUp, Calendar, Target,
  ArrowRight, Search, ArrowLeftRight, ExternalLink, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

// Pipeline groups → actual Zoho Deal.Pipeline picklist values.
//   DUI       → "DUI", "DUI - Cash"
//   DV        → "DV - Cash"
//   Commercial→ "Commercial-Cash"
//   AHCCCS    → "AHCCCS"
const PIPELINE_GROUPS = {
  DUI: ["DUI", "DUI - Cash"],
  DV: ["DV - Cash"],
  Commercial: ["Commercial-Cash"],
  AHCCCS: ["AHCCCS"],
} as const;
type PipelineGroup = keyof typeof PIPELINE_GROUPS;

interface BdSummary {
  ok: boolean;
  window: { days: number; start: string; end: string };
  kpis: {
    referrals_in: number;
    admits: number;
    conversion_rate: number | null;
    meetings_completed: number;
    referrals_out: number;
    net_referral_balance: number;
  };
  top_accounts: Array<{
    account_id: string;
    account_name: string;
    referrals_in: number;
    admits: number;
    referrals_out: number;
    net_balance: number;
    conversion_rate: number | null;
    last_referral_at: string | null;
    last_meeting_at: string | null;
    bd_owner_count: number;
  }>;
  reps: Array<{
    bd_rep: string;
    owner_ids: string[];
    referrals_in: number;
    admits: number;
    referrals_out: number;
    net_balance: number;
    conversion_rate: number | null;
    meetings_completed: number;
  }>;
}

interface RepProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  zoho_user_id: string | null;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Year to date", days: Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (24 * 60 * 60 * 1000)) },
];

type DrilldownCategory = "in" | "out" | "admits" | "meetings";

interface Drilldown {
  bd_rep: string;
  category: DrilldownCategory;
  owner_ids: string[];
}

export default function BdDashboard() {
  const [days, setDays] = useState<number>(30);
  const [pipelineGroups, setPipelineGroups] = useState<Set<PipelineGroup>>(new Set());
  const [selectedReps, setSelectedReps] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [data, setData] = useState<BdSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<RepProfile[]>([]);

  // Resolve picked pipeline groups to the union of Zoho values they map to.
  const pipelinesParam = useMemo(() => {
    if (pipelineGroups.size === 0) return undefined;
    const out: string[] = [];
    for (const g of pipelineGroups) out.push(...PIPELINE_GROUPS[g]);
    return out;
  }, [pipelineGroups]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-summary`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ days, pipelines: pipelinesParam }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days, pipelinesParam]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("is_active", true);
      setProfiles((data ?? []) as RepProfile[]);
    })();
  }, []);

  // BD_Rep picklist holds first names only ("Joey", "Casey"). Match on
  // first-name → profile.full_name first token. Never fall back to owner.
  function resolveRep(bdRep: string): { name: string; profileId: string | null } {
    const trimmed = bdRep.trim();
    if (!trimmed || trimmed === "(unassigned)" || trimmed === "None") {
      return { name: trimmed || "(unassigned)", profileId: null };
    }
    const target = trimmed.toLowerCase();
    const exact = profiles.find((p) => (p.full_name ?? "").trim().toLowerCase() === target);
    if (exact) return { name: exact.full_name ?? trimmed, profileId: exact.id };
    const firstNameMatch = profiles.find((p) => {
      const fn = (p.full_name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
      return fn && fn === target;
    });
    if (firstNameMatch) return { name: firstNameMatch.full_name ?? trimmed, profileId: firstNameMatch.id };
    return { name: trimmed, profileId: null };
  }

  function togglePipeline(g: PipelineGroup) {
    setPipelineGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }
  function toggleRep(bdRep: string) {
    setSelectedReps((prev) => {
      const next = new Set(prev);
      if (next.has(bdRep)) next.delete(bdRep);
      else next.add(bdRep);
      return next;
    });
  }

  const visibleReps = useMemo(() => {
    if (!data) return [];
    if (selectedReps.size === 0) return data.reps;
    return data.reps.filter((r) => selectedReps.has(r.bd_rep));
  }, [data, selectedReps]);

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Performance Dashboard"
      subtitle="Team and individual BD performance — referrals in & out, admits, conversion, meetings. Live from Zoho CRM."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd/account">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <Search className="w-3.5 h-3.5" /> Account Intelligence
            </Button>
          </Link>
          <Link href="/bd/meetings">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <Calendar className="w-3.5 h-3.5" /> Meetings
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      }
    >
      {/* Filters: window + pipeline */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
          {PRESETS.map((p) => (
            <Button key={p.label} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)} className="h-8 text-xs">
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
          <Button
            size="sm"
            variant={pipelineGroups.size === 0 ? "default" : "outline"}
            onClick={() => setPipelineGroups(new Set())}
            className="h-8 text-xs"
            title="No filter — all service lines counted."
          >
            All
          </Button>
          {(Object.keys(PIPELINE_GROUPS) as PipelineGroup[]).map((g) => (
            <Button
              key={g}
              size="sm"
              variant={pipelineGroups.has(g) ? "default" : "outline"}
              onClick={() => togglePipeline(g)}
              className="h-8 text-xs"
              title={`Includes Zoho values: ${PIPELINE_GROUPS[g].join(", ")}`}
            >
              {g}
            </Button>
          ))}
          {pipelineGroups.size > 0 && (
            <span className="text-[10px] text-muted-foreground">
              showing {Array.from(pipelineGroups).join(" + ")} only
            </span>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Referrals in"  value={data?.kpis.referrals_in ?? null} loading={loading} icon={<TrendingUp className="w-4 h-4 text-blue-500" />} sub="Deals w/ Referring Co." />
        <Kpi label="Referrals out" value={data?.kpis.referrals_out ?? null} loading={loading} icon={<ArrowRight className="w-4 h-4 text-orange-500" />} sub="Deals w/ Referred Out" />
        <Kpi label="Net balance"   value={data?.kpis.net_referral_balance ?? null} loading={loading} icon={<ArrowLeftRight className="w-4 h-4 text-slate-500" />} sub="In − Out" />
        <Kpi label="Admits"        value={data?.kpis.admits ?? null} loading={loading} icon={<Target className="w-4 h-4 text-emerald-500" />} sub="From referred-in deals" />
        <Kpi label="Conversion"    value={data?.kpis.conversion_rate != null ? `${data.kpis.conversion_rate}%` : "—"} loading={loading} icon={<Target className="w-4 h-4 text-amber-500" />} sub="Referral → Admit" />
        <Kpi label="Meetings"      value={data?.kpis.meetings_completed ?? null} loading={loading} icon={<Calendar className="w-4 h-4 text-violet-500" />} sub="Zoho Events tied to records" />
      </div>

      {/* Top referring accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Top referring accounts</span>
            <span className="text-xs font-normal text-muted-foreground">grouped by Deal.Referring_Company</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.top_accounts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">#</th>
                    <th className="text-left py-2 pr-3">Account</th>
                    <th className="text-right py-2 pr-3">In</th>
                    <th className="text-right py-2 pr-3">Out</th>
                    <th className="text-right py-2 pr-3">Net</th>
                    <th className="text-right py-2 pr-3">Admits</th>
                    <th className="text-right py-2 pr-3">Conv</th>
                    <th className="text-right py-2 pr-3">Last referral</th>
                    <th className="text-right py-2 pr-3">Last meeting</th>
                    <th className="text-right py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_accounts.map((a, i) => (
                    <tr key={a.account_id} className="border-t">
                      <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-3 font-medium">{a.account_name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.referrals_in}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-orange-600 dark:text-orange-400">{a.referrals_out}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${a.net_balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {a.net_balance > 0 ? `+${a.net_balance}` : a.net_balance}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.admits}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.conversion_rate != null ? `${a.conversion_rate}%` : "—"}</td>
                      <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                        {a.last_referral_at ? new Date(a.last_referral_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                        {a.last_meeting_at ? new Date(a.last_meeting_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Link href={`/bd/account?id=${a.account_id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                          Open <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No BD-sourced referrals in this window.</p>
          )}
        </CardContent>
      </Card>

      {/* Per-rep table */}
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Per BD rep</span>
            <span className="text-xs font-normal text-muted-foreground">grouped by Deal.BD_Rep / Outbound_Referral_BD_Rep · click any number to drill in</span>
          </CardTitle>
          {/* Rep filter chips */}
          {data && data.reps.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Show only</span>
              <Button size="sm" variant={selectedReps.size === 0 ? "default" : "outline"} onClick={() => setSelectedReps(new Set())} className="h-7 text-[11px] px-2">
                All ({data.reps.length})
              </Button>
              {data.reps.map((r) => {
                const { name } = resolveRep(r.bd_rep);
                return (
                  <Button
                    key={r.bd_rep}
                    size="sm"
                    variant={selectedReps.has(r.bd_rep) ? "default" : "outline"}
                    onClick={() => toggleRep(r.bd_rep)}
                    className="h-7 text-[11px] px-2 gap-1"
                  >
                    {name}
                    {selectedReps.has(r.bd_rep) && <X className="w-3 h-3" />}
                  </Button>
                );
              })}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {data && visibleReps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">Rep</th>
                    <th className="text-right py-2 pr-3">In</th>
                    <th className="text-right py-2 pr-3">Out</th>
                    <th className="text-right py-2 pr-3">Net</th>
                    <th className="text-right py-2 pr-3">Admits</th>
                    <th className="text-right py-2 pr-3">Conv</th>
                    <th className="text-right py-2 pr-3">Meetings</th>
                    <th className="text-right py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReps.map((r) => {
                    const { name, profileId } = resolveRep(r.bd_rep);
                    return (
                      <tr key={r.bd_rep} className="border-t">
                        <td className="py-2 pr-3 font-medium">{name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <DrillBtn n={r.referrals_in} onClick={() => setDrilldown({ bd_rep: r.bd_rep, category: "in", owner_ids: r.owner_ids })} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-orange-600 dark:text-orange-400">
                          <DrillBtn n={r.referrals_out} onClick={() => setDrilldown({ bd_rep: r.bd_rep, category: "out", owner_ids: r.owner_ids })} />
                        </td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${r.net_balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                          {r.net_balance > 0 ? `+${r.net_balance}` : r.net_balance}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <DrillBtn n={r.admits} onClick={() => setDrilldown({ bd_rep: r.bd_rep, category: "admits", owner_ids: r.owner_ids })} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.conversion_rate != null ? `${r.conversion_rate}%` : "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <DrillBtn n={r.meetings_completed} onClick={() => setDrilldown({ bd_rep: r.bd_rep, category: "meetings", owner_ids: r.owner_ids })} />
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {profileId && (
                            <Link href={`/ops/specialist/${profileId}`} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                              Profile <ArrowRight className="w-3 h-3" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No rep activity in this window.</p>
          )}
        </CardContent>
      </Card>

      {/* Drilldown sheet */}
      <Sheet open={drilldown != null} onOpenChange={(o) => { if (!o) setDrilldown(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {drilldown && (
            <RepDrilldown
              drilldown={drilldown}
              days={days}
              pipelines={pipelinesParam}
              repName={resolveRep(drilldown.bd_rep).name}
            />
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function Kpi({ label, value, loading, icon, sub }: {
  label: string;
  value: number | string | null;
  loading: boolean;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">
          {loading && value == null ? <Loader2 className="w-4 h-4 animate-spin" /> : (value ?? "—")}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Inline drill button — shows the count, becomes a link when > 0.
function DrillBtn({ n, onClick }: { n: number; onClick: () => void }) {
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <button onClick={onClick} className="text-primary hover:underline tabular-nums">
      {n}
    </button>
  );
}

const CATEGORY_LABEL: Record<DrilldownCategory, string> = {
  in: "Referrals in",
  out: "Referrals out",
  admits: "Admits",
  meetings: "Meetings",
};

function RepDrilldown({ drilldown, days, pipelines, repName }: {
  drilldown: Drilldown;
  days: number;
  pipelines: string[] | undefined;
  repName: string;
}) {
  const [deals, setDeals] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-rep-deals`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            bd_rep: drilldown.bd_rep,
            category: drilldown.category,
            days,
            pipelines,
            owner_ids: drilldown.owner_ids,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "load failed");
        setDeals(json.deals ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [drilldown, days, pipelines]);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {repName}
          <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[drilldown.category]}</Badge>
        </SheetTitle>
        <SheetDescription>
          {deals == null ? "Loading…" : `${deals.length} record${deals.length === 1 ? "" : "s"} in the last ${days} days`}
          {pipelines && pipelines.length > 0 && (
            <span className="ml-1">· filtered to {pipelines.join(", ")}</span>
          )}
        </SheetDescription>
      </SheetHeader>

      {loading && <div className="mt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading from Zoho…</div>}
      {error && <div className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</div>}

      {deals && deals.length === 0 && !loading && (
        <p className="mt-6 text-sm text-muted-foreground">No records.</p>
      )}

      {deals && deals.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          {drilldown.category === "meetings" ? <MeetingsList rows={deals} /> : <DealsList rows={deals} category={drilldown.category} />}
        </div>
      )}
    </>
  );
}

function DealsList({ rows, category }: { rows: any[]; category: DrilldownCategory }) {
  const showContact = category === "in" || category === "admits";
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
        <tr>
          <th className="text-left py-2 pr-3">Deal</th>
          <th className="text-left py-2 pr-3">{category === "out" ? "Referred to" : "Referring co."}</th>
          {showContact && <th className="text-left py-2 pr-3">Contact</th>}
          <th className="text-left py-2 pr-3">{category === "out" ? "Refer-out" : "Stage"}</th>
          <th className="text-left py-2 pr-3">Pipeline</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const account = category === "out"
            ? (d["Referred_Out.Account_Name"] as string) ?? "—"
            : (d["Referring_Company.Account_Name"] as string) ?? "—";
          const middle = category === "out"
            ? (d.Refer_Out_Date ? new Date(d.Refer_Out_Date).toLocaleDateString() : "—")
            : (d.Stage as string) ?? "—";
          const contactName = d["Referring_Business_Contact.Full_Name"] as string | null;
          const contactEmail = d["Referring_Business_Contact.Email"] as string | null;
          const contactPhone = d["Referring_Business_Contact.Phone"] as string | null;
          return (
            <tr key={d.id} className="border-t align-top">
              <td className="py-2 pr-3 font-medium">{d.Deal_Name ?? "(no name)"}</td>
              <td className="py-2 pr-3 text-xs">{account}</td>
              {showContact && (
                <td className="py-2 pr-3 text-xs">
                  {contactName ? (
                    <div className="space-y-0.5">
                      <div>{contactName}</div>
                      {(contactEmail || contactPhone) && (
                        <div className="text-[10px] text-muted-foreground">{contactEmail}{contactEmail && contactPhone ? " · " : ""}{contactPhone}</div>
                      )}
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              )}
              <td className="py-2 pr-3 text-xs">{middle}</td>
              <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[9px]">{d.Pipeline ?? "—"}</Badge></td>
              <td className="py-2 pr-3">
                <a
                  href={`https://crm.zoho.com/crm/tab/Potentials/${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Zoho <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MeetingsList({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
        <tr>
          <th className="text-left py-2 pr-3">Title</th>
          <th className="text-left py-2 pr-3">Linked record</th>
          <th className="text-left py-2 pr-3">Venue</th>
          <th className="text-right py-2 pr-3">When</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const what = m.What_Id as { id?: string; name?: string } | string | null;
          const linkedName = typeof what === "string" ? what : what?.name ?? "—";
          return (
            <tr key={m.id} className="border-t align-top">
              <td className="py-2 pr-3 font-medium">{m.Event_Title ?? "(untitled)"}</td>
              <td className="py-2 pr-3 text-xs">{linkedName}</td>
              <td className="py-2 pr-3 text-xs">{m.Venue ?? "—"}</td>
              <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                {m.Start_DateTime ? new Date(m.Start_DateTime).toLocaleDateString() : "—"}
              </td>
              <td className="py-2 pr-3">
                <a
                  href={`https://crm.zoho.com/crm/tab/Events/${m.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Zoho <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
