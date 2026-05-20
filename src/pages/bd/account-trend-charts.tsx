// Account trend charts — rendered above the existing Tabs on
// /bd/account. Three line charts:
//   1. Meetings + Referrals in
//   2. Referrals out + Admits
//   3. Referrals in + Admits  (the default headline view)
//
// Filterable by Level of Care Requested, Level of Care Admitted,
// and Pipeline (Commercial / AHCCCS / DUI / DV). Each month dot is
// clickable — opens a Sheet showing the deal/meeting records that
// rolled up into that bucket.

import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { presetToMonths, STANDARD_PRESETS, type StandardWindowPreset } from "@/lib/bd-window-presets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

const PIPELINE_GROUPS = {
  DUI: ["DUI", "DUI - Cash"],
  DV: ["DV - Cash"],
  Commercial: ["Commercial-Cash"],
  AHCCCS: ["AHCCCS"],
} as const;
type PipelineGroup = keyof typeof PIPELINE_GROUPS;

// LOC dropdown seed values. The page also accepts whatever LOCs come
// back from the data, but seeding gives the user something to pick from
// immediately without waiting for the first roundtrip.
const COMMON_LOCS = [
  "RTC", "PHP", "IOP", "IOP5", "OP", "BHRF",
  "VIOP Adult", "VIOP Adolescent",
  "Detox", "DTX", "Screening", "Classes",
];

interface MonthlyBucket {
  month: string;
  meetings: number;
  referrals_in: number;
  referrals_out: number;
  admits: number;
  ids: {
    meetings: string[];
    referrals_in: string[];
    referrals_out: string[];
    admits: string[];
  };
}
interface MonthlyResponse {
  ok: boolean;
  window: { months: number; start: string; end: string };
  months: string[];
  series: MonthlyBucket[];
}

type Metric = "meetings" | "referrals_in" | "referrals_out" | "admits";

const METRIC_LABEL: Record<Metric, string> = {
  meetings: "Meetings",
  referrals_in: "Referrals in",
  referrals_out: "Referrals out",
  admits: "Admits",
};

