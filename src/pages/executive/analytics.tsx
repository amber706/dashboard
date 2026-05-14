// /executive/analytics — Executive Analytics Dashboard.
//
// Role lens (Admissions / BD / Digital Marketing / All) + date range
// preset feed every tab. Role + tab + range persist to localStorage
// so a manager's last view returns on refresh. Access is manager+admin
// only (App.tsx wraps in MgrMod) and the page sits behind the
// `page_analytics_dashboard` feature flag.
//
// Tabs (6 total, some hidden per role):
//   - Executive Overview      — health score + KPIs + risks
//   - Live Pipeline           — kanban + by-owner / by-source / followups
//   - Stage Movement          — aging + SLA breach + stuck
//   - Closed-Admitted         — admit funnel + by-source / by-rep / by-program
//   - Closed-Lost             — loss breakdowns + heatmap + trend
//   - Rep Performance         — per-rep volume / admits / lost / conv
//
// Many panels degrade gracefully — when the backend reports
// missing_fields, the affected panels render a yellow "Field missing"
// banner instead of empty data. See the handoff doc in the commit
// message + AMBER_TODO_ANALYTICS.md for the field-creation checklist.

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, RefreshCw, Loader2, AlertCircle, TrendingUp,
  Activity, Award, ShieldAlert, Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { useDashboardRange } from "@/features/executive-analytics/hooks/useDashboardRange";
import { useAnalyticsSummary } from "@/features/executive-analytics/hooks/useAnalyticsSummary";
import { usePipelineSnapshot } from "@/features/executive-analytics/hooks/usePipelineSnapshot";
import { useOutcomes } from "@/features/executive-analytics/hooks/useOutcomes";
import { useRepPerformance } from "@/features/executive-analytics/hooks/useRepPerformance";
import {
  ROLE_KEYS, ROLE_LABELS, visibleTabsForRole, defaultRoleFor,
  type RoleKey,
} from "@/features/executive-analytics/constants/roles";
import { DISPLAY_STAGES } from "@/features/executive-analytics/constants/stages";
import { HEALTH_SCORE_WEIGHTS } from "@/features/executive-analytics/lib/healthScore";
import { badgeFor, type DashboardRangePreset } from "@/features/executive-analytics/api/types";
import { useRole } from "@/lib/role-context";

const LS_ROLE = "cornerstone.executiveAnalytics.role";
const LS_TAB = "cornerstone.executiveAnalytics.tab";
const LS_RANGE = "cornerstone.executiveAnalytics.range";

const RANGE_LABELS: Record<DashboardRangePreset, string> = {
  today: "Today", yesterday: "Yesterday",
  thisWeek: "This week", lastWeek: "Last week",
  mtd: "Month to date", lastMonth: "Last month",
  ytd: "Year to date", lastYear: "Last year",
  custom: "Custom range",
};

