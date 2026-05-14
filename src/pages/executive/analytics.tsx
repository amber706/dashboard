// /executive/analytics — Executive Analytics Dashboard.
//
// Role lens (Admissions / BD / Digital Marketing / All) + date range
// preset feed every tab. Role + tab + range persist to localStorage
// so a manager's last view returns on refresh. Access is manager+admin
// only (App.tsx wraps in MgrMod) and the page sits behind the
// `page_analytics_dashboard` feature flag.
//
// Every metric has an [i] info icon: hover for the "what is this"
// blurb, click for the full "how it's calculated" popover. Every
// number/list is also clickable — it opens a right-side drill-down
// sheet showing the underlying rows.
//
// Tabs (6 total, some hidden per role):
//   - Executive Overview      — health score + KPIs + risks
//   - Live Pipeline           — kanban + by-owner / by-source / followups
//   - Stage Movement          — aging + SLA breach + stuck
//   - Closed-Admitted         — admit funnel + by-source / by-rep / by-program
//   - Closed-Lost             — loss breakdowns + heatmap + trend
//   - Rep Performance         — per-rep volume / admits / lost / conv

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, RefreshCw, Loader2, AlertCircle, TrendingUp,
  Activity, Award, ShieldAlert, ChevronRight,
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
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
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
import { MetricInfo } from "@/features/executive-analytics/components/MetricInfo";
import {
  DrillDownSheet, zohoDealUrl,
  type DrillDownConfig,
} from "@/features/executive-analytics/components/DrillDownSheet";
import type { MetricKey } from "@/features/executive-analytics/lib/metricDefs";

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

/** Map every health-score factor key to its MetricInfo key. */
const FACTOR_METRIC: Record<keyof typeof HEALTH_SCORE_WEIGHTS, MetricKey> = {
  freshness: "freshness",
  velocity: "velocity",
  conversion: "conversion",
  staleness: "staleness",
  followup: "followup",
  lossPressure: "lossPressure",
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

  // Shared drill-down state at the page level so every nested panel
  // can fire `setDrill({...})` and it just opens.
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillConfig, setDrillConfig] = useState<DrillDownConfig<any> | null>(null);
  const openDrill = (cfg: DrillDownConfig<any>) => {
    setDrillConfig(cfg);
    setDrillOpen(true);
  };

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
            {" "}
            <span className="italic">Hover any [i] for what it is, click for how it's calculated. Click any number for the underlying rows.</span>
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
          <ExecutiveOverview role={role} range={range} openDrill={openDrill} />
        </TabsContent>
        <TabsContent value="livePipeline" className="mt-4 space-y-3">
          <LivePipeline role={role} openDrill={openDrill} />
        </TabsContent>
        <TabsContent value="stageMovement" className="mt-4 space-y-3">
          <StageMovement role={role} openDrill={openDrill} />
        </TabsContent>
        <TabsContent value="closedAdmitted" className="mt-4 space-y-3">
          <ClosedAdmitted role={role} range={range} openDrill={openDrill} />
        </TabsContent>
        <TabsContent value="closedLost" className="mt-4 space-y-3">
          <ClosedLost role={role} range={range} openDrill={openDrill} />
        </TabsContent>
        <TabsContent value="repPerformance" className="mt-4 space-y-3">
          <RepPerformance role={role} range={range} openDrill={openDrill} />
        </TabsContent>
      </Tabs>

      <DrillDownSheet
        open={drillOpen}
        onOpenChange={setDrillOpen}
        config={drillConfig}
      />
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