function fmtMonth(mk: string): string {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function AccountTrendCharts({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [preset, setPreset] = useState<StandardWindowPreset>("last_year");
  const months = useMemo(() => presetToMonths(preset).months, [preset]);
  const [locRequested, setLocRequested] = useState<string>("all");
  const [locAdmitted, setLocAdmitted] = useState<string>("all");
  const [pipelineGroups, setPipelineGroups] = useState<Set<PipelineGroup>>(new Set());
  const [data, setData] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drill-down state: which month + which two metrics are shown in the
  // sheet. We open a single sheet for a (month, metricA, metricB) tuple
  // so the user sees both series' records together in context.
  const [drill, setDrill] = useState<{ month: string; metrics: Metric[] } | null>(null);

  const pipelinesParam = useMemo(() => {
    if (pipelineGroups.size === 0) return undefined;
    const out: string[] = [];
    for (const g of pipelineGroups) out.push(...PIPELINE_GROUPS[g]);
    return out;
  }, [pipelineGroups]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-monthly`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          account_id: accountId,
          months,
          loc_requested: locRequested,
          loc_admitted: locAdmitted,
          pipelines: pipelinesParam,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [accountId, months, locRequested, locAdmitted, pipelinesParam]);

  useEffect(() => { load(); }, [load]);

  function togglePipeline(g: PipelineGroup) {
    setPipelineGroups((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }

  // Chart data — Recharts wants an array of { x, a, b } objects. We
  // build a single shaped row per month with all four metrics so any
  // chart can pick the two it cares about.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series.map((b) => ({
      month: fmtMonth(b.month),
      monthKey: b.month,
      meetings: b.meetings,
      referrals_in: b.referrals_in,
      referrals_out: b.referrals_out,
      admits: b.admits,
    }));
  }, [data]);

  // Click handler for recharts. Recharts fires onClick on the chart
  // surface with { activeLabel, activePayload }. We map activeLabel
  // (pretty month) back to the underlying monthKey via chartData.
  function onChartClick(metrics: Metric[]) {
    return (e: any) => {
      const label: string | undefined = e?.activeLabel;
      if (!label) return;
      const row = chartData.find((r) => r.month === label);
      if (!row) return;
      setDrill({ month: row.monthKey, metrics });
    };
  }

  const activeBucket = useMemo(() => {
    if (!drill || !data) return null;
    return data.series.find((b) => b.month === drill.month) ?? null;
  }, [drill, data]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Account trends</CardTitle>
          <p className="text-xs text-muted-foreground">
            Month-over-month for <span className="font-medium">{accountName}</span>. Click any month on a chart to see the records behind it.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
            {STANDARD_PRESETS.map((p) => (
              <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => setPreset(p.key)} className="h-7 text-xs">{p.label}</Button>
            ))}
            <span className="mx-2 h-4 w-px bg-border" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
            <Button size="sm" variant={pipelineGroups.size === 0 ? "default" : "outline"} onClick={() => setPipelineGroups(new Set())} className="h-7 text-xs">All</Button>
            {(Object.keys(PIPELINE_GROUPS) as PipelineGroup[]).map((g) => (
              <Button key={g} size="sm" variant={pipelineGroups.has(g) ? "default" : "outline"} onClick={() => togglePipeline(g)} className="h-7 text-xs">{g}</Button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">LOC requested</span>
            <select value={locRequested} onChange={(e) => setLocRequested(e.target.value)} className="h-7 text-xs px-2 rounded border bg-background">
              <option value="all">All</option>
              {COMMON_LOCS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-2">LOC admitted</span>
            <select value={locAdmitted} onChange={(e) => setLocAdmitted(e.target.value)} className="h-7 text-xs px-2 rounded border bg-background">
              <option value="all">All</option>
              {COMMON_LOCS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            {error && <span className="text-xs text-red-600 ml-2">{error}</span>}
            {loading && <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</span>}
          </div>
        </CardContent>
      </Card>

      {/* Default headline chart: Referrals in + Admits. */}
      <TrendChart title="Referrals in vs Admits"
        subtitle="Default headline view — total referrals received from this account and admits attributed to them."
        data={chartData}
        seriesA={{ key: "referrals_in", label: "Referrals in", color: "hsl(210, 80%, 55%)" }}
        seriesB={{ key: "admits", label: "Admits", color: "hsl(160, 70%, 45%)" }}
        onClick={onChartClick(["referrals_in", "admits"])}
      />

      <TrendChart title="Meetings vs Referrals in"
        subtitle="Does meeting activity translate into referrals? A widening gap (meetings up, referrals flat) is a relationship-but-no-conversion signal."
        data={chartData}
        seriesA={{ key: "meetings", label: "Meetings", color: "hsl(280, 55%, 55%)" }}
        seriesB={{ key: "referrals_in", label: "Referrals in", color: "hsl(210, 80%, 55%)" }}
        onClick={onChartClick(["meetings", "referrals_in"])}
      />

      <TrendChart title="Referrals out vs Admits"
        subtitle="Reciprocity — referrals we sent to this account vs. admits we converted from theirs."
        data={chartData}
        seriesA={{ key: "referrals_out", label: "Referrals out", color: "hsl(20, 80%, 55%)" }}
        seriesB={{ key: "admits", label: "Admits", color: "hsl(160, 70%, 45%)" }}
        onClick={onChartClick(["referrals_out", "admits"])}
      />

      {/* Per-month drill-down sheet. */}
      <Sheet open={drill != null} onOpenChange={(o) => { if (!o) setDrill(null); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {drill && activeBucket && (
            <>
              <SheetHeader>
                <SheetTitle>{fmtMonth(drill.month)} · {accountName}</SheetTitle>
                <SheetDescription>
                  {drill.metrics.map((m) => `${activeBucket[m]} ${METRIC_LABEL[m].toLowerCase()}`).join(" · ")}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                {drill.metrics.map((m) => {
                  const ids = activeBucket.ids[m];
                  return (
                    <section key={m}>
                      <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                        {METRIC_LABEL[m]} <span className="text-foreground">({ids.length})</span>
                      </h3>
                      {ids.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No records.</p>
                      ) : (
                        <ul className="space-y-1">
                          {ids.map((id) => (
                            <li key={id} className="text-xs flex items-center gap-2 border-t pt-1.5">
                              <span className="font-mono text-muted-foreground truncate">{id}</span>
                              <a
                                href={`https://crm.zoho.com/crm/tab/${m === "meetings" ? "Events" : "Potentials"}/${id}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-0.5 ml-auto"
                              >
                                Zoho <ExternalLink className="w-3 h-3" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function TrendChart({ title, subtitle, data, seriesA, seriesB, onClick }: {
  title: string;
  subtitle: string;
  data: Array<Record<string, any>>;
  seriesA: { key: string; label: string; color: string };
  seriesB: { key: string; label: string; color: string };
  onClick: (e: any) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {title}
          <Badge variant="outline" className="text-[10px]"><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ backgroundColor: seriesA.color }} />{seriesA.label}</Badge>
          <Badge variant="outline" className="text-[10px]"><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ backgroundColor: seriesB.color }} />{seriesB.label}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} onClick={onClick} style={{ cursor: data.length > 0 ? "pointer" : "default" }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey={seriesA.key} name={seriesA.label} stroke={seriesA.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
            <Line type="monotone" dataKey={seriesB.key} name={seriesB.label} stroke={seriesB.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