export default function ExecutiveAnalyticsPage() {
  const { role: profileRole } = useRole();

  // Hydrate from localStorage. Defaults from spec: role inferred from
  // profile, MTD range, Executive Overview tab.
  const [role, setRole] = useState<RoleKey>(() => {
    const stored = localStorage.getItem(LS_ROLE) as RoleKey | null;
    if (stored && (ROLE_KEYS as string[]).includes(stored)) return stored;
    return defaultRoleFor(profileRole);
  });
  const [tab, setTab] = useState<string>(() => localStorage.getItem(LS_TAB) ?? "executiveOverview");
  const [rangePreset, setRangePreset] = useState<DashboardRangePreset>(
    () => (localStorage.getItem(LS_RANGE) as DashboardRangePreset) ?? "mtd",
  );
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  useEffect(() => { localStorage.setItem(LS_ROLE, role); }, [role]);
  useEffect(() => { localStorage.setItem(LS_TAB, tab); }, [tab]);
  useEffect(() => { localStorage.setItem(LS_RANGE, rangePreset); }, [rangePreset]);

  const range = useDashboardRange(rangePreset, customStart, customEnd);
  const visibleTabs = useMemo(() => visibleTabsForRole(role), [role]);

  // If a role change hides the current tab, fall back to Executive
  // Overview (always visible).
  useEffect(() => {
    if (!visibleTabs.includes(tab as never)) setTab("executiveOverview");
  }, [visibleTabs, tab]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <header className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6" /> Analytics Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Pipeline health, stage movement, closed-admitted / closed-lost, rep performance.
            Live from Zoho. Window: <strong>{range.label}</strong>.
          </p>
        </div>
        <div className="ml-auto" />
      </header>

      <TopBar
        role={role} onRoleChange={setRole}
        rangePreset={rangePreset} onRangePresetChange={setRangePreset}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          {visibleTabs.includes("executiveOverview" as never) && <TabsTrigger value="executiveOverview">Executive Overview</TabsTrigger>}
          {visibleTabs.includes("livePipeline" as never) && <TabsTrigger value="livePipeline">Live Pipeline</TabsTrigger>}
          {visibleTabs.includes("stageMovement" as never) && <TabsTrigger value="stageMovement">Stage Movement</TabsTrigger>}
          {visibleTabs.includes("closedAdmitted" as never) && <TabsTrigger value="closedAdmitted">Closed-Admitted</TabsTrigger>}
          {visibleTabs.includes("closedLost" as never) && <TabsTrigger value="closedLost">Closed-Lost</TabsTrigger>}
          {visibleTabs.includes("repPerformance" as never) && <TabsTrigger value="repPerformance">Rep Performance</TabsTrigger>}
        </TabsList>

        <TabsContent value="executiveOverview" className="mt-4 space-y-3">
          <ExecutiveOverview role={role} range={range} />
        </TabsContent>
        <TabsContent value="livePipeline" className="mt-4 space-y-3">
          <LivePipeline role={role} />
        </TabsContent>
        <TabsContent value="stageMovement" className="mt-4 space-y-3">
          <StageMovement role={role} />
        </TabsContent>
        <TabsContent value="closedAdmitted" className="mt-4 space-y-3">
          <ClosedAdmitted role={role} range={range} />
        </TabsContent>
        <TabsContent value="closedLost" className="mt-4 space-y-3">
          <ClosedLost role={role} range={range} />
        </TabsContent>
        <TabsContent value="repPerformance" className="mt-4 space-y-3">
          <RepPerformance role={role} range={range} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────

function TopBar({
  role, onRoleChange,
  rangePreset, onRangePresetChange,
  customStart, customEnd, onCustomStartChange, onCustomEndChange,
}: {
  role: RoleKey;
  onRoleChange: (r: RoleKey) => void;
  rangePreset: DashboardRangePreset;
  onRangePresetChange: (p: DashboardRangePreset) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (s: string) => void;
  onCustomEndChange: (s: string) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center gap-3 flex-wrap">
        {/* Role lens — 4 buttons */}
        <div className="inline-flex gap-1 rounded-md border p-0.5">
          {ROLE_KEYS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRoleChange(r)}
              className={`text-xs px-2.5 py-1 rounded-sm transition-colors ${
                role === r
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        {/* Range preset */}
        <Select value={rangePreset} onValueChange={(v) => onRangePresetChange(v as DashboardRangePreset)}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RANGE_LABELS) as DashboardRangePreset[]).map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{RANGE_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {rangePreset === "custom" && (
          <>
            <Input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)} className="h-8 text-xs w-40" />
            <span className="text-[10px] text-muted-foreground">→</span>
            <Input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)} className="h-8 text-xs w-40" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Reusable panels ───────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, tone }: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "warn" | "ok";
}) {
  const ring = tone === "warn"
    ? "border-amber-500/30 bg-amber-500/5"
    : tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "";
  return (
    <Card className={`border ${ring}`}>
      <CardContent className="pt-3 pb-3 px-3.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
          {icon}<span className="truncate">{label}</span>
        </div>
        <div className="text-2xl font-semibold tabular-nums leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function MissingFieldsBanner({ fields }: { fields?: string[] }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div>
        <strong>Some panels are degraded.</strong> Missing Zoho fields:
        {" "}
        {fields.map((f, i) => (
          <span key={f}>
            <code className="bg-amber-500/10 px-1 rounded">{f}</code>{i < fields.length - 1 ? ", " : ""}
          </span>
        ))}
        . Adding them in Zoho Setup → Deals → Layouts unlocks full functionality.
      </div>
    </div>
  );
}

// ── Executive Overview ────────────────────────────────────────────

function ExecutiveOverview({ role, range }: { role: RoleKey; range: ReturnType<typeof useDashboardRange> }) {
  const { data, isLoading, error, refetch } = useAnalyticsSummary(role, range);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const badge = badgeFor(data.healthScore.score);
  const badgeTone = badge === "green" ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/5"
    : badge === "yellow" ? "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/5"
    : "text-rose-600 dark:text-rose-400 border-rose-500/40 bg-rose-500/5";

  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      {/* Health score panel */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-semibold tabular-nums">{data.healthScore.score.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Pipeline Health Score (0–100)</div>
            <Badge variant="outline" className={`text-[10px] ml-auto ${badgeTone}`}>{badge.toUpperCase()}</Badge>
          </div>
          <div className="h-3 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={`h-full ${badge === "green" ? "bg-emerald-500" : badge === "yellow" ? "bg-amber-500" : "bg-rose-500"}`}
              style={{ width: `${Math.min(100, Math.max(0, data.healthScore.score))}%` }}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {(Object.keys(HEALTH_SCORE_WEIGHTS) as Array<keyof typeof HEALTH_SCORE_WEIGHTS>).map((f) => {
              const val = (data.healthScore.factors as any)[f] as number;
              const weight = HEALTH_SCORE_WEIGHTS[f];
              return (
                <div key={f} className="rounded-md border bg-card px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{f}</div>
                  <div className="text-sm font-semibold tabular-nums">{val.toFixed(0)}</div>
                  <div className="text-[10px] text-muted-foreground">weight {(weight * 100).toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Main risk: <strong>{data.healthScore.mainRisk.factor}</strong> ({data.healthScore.mainRisk.value.toFixed(0)})
          </div>
        </CardContent>
      </Card>

      {/* KPIs row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiCard icon={<Activity className="w-3.5 h-3.5 text-blue-500" />} label="Active pipeline" value={data.activePipeline} />
        <KpiCard icon={<TrendingUp className="w-3.5 h-3.5 text-violet-500" />} label={`New leads (${range.label})`} value={data.newInRange.leads} />
        <KpiCard icon={<TrendingUp className="w-3.5 h-3.5 text-violet-500" />} label={`New deals (${range.label})`} value={data.newInRange.deals} />
        <KpiCard icon={<Award className="w-3.5 h-3.5 text-emerald-500" />} label={`Admitted (${range.label})`} value={data.admitted} tone="ok" />
        <KpiCard icon={<ShieldAlert className="w-3.5 h-3.5 text-rose-500" />} label={`Lost (${range.label})`} value={data.lost} tone="warn" />
      </div>

      {/* Top risks */}
      {data.topRisks.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Top risks</div>
            <div className="space-y-1.5">
              {data.topRisks.map((r) => (
                <div key={r.label} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className={`text-[10px] ${
                    r.severity === "red" ? "border-rose-500/40 text-rose-700 dark:text-rose-400"
                    : r.severity === "yellow" ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                    : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                  }`}>{r.count}</Badge>
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── Live Pipeline ─────────────────────────────────────────────────

function LivePipeline({ role }: { role: RoleKey }) {
  const { data, isLoading, error, refetch } = usePipelineSnapshot(role);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard icon={<Activity className="w-3.5 h-3.5 text-blue-500" />} label="Active pipeline" value={data.kpis.active} />
        <KpiCard label="New deals today" value={data.kpis.newToday.deals} />
        <KpiCard label="New leads today" value={data.kpis.newToday.leads} />
        <KpiCard label="Stale" value={(data.kpis.stale?.deals ?? 0) + (data.kpis.stale?.leads ?? 0)} tone="warn" />
      </div>
      {/* Kanban */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Kanban</div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {DISPLAY_STAGES.map((s) => {
              const rows = (data.kanban?.[s.key] ?? []) as Array<{ id: string; name: string; owner: string }>;
              return (
                <div key={s.key} className="rounded-md border bg-card p-2 min-h-[100px]">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 truncate">{s.label}</div>
                  <div className="text-2xl font-semibold tabular-nums">{rows.length}</div>
                  <div className="mt-1.5 space-y-1 max-h-[200px] overflow-y-auto">
                    {rows.slice(0, 5).map((d) => (
                      <div key={d.id} className="text-[10px] border-l-2 border-border pl-1.5 py-0.5">
                        <div className="truncate font-medium">{d.name}</div>
                        <div className="truncate text-muted-foreground">{d.owner}</div>
                      </div>
                    ))}
                    {rows.length > 5 && <div className="text-[10px] text-muted-foreground italic">+ {rows.length - 5} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <SimpleListCard title="By owner" rows={data.byOwner ?? []} labelKey="owner" valueKey="count" />
        <SimpleListCard title="By source" rows={data.bySource ?? []} labelKey="source" valueKey="count" />
      </div>
    </>
  );
}

// ── Stage Movement ────────────────────────────────────────────────

function StageMovement({ role }: { role: RoleKey }) {
  const { data, isLoading, error, refetch } = usePipelineSnapshot(role);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const sm = data.stageMovement ?? {};
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Stage SLA</div>
          <table className="w-full text-sm">
            <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
              <tr><th className="text-left py-1.5 pr-3">Stage</th><th className="text-right py-1.5 pr-3">Avg days</th><th className="text-right py-1.5 pr-3">SLA</th><th className="w-20"></th></tr>
            </thead>
            <tbody>
              {(sm.avgDaysByStage ?? []).map((r: any) => (
                <tr key={r.stage} className="border-t">
                  <td className="py-1.5 pr-3 text-xs">{r.stage}</td>
                  <td className="py-1.5 pr-3 text-xs text-right tabular-nums">{r.avgDays || "—"}</td>
                  <td className="py-1.5 pr-3 text-xs text-right tabular-nums">{r.slaDays ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {r.breach && <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">breach</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground mt-3 italic">
            Avg days requires <code>Days_in_Current_Stage</code> field in Zoho — currently degraded.
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ── Closed-Admitted ───────────────────────────────────────────────

function ClosedAdmitted({ role, range }: { role: RoleKey; range: ReturnType<typeof useDashboardRange> }) {
  const { data, isLoading, error, refetch } = useOutcomes(role, range);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const a = data.admitted;
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard icon={<Award className="w-3.5 h-3.5 text-emerald-500" />} label="Total admits" value={a.total} tone="ok" />
        <KpiCard label="Forecast next 7d" value={a.forecastNext7Days || "—"} />
        <KpiCard label="Avg days to admit" value={a.daysToAdmit.avg || "—"} />
        <KpiCard label="Scored" value={a.daysToAdmit.n || "—"} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <SimpleListCard title="By source" rows={a.bySource} labelKey="source" valueKey="count" />
        <SimpleListCard title="By rep" rows={a.byRep} labelKey="rep" valueKey="count" />
        {role !== "bd" && <SimpleListCard title="By program" rows={a.byProgram} labelKey="program" valueKey="count" />}
      </div>
    </>
  );
}

// ── Closed-Lost ───────────────────────────────────────────────────

function ClosedLost({ role, range }: { role: RoleKey; range: ReturnType<typeof useDashboardRange> }) {
  const { data, isLoading, error, refetch } = useOutcomes(role, range);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const l = data.lost;
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard icon={<ShieldAlert className="w-3.5 h-3.5 text-rose-500" />} label="Total lost" value={l.total} tone="warn" />
        <KpiCard label="Loss rate" value={`${l.lossRate}%`} />
        <KpiCard label="Preventable" value={l.preventableCount || "—"} />
        <KpiCard label="Stages affected" value={l.byStage.length} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <SimpleListCard title="By stage" rows={l.byStage} labelKey="stage" valueKey="count" />
        <SimpleListCard title="By source" rows={l.bySource} labelKey="source" valueKey="count" />
      </div>
      {l.trend.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Loss trend</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={l.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#f43f5e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── Rep Performance ───────────────────────────────────────────────

function RepPerformance({ role, range }: { role: RoleKey; range: ReturnType<typeof useDashboardRange> }) {
  const { data, isLoading, error, refetch } = useRepPerformance(role, range);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  if (data.note === "not_applicable") {
    return <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">Rep performance isn't applicable to Digital Marketing view.</CardContent></Card>;
  }
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <Card>
        <CardContent className="pt-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 px-3">Rep</th>
                  <th className="text-right py-2 px-3">Volume</th>
                  <th className="text-right py-2 px-3">Admits</th>
                  <th className="text-right py-2 px-3">Lost</th>
                  <th className="text-right py-2 px-3">Active</th>
                  <th className="text-right py-2 px-3">Conv %</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.rep} className="border-t">
                    <td className="py-2 px-3 text-sm font-medium">{r.rep}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.volume}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.admits}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400">{r.lost}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.active}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold">{r.conversionPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ── Shared subcomponents ──────────────────────────────────────────

function SimpleListCard({ title, rows, labelKey, valueKey }: {
  title: string;
  rows: any[];
  labelKey: string;
  valueKey: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
        {rows.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No rows in this window.</div>
        ) : (
          <div className="space-y-1">
            {rows.slice(0, 8).map((r: any) => (
              <div key={r[labelKey]} className="flex items-center justify-between text-xs">
                <span className="truncate">{r[labelKey]}</span>
                <span className="tabular-nums font-semibold">{r[valueKey]}</span>
              </div>
            ))}
            {rows.length > 8 && <div className="text-[10px] text-muted-foreground italic">+ {rows.length - 8} more</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-24" />
      <div className="grid grid-cols-4 gap-2">
        <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
      </div>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-500/30 bg-rose-500/5">
      <CardContent className="pt-4 pb-4 text-sm text-rose-600 dark:text-rose-400 flex items-center justify-between gap-3">
        <span>{error || "Failed to load."}</span>
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5 h-7">
          <RefreshCw className="w-3 h-3" /> Retry
        </Button>
      </CardContent>
    </Card>
  );
}