/** KPI card with optional info icon and click-through drill-down. */
function KpiCard({ label, value, sub, icon, tone, metric, onClick }: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "warn" | "ok";
  metric?: MetricKey;
  onClick?: () => void;
}) {
  const ring = tone === "warn"
    ? "border-amber-500/30 bg-amber-500/5"
    : tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "";
  const clickable = !!onClick;
  return (
    <Card
      className={`border ${ring} ${clickable ? "cursor-pointer hover:border-foreground/30 hover:shadow-sm transition-all" : ""}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable
        ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }
        : undefined}
    >
      <CardContent className="pt-3 pb-3 px-3.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
          {icon}
          <span className="truncate flex-1">{label}</span>
          {metric && <MetricInfo metric={metric} />}
          {clickable && <ChevronRight className="w-3 h-3 opacity-50" />}
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

/** Panel header that pairs a title with a MetricInfo icon. */
function PanelHeader({ title, metric }: { title: string; metric?: MetricKey }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      {metric && <MetricInfo metric={metric} />}
    </div>
  );
}

// ── Executive Overview ────────────────────────────────────────────

interface OpenDrillFn { (cfg: DrillDownConfig<any>): void }

function ExecutiveOverview({ role, range, openDrill }: { role: RoleKey; range: ReturnType<typeof useDashboardRange>; openDrill: OpenDrillFn }) {
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
          <div className="flex items-baseline gap-3 flex-wrap">
            <div className="text-3xl font-semibold tabular-nums">{data.healthScore.score.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              Pipeline Health Score (0–100)
              <MetricInfo metric="healthScore" />
            </div>
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
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="truncate">{f}</span>
                    <MetricInfo metric={FACTOR_METRIC[f]} />
                  </div>
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
        <KpiCard
          icon={<Activity className="w-3.5 h-3.5 text-blue-500" />}
          label="Active pipeline" value={data.activePipeline}
          metric="activePipeline"
          onClick={() => openDrill({
            title: "Active pipeline",
            subtitle: `${data.activePipeline} open deals — switch to Live Pipeline tab for the full kanban + per-row drilldown.`,
            rows: [],
            columns: [],
            emptyMessage: "Use the Live Pipeline tab for per-deal rows.",
          })}
        />
        <KpiCard
          icon={<TrendingUp className="w-3.5 h-3.5 text-violet-500" />}
          label={`New leads (${range.label})`} value={data.newInRange.leads}
          metric="newLeadsInRange"
          onClick={() => openDrill({
            title: "New leads",
            subtitle: `Leads with Created_Time between ${range.start} and ${range.end}.`,
            rows: [],
            columns: [],
            emptyMessage: "Lead-level drill-down requires a leads endpoint — coming next.",
          })}
        />
        <KpiCard
          icon={<TrendingUp className="w-3.5 h-3.5 text-violet-500" />}
          label={`New deals (${range.label})`} value={data.newInRange.deals}
          metric="newDealsInRange"
          onClick={() => openDrill({
            title: "New deals",
            subtitle: `Deals with Created_Time between ${range.start} and ${range.end}.`,
            rows: [],
            columns: [],
            emptyMessage: "Deal-level drill-down requires a per-deal endpoint — coming next.",
          })}
        />
        <KpiCard
          icon={<Award className="w-3.5 h-3.5 text-emerald-500" />}
          label={`Admitted (${range.label})`} value={data.admitted} tone="ok"
          metric="admittedInRange"
          onClick={() => openDrill({
            title: "Admitted",
            subtitle: `Deals with Admit_Date in window. ${data.admitted} total.`,
            rows: [],
            columns: [],
            emptyMessage: "See the Closed-Admitted tab for per-rep / per-program / per-source breakdowns.",
          })}
        />
        <KpiCard
          icon={<ShieldAlert className="w-3.5 h-3.5 text-rose-500" />}
          label={`Lost (${range.label})`} value={data.lost} tone="warn"
          metric="lostInRange"
          onClick={() => openDrill({
            title: "Lost",
            subtitle: `Deals with Closing_Date in window AND Stage in Closed-Lost variants. ${data.lost} total.`,
            rows: [],
            columns: [],
            emptyMessage: "See the Closed-Lost tab for reason / stage / source breakdowns.",
          })}
        />
      </div>

      {/* Top risks */}
      {data.topRisks.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top risks</span>
              <TopRisksInfo />
            </div>
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

function TopRisksInfo() {
  // Bespoke inline info — these aren't part of METRIC_DEFS because the
  // list is dynamic per role/range.
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="About top risks">
            <AlertCircle className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-[11px]">
          Auto-detected operational risks based on stale-pipeline %, loss-pressure ratio, and SLA breaches across stages.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Live Pipeline ─────────────────────────────────────────────────

function LivePipeline({ role, openDrill }: { role: RoleKey; openDrill: OpenDrillFn }) {
  const { data, isLoading, error, refetch } = usePipelineSnapshot(role);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;

  const staleCount = (data.kpis.stale?.deals ?? 0) + (data.kpis.stale?.leads ?? 0);

  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard
          icon={<Activity className="w-3.5 h-3.5 text-blue-500" />}
          label="Active pipeline" value={data.kpis.active}
          metric="activePipeline"
        />
        <KpiCard
          label="New deals today" value={data.kpis.newToday.deals}
          metric="newDealsInRange"
        />
        <KpiCard
          label="New leads today" value={data.kpis.newToday.leads}
          metric="newLeadsInRange"
        />
        <KpiCard
          label="Stale" value={staleCount} tone="warn"
          metric="staleCount"
          onClick={() => openDrill({
            title: "Stale deals",
            subtitle: `Active deals where days-in-stage > stage SLA. ${data.staleList.length} shown of ${staleCount} total.`,
            rows: data.staleList,
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "stage", label: "Stage" },
              { key: "owner", label: "Owner", hideOnMobile: true },
              { key: "days", label: "Days", align: "right" },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
            emptyMessage: "No stale deals — every active deal is within SLA.",
          })}
        />
      </div>
      {/* Kanban */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <PanelHeader title="Kanban" metric="kanban" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {DISPLAY_STAGES.map((s) => {
              const rows = (data.kanban?.[s.key] ?? []) as Array<{ id: string; name: string; owner: string; daysInStage?: number; riskFlag?: string }>;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => openDrill({
                    title: s.label,
                    subtitle: `${rows.length} open deal${rows.length === 1 ? "" : "s"} in this stage.`,
                    rows,
                    columns: [
                      { key: "name", label: "Deal" },
                      { key: "owner", label: "Owner", hideOnMobile: true },
                      { key: "daysInStage", label: "Days", align: "right" },
                      {
                        key: "riskFlag",
                        label: "Risk",
                        align: "right",
                        render: (r: any) => (
                          <span className={
                            r.riskFlag === "risk" ? "text-rose-600 dark:text-rose-400"
                            : r.riskFlag === "warm" ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                          }>{r.riskFlag ?? "—"}</span>
                        ),
                      },
                    ],
                    zohoLinkFor: (r: any) => zohoDealUrl(r.id),
                    emptyMessage: "No deals in this stage right now.",
                  })}
                  className="text-left rounded-md border bg-card p-2 min-h-[100px] hover:border-foreground/30 hover:shadow-sm transition-all cursor-pointer"
                >
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
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <SimpleListCard
          title="By owner" metric="byOwner"
          rows={data.byOwner ?? []} labelKey="owner" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Active pipeline — ${row.owner}`,
            subtitle: `${row.count} open deal${row.count === 1 ? "" : "s"} owned by this rep. Use the Live Pipeline kanban for per-stage detail.`,
            rows: Object.values(data.kanban ?? {})
              .flat()
              .filter((d: any) => d.owner === row.owner),
            columns: [
              { key: "name", label: "Deal" },
              { key: "daysInStage", label: "Days", align: "right" },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
        <SimpleListCard
          title="By source" metric="bySource"
          rows={data.bySource ?? []} labelKey="source" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Active pipeline — ${row.source ?? "(unknown)"}`,
            subtitle: `${row.count} open deal${row.count === 1 ? "" : "s"} from this source.`,
            rows: Object.values(data.kanban ?? {})
              .flat()
              .filter((d: any) => (d.source ?? "(unknown)") === row.source),
            columns: [
              { key: "name", label: "Deal" },
              { key: "owner", label: "Owner", hideOnMobile: true },
              { key: "daysInStage", label: "Days", align: "right" },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
      </div>
    </>
  );
}

// ── Stage Movement ────────────────────────────────────────────────

function StageMovement({ role, openDrill }: { role: RoleKey; openDrill: OpenDrillFn }) {
  const { data, isLoading, error, refetch } = usePipelineSnapshot(role);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const sm = data.stageMovement ?? {};
  const aging = (sm as any).agingBuckets ?? {};
  const stuck = (sm as any).stuck ?? [];

  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />

      {/* Aging buckets */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <PanelHeader title="Aging buckets" metric="agingBuckets" />
          <div className="grid grid-cols-5 gap-2">
            {(["0-1", "2-3", "4-7", "8-14", "15+"] as const).map((bucket) => {
              const count = aging[bucket] ?? 0;
              return (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => openDrill({
                    title: `Aging — ${bucket} days in stage`,
                    subtitle: `${count} active deal${count === 1 ? "" : "s"} in this band. Sourced from the kanban.`,
                    rows: Object.values(data.kanban ?? {})
                      .flat()
                      .filter((d: any) => bucketFor(d.daysInStage) === bucket),
                    columns: [
                      { key: "name", label: "Deal" },
                      { key: "owner", label: "Owner", hideOnMobile: true },
                      { key: "daysInStage", label: "Days", align: "right" },
                    ],
                    zohoLinkFor: (r: any) => zohoDealUrl(r.id),
                  })}
                  className="text-left rounded-md border bg-card p-2 hover:border-foreground/30 hover:shadow-sm transition-all cursor-pointer"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{bucket} days</div>
                  <div className="text-2xl font-semibold tabular-nums">{count}</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* SLA table */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <PanelHeader title="Stage SLA" metric="stageSlaTable" />
          <table className="w-full text-sm">
            <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left py-1.5 pr-3">Stage</th>
                <th className="text-right py-1.5 pr-3">Avg days</th>
                <th className="text-right py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1 justify-end">
                    SLA
                    <MetricInfo metric="sla" />
                  </span>
                </th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {((sm as any).avgDaysByStage ?? []).map((r: any) => (
                <tr
                  key={r.stage}
                  className="border-t hover:bg-accent/30 cursor-pointer"
                  onClick={() => {
                    // Find the matching display stage to look up rows
                    const ds = DISPLAY_STAGES.find((s) => s.label === r.stage);
                    const rows = ds ? ((data.kanban as any)?.[ds.key] ?? []) : [];
                    openDrill({
                      title: `${r.stage} — SLA detail`,
                      subtitle: `Avg ${r.avgDays} days vs SLA of ${r.slaDays ?? "—"}.${r.breach ? " SLA breach." : ""}`,
                      rows,
                      columns: [
                        { key: "name", label: "Deal" },
                        { key: "owner", label: "Owner", hideOnMobile: true },
                        { key: "daysInStage", label: "Days", align: "right" },
                      ],
                      zohoLinkFor: (rr: any) => zohoDealUrl(rr.id),
                    });
                  }}
                >
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
            Days uses <code>Modified_Time</code> as a proxy (Zoho's <code>Stage_Modified_Time</code> isn't COQL-queryable today).
          </div>
        </CardContent>
      </Card>

      {/* Stuck deals */}
      {stuck.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <PanelHeader title={`Stuck deals (${stuck.length})`} />
            <div className="space-y-1">
              {stuck.slice(0, 10).map((s: any) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => window.open(zohoDealUrl(s.id), "_blank", "noopener,noreferrer")}
                  className="w-full flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-accent/40 cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{s.dealName}</span>
                    <span className="text-muted-foreground truncate">· {s.owner}</span>
                  </div>
                  <span className="tabular-nums font-semibold text-rose-600 dark:text-rose-400 shrink-0">{s.days}d</span>
                </button>
              ))}
              {stuck.length > 10 && (
                <div className="text-[10px] text-muted-foreground italic pt-1">+ {stuck.length - 10} more</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function bucketFor(days: number): "0-1" | "2-3" | "4-7" | "8-14" | "15+" {
  if (days <= 1) return "0-1";
  if (days <= 3) return "2-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

// ── Closed-Admitted ───────────────────────────────────────────────

function ClosedAdmitted({ role, range, openDrill }: { role: RoleKey; range: ReturnType<typeof useDashboardRange>; openDrill: OpenDrillFn }) {
  const { data, isLoading, error, refetch } = useOutcomes(role, range);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const a = data.admitted;
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard
          icon={<Award className="w-3.5 h-3.5 text-emerald-500" />}
          label="Total admits" value={a.total} tone="ok"
          metric="admittedInRange"
        />
        <KpiCard
          label="Forecast next 7d" value={a.forecastNext7Days || "—"}
          metric="forecastNext7"
        />
        <KpiCard
          label="Avg days to admit" value={a.daysToAdmit.avg || "—"}
          metric="daysToAdmit"
          sub={`median ${a.daysToAdmit.median} · n=${a.daysToAdmit.n}`}
        />
        <KpiCard
          label="Scored" value={a.daysToAdmit.n || "—"}
          metric="daysToAdmit"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <SimpleListCard
          title="By source" metric="admitsBySource"
          rows={a.bySource} labelKey="source" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Admits — ${row.source ?? "(unknown)"}`,
            subtitle: `${row.count} admit${row.count === 1 ? "" : "s"} from this source in ${range.label}.`,
            rows: (a.details ?? []).filter((d: any) => (d.source ?? "(unknown)") === row.source),
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "owner", label: "Owner", hideOnMobile: true },
              { key: "program", label: "Program", hideOnMobile: true },
              { key: "admitDate", label: "Admit", hideOnMobile: true },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
        <SimpleListCard
          title="By rep" metric="admitsByRep"
          rows={a.byRep} labelKey="rep" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Admits — ${row.rep}`,
            subtitle: `${row.count} admit${row.count === 1 ? "" : "s"} by this rep in ${range.label}.`,
            rows: (a.details ?? []).filter((d: any) => d.owner === row.rep),
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "source", label: "Source", hideOnMobile: true },
              { key: "program", label: "Program", hideOnMobile: true },
              { key: "admitDate", label: "Admit", hideOnMobile: true },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
        {role !== "bd" && (
          <SimpleListCard
            title="By program" metric="admitsByProgram"
            rows={a.byProgram} labelKey="program" valueKey="count"
            onRowClick={(row) => openDrill({
              title: `Admits — ${row.program}`,
              subtitle: `${row.count} admit${row.count === 1 ? "" : "s"} into this Level of Care in ${range.label}.`,
              rows: (a.details ?? []).filter((d: any) => (d.program ?? "(unspecified)") === row.program),
              columns: [
                { key: "dealName", label: "Deal" },
                { key: "owner", label: "Owner", hideOnMobile: true },
                { key: "source", label: "Source", hideOnMobile: true },
              ],
              zohoLinkFor: (r: any) => zohoDealUrl(r.id),
            })}
          />
        )}
      </div>
    </>
  );
}

// ── Closed-Lost ───────────────────────────────────────────────────

function ClosedLost({ role, range, openDrill }: { role: RoleKey; range: ReturnType<typeof useDashboardRange>; openDrill: OpenDrillFn }) {
  const { data, isLoading, error, refetch } = useOutcomes(role, range);
  if (isLoading) return <SkeletonGrid />;
  if (error || !data) return <ErrorCard error={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />;
  const l = data.lost;
  return (
    <>
      <MissingFieldsBanner fields={data.missing_fields} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard
          icon={<ShieldAlert className="w-3.5 h-3.5 text-rose-500" />}
          label="Total lost" value={l.total} tone="warn"
          metric="lostInRange"
        />
        <KpiCard
          label="Loss rate" value={`${l.lossRate}%`}
          metric="lossRate"
        />
        <KpiCard
          label="Preventable" value={l.preventableCount || "—"}
          metric="preventable"
        />
        <KpiCard
          label="Stages affected" value={l.byStage.length}
          metric="lossByStage"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <SimpleListCard
          title="By reason"
          rows={l.byReason} labelKey="reason" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Lost — reason "${row.reason ?? "(none)"}"`,
            subtitle: `${row.count} lost deal${row.count === 1 ? "" : "s"} with this Lost_Reasoning in ${range.label}.`,
            rows: (l.details ?? []).filter((d: any) => (d.reason ?? "(unspecified)") === row.reason),
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "stage", label: "Stage" },
              { key: "owner", label: "Owner", hideOnMobile: true },
              { key: "source", label: "Source", hideOnMobile: true },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
            emptyMessage: "No matching lost-deal rows for this reason.",
          })}
        />
        <SimpleListCard
          title="By stage" metric="lossByStage"
          rows={l.byStage} labelKey="stage" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Lost — stage "${row.stage}"`,
            subtitle: `${row.count} deal${row.count === 1 ? "" : "s"} closed lost from this stage in ${range.label}.`,
            rows: (l.details ?? []).filter((d: any) => d.stage === row.stage),
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "reason", label: "Reason" },
              { key: "owner", label: "Owner", hideOnMobile: true },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
        <SimpleListCard
          title="By source" metric="lossBySource"
          rows={l.bySource} labelKey="source" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Lost — source "${row.source ?? "(unknown)"}"`,
            subtitle: `${row.count} deal${row.count === 1 ? "" : "s"} closed lost from this source in ${range.label}.`,
            rows: (l.details ?? []).filter((d: any) => (d.source ?? "(unknown)") === row.source),
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "stage", label: "Stage" },
              { key: "reason", label: "Reason", hideOnMobile: true },
              { key: "owner", label: "Owner", hideOnMobile: true },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
        <SimpleListCard
          title="By owner"
          rows={l.byOwner} labelKey="owner" valueKey="count"
          onRowClick={(row) => openDrill({
            title: `Lost — owner "${row.owner}"`,
            subtitle: `${row.count} deal${row.count === 1 ? "" : "s"} closed lost by this owner in ${range.label}.`,
            rows: (l.details ?? []).filter((d: any) => d.owner === row.owner),
            columns: [
              { key: "dealName", label: "Deal" },
              { key: "stage", label: "Stage" },
              { key: "reason", label: "Reason", hideOnMobile: true },
            ],
            zohoLinkFor: (r: any) => zohoDealUrl(r.id),
          })}
        />
      </div>
      {l.trend.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <PanelHeader title="Loss trend" metric="lossTrend" />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={l.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <RTooltip />
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

function RepPerformance({ role, range, openDrill }: { role: RoleKey; range: ReturnType<typeof useDashboardRange>; openDrill: OpenDrillFn }) {
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
        <CardContent className="pt-4 pb-2">
          <PanelHeader title="Per-rep performance" metric="repTable" />
        </CardContent>
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
                  <th className="text-right py-2 px-3">
                    <span className="inline-flex items-center gap-1 justify-end">
                      Avg days → admit
                      <MetricInfo metric="avgDaysToAdmit" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr
                    key={r.rep}
                    className="border-t hover:bg-accent/30 cursor-pointer"
                    onClick={() => openDrill({
                      title: `Rep — ${r.rep}`,
                      subtitle: `Volume ${r.volume} · Admits ${r.admits} · Lost ${r.lost} · Active ${r.active} · Conv ${r.conversionPct}% · Avg ${r.avgDaysToAdmit || "—"} days to admit (n=${r.admitSpeedN ?? 0})`,
                      rows: [r],
                      columns: [
                        { key: "rep", label: "Rep" },
                        { key: "volume", label: "Volume", align: "right" },
                        { key: "admits", label: "Admits", align: "right" },
                        { key: "lost", label: "Lost", align: "right" },
                        { key: "active", label: "Active", align: "right" },
                        { key: "conversionPct", label: "Conv %", align: "right" },
                        { key: "avgDaysToAdmit", label: "Avg days → admit", align: "right" },
                      ],
                      emptyMessage: "",
                    })}
                  >
                    <td className="py-2 px-3 text-sm font-medium">{r.rep}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.volume}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.admits}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400">{r.lost}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.active}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold">{r.conversionPct}%</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.avgDaysToAdmit ? `${r.avgDaysToAdmit}d` : "—"}
                      {r.admitSpeedN > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1">(n={r.admitSpeedN})</span>
                      )}
                    </td>
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

function SimpleListCard({ title, rows, labelKey, valueKey, metric, onRowClick }: {
  title: string;
  rows: any[];
  labelKey: string;
  valueKey: string;
  metric?: MetricKey;
  onRowClick?: (row: any) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
          {metric && <MetricInfo metric={metric} />}
        </div>
        {rows.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No rows in this window.</div>
        ) : (
          <div className="space-y-1">
            {rows.slice(0, 8).map((r: any) => {
              const inner = (
                <>
                  <span className="truncate">{r[labelKey] ?? "(none)"}</span>
                  <span className="tabular-nums font-semibold">{r[valueKey]}</span>
                </>
              );
              return onRowClick ? (
                <button
                  key={String(r[labelKey])}
                  type="button"
                  onClick={() => onRowClick(r)}
                  className="w-full flex items-center justify-between text-xs hover:bg-accent/40 rounded px-1.5 py-1 cursor-pointer"
                >
                  {inner}
                </button>
              ) : (
                <div key={String(r[labelKey])} className="flex items-center justify-between text-xs px-1.5 py-1">
                  {inner}
                </div>
              );
            })}
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
