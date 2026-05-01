import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { apiFetch } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/score-card";
import { DateRangePicker, getDefaultDateRange, formatDateParam, type DateRange } from "@/components/date-range-picker";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Phone, TrendingUp, Target, Users, RefreshCw,
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Mic, FileText,
  Clock, Flame, BarChart3, ChevronDown, ChevronUp,
} from "lucide-react";

interface RepMetric {
  ctm_user_id: string;
  agent_name: string;
  email: string | null;
  total_calls: number;
  answered: number;
  missed: number;
  inbound: number;
  outbound: number;
  answer_rate: number;
  recordings: number;
  transcripts: number;
  avg_talk_seconds: number;
  total_talk_seconds: number;
  sessions: number;
  avg_lead_score: number | null;
  scored_calls: number;
  avg_call_score: number | null;
  hot_leads: number;
  qa_pass: number;
  qa_fail: number;
}

interface AnalyticsData {
  summary: {
    total_calls: number;
    total_answered: number;
    total_missed: number;
    answer_rate: number;
    unassigned_calls: number;
    active_agents: number;
  };
  tier_distribution: Record<string, number>;
  rep_metrics: RepMetric[];
}

const CHART_COLORS = [
  "hsl(210, 80%, 55%)",
  "hsl(160, 70%, 45%)",
  "hsl(30, 85%, 55%)",
  "hsl(280, 60%, 55%)",
  "hsl(190, 75%, 45%)",
  "hsl(350, 70%, 55%)",
  "hsl(45, 80%, 50%)",
  "hsl(120, 50%, 45%)",
];

const TIER_COLORS: Record<string, string> = {
  A: "#22c55e",
  B: "#3b82f6",
  C: "#f59e0b",
  D: "#f97316",
  F: "#ef4444",
};

type SortKey = "total_calls" | "answered" | "missed" | "answer_rate" | "avg_talk_seconds" | "recordings" | "avg_lead_score";

// Build a /ctm-calls deep link that respects the analytics page's date
// range so the drill-through lands with matching window applied.
function analyticsCallsLink(range: DateRange | null, extras: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (range) {
    params.set("start_date", formatDateParam(range.startDate));
    params.set("end_date", formatDateParam(range.endDate));
  } else {
    params.set("date", "all");
  }
  for (const [k, v] of Object.entries(extras)) params.set(k, v);
  return `/ctm-calls?${params.toString()}`;
}

function formatTalkTime(seconds: number) {
  if (!seconds) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTotalTime(seconds: number) {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("total_calls");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(getDefaultDateRange());

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange) {
        params.set("start_date", formatDateParam(dateRange.startDate));
        params.set("end_date", formatDateParam(dateRange.endDate));
      } else {
        params.set("all_time", "true");
      }
      const res = await apiFetch(`/ctm-admin/analytics?${params}`);
      if (res.ok) setData(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortedReps = data?.rep_metrics
    ? [...data.rep_metrics].sort((a, b) => {
        const va = a[sortKey] ?? -1;
        const vb = b[sortKey] ?? -1;
        return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      })
    : [];

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
    >
      {label}
      {sortKey === field && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );

  const chartRepData = sortedReps.slice(0, 10).map((r) => ({
    name: r.agent_name.split(" ")[0],
    answered: r.answered,
    missed: r.missed,
    inbound: r.inbound,
    outbound: r.outbound,
  }));

  const tierData = data?.tier_distribution
    ? Object.entries(data.tier_distribution).map(([tier, count]) => ({
        name: `Tier ${tier}`,
        value: count,
        color: TIER_COLORS[tier] || "#6b7280",
      }))
    : [];

  if (loading) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6 md:space-y-8">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!data) return <div className="p-5 md:p-8 lg:p-10 text-center text-muted-foreground">Failed to load analytics</div>;

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Analytics"
        subtitle="Rep performance metrics from live CTM call data"
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
            <Button variant="outline" size="sm" onClick={fetchAnalytics}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Link href={analyticsCallsLink(dateRange)} className="block transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer">
          <MetricCard label="Total Calls" value={data.summary.total_calls} icon={<Phone className="w-4 h-4" />} />
        </Link>
        <Link href={analyticsCallsLink(dateRange, { status: "completed" })} className="block transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer">
          <MetricCard label="Answered" value={data.summary.total_answered} change={`${data.summary.answer_rate}% rate`} changeType="positive" icon={<Phone className="w-4 h-4" />} />
        </Link>
        <Link href={analyticsCallsLink(dateRange, { status: "missed" })} className="block transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer">
          <MetricCard label="Missed" value={data.summary.total_missed} icon={<PhoneMissed className="w-4 h-4" />} />
        </Link>
        <Link href="/ctm-agents" className="block transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer">
          <MetricCard label="Active Agents" value={data.summary.active_agents} icon={<Users className="w-4 h-4" />} />
        </Link>
        <Link href={analyticsCallsLink(dateRange)} className="block transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer">
          <MetricCard label="Unassigned" value={data.summary.unassigned_calls} change="Calls without agent" icon={<Phone className="w-4 h-4" />} />
        </Link>
      </div>

      <Tabs defaultValue="reps" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reps" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Rep Metrics</TabsTrigger>
          <TabsTrigger value="charts" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Charts</TabsTrigger>
          <TabsTrigger value="leads" className="gap-1.5"><Target className="w-3.5 h-3.5" /> Lead Tiers</TabsTrigger>
        </TabsList>

        <TabsContent value="reps" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Agent Performance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-t">
                    <tr className="text-left">
                      <th className="p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent</th>
                      <th className="p-3"><SortHeader label="Calls" field="total_calls" /></th>
                      <th className="p-3"><SortHeader label="Answered" field="answered" /></th>
                      <th className="p-3"><SortHeader label="Missed" field="missed" /></th>
                      <th className="p-3"><SortHeader label="Answer %" field="answer_rate" /></th>
                      <th className="p-3"><SortHeader label="Avg Talk" field="avg_talk_seconds" /></th>
                      <th className="p-3"><SortHeader label="Recs" field="recordings" /></th>
                      <th className="p-3"><SortHeader label="Lead Score" field="avg_lead_score" /></th>
                      <th className="p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedReps.map((rep, idx) => (
                      <>
                        <tr
                          key={rep.ctm_user_id}
                          className="hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => setExpandedAgent(expandedAgent === rep.ctm_user_id ? null : rep.ctm_user_id)}
                        >
                          <td className="p-3">
                            <div className="font-medium">{rep.agent_name}</div>
                            {rep.email && <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{rep.email}</div>}
                          </td>
                          <td className="p-3 font-mono font-medium">{rep.total_calls}</td>
                          <td className="p-3">
                            <span className="text-emerald-400 font-medium">{rep.answered}</span>
                          </td>
                          <td className="p-3">
                            <span className={rep.missed > 0 ? "text-red-400 font-medium" : "text-muted-foreground"}>{rep.missed}</span>
                          </td>
                          <td className="p-3">
                            <Badge className={`text-[10px] ${
                              rep.answer_rate >= 90 ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" :
                              rep.answer_rate >= 75 ? "bg-blue-600/20 text-blue-400 border-blue-600/30" :
                              rep.answer_rate >= 60 ? "bg-amber-600/20 text-amber-400 border-amber-600/30" :
                              "bg-red-600/20 text-red-400 border-red-600/30"
                            }`}>{rep.answer_rate}%</Badge>
                          </td>
                          <td className="p-3 text-muted-foreground">{formatTalkTime(rep.avg_talk_seconds)}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-1">
                              {rep.recordings > 0 && <span className="flex items-center gap-0.5 text-cyan-400"><Mic className="w-3 h-3" /><span className="text-[10px]">{rep.recordings}</span></span>}
                              {rep.transcripts > 0 && <span className="flex items-center gap-0.5 text-violet-400"><FileText className="w-3 h-3" /><span className="text-[10px]">{rep.transcripts}</span></span>}
                              {rep.recordings === 0 && rep.transcripts === 0 && <span className="text-muted-foreground">—</span>}
                            </div>
                          </td>
                          <td className="p-3">
                            {rep.avg_lead_score != null ? (
                              <span className="font-medium">{rep.avg_lead_score}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              {expandedAgent === rep.ctm_user_id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </Button>
                          </td>
                        </tr>
                        {expandedAgent === rep.ctm_user_id && (
                          <tr key={`${rep.ctm_user_id}-detail`}>
                            <td colSpan={9} className="p-0">
                              <div className="px-6 py-4 bg-accent/10 border-b space-y-3">
                                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                  <div className="bg-background rounded-md p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-blue-400 mb-1"><PhoneIncoming className="w-3.5 h-3.5" /></div>
                                    <div className="text-lg font-bold">{rep.inbound}</div>
                                    <div className="text-[10px] text-muted-foreground">Inbound</div>
                                  </div>
                                  <div className="bg-background rounded-md p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1"><PhoneOutgoing className="w-3.5 h-3.5" /></div>
                                    <div className="text-lg font-bold">{rep.outbound}</div>
                                    <div className="text-[10px] text-muted-foreground">Outbound</div>
                                  </div>
                                  <div className="bg-background rounded-md p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1"><Clock className="w-3.5 h-3.5" /></div>
                                    <div className="text-lg font-bold">{formatTotalTime(rep.total_talk_seconds)}</div>
                                    <div className="text-[10px] text-muted-foreground">Total Talk</div>
                                  </div>
                                  <div className="bg-background rounded-md p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-cyan-400 mb-1"><Mic className="w-3.5 h-3.5" /></div>
                                    <div className="text-lg font-bold">{rep.recordings}</div>
                                    <div className="text-[10px] text-muted-foreground">Recordings</div>
                                  </div>
                                  <div className="bg-background rounded-md p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-violet-400 mb-1"><FileText className="w-3.5 h-3.5" /></div>
                                    <div className="text-lg font-bold">{rep.transcripts}</div>
                                    <div className="text-[10px] text-muted-foreground">Transcripts</div>
                                  </div>
                                  <div className="bg-background rounded-md p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 text-orange-400 mb-1"><Flame className="w-3.5 h-3.5" /></div>
                                    <div className="text-lg font-bold">{rep.hot_leads}</div>
                                    <div className="text-[10px] text-muted-foreground">Hot Leads</div>
                                  </div>
                                </div>
                                {(rep.sessions > 0 || rep.scored_calls > 0) && (
                                  <div className="bg-background rounded-md p-3">
                                    <div className="text-xs font-medium mb-2">Session & QA Data</div>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
                                      <div><span className="text-muted-foreground">Sessions:</span> <span className="font-medium">{rep.sessions}</span></div>
                                      <div><span className="text-muted-foreground">Scored:</span> <span className="font-medium">{rep.scored_calls}</span></div>
                                      <div><span className="text-muted-foreground">Avg Call Score:</span> <span className="font-medium">{rep.avg_call_score ?? "—"}</span></div>
                                      <div><span className="text-muted-foreground">QA Pass:</span> <span className="text-emerald-400 font-medium">{rep.qa_pass}</span></div>
                                      <div><span className="text-muted-foreground">QA Fail:</span> <span className="text-red-400 font-medium">{rep.qa_fail}</span></div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charts" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Calls by Agent (Answered vs Missed)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRepData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Bar dataKey="answered" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} name="Answered" />
                      <Bar dataKey="missed" fill="#ef4444" radius={[4, 4, 0, 0]} name="Missed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Calls by Direction (per Agent)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRepData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={80} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Bar dataKey="inbound" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} name="Inbound" stackId="dir" />
                      <Bar dataKey="outbound" fill={CHART_COLORS[4]} radius={[0, 4, 4, 0]} name="Outbound" stackId="dir" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Answer Rate by Agent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sortedReps.slice(0, 10).map((r) => ({
                    name: r.agent_name.split(" ")[0],
                    rate: r.answer_rate,
                    fill: r.answer_rate >= 90 ? "#22c55e" : r.answer_rate >= 75 ? "#3b82f6" : r.answer_rate >= 60 ? "#f59e0b" : "#ef4444",
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => `${v}%`} />
                    <Bar dataKey="rate" radius={[4, 4, 0, 0]} name="Answer Rate">
                      {sortedReps.slice(0, 10).map((r, i) => (
                        <Cell key={i} fill={r.answer_rate >= 90 ? "#22c55e" : r.answer_rate >= 75 ? "#3b82f6" : r.answer_rate >= 60 ? "#f59e0b" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leads" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Lead Quality Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72 flex items-center justify-center">
                  {tierData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={tierData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={4}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {tierData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-muted-foreground text-sm">No lead tier data yet</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Lead Tiers Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 py-4">
                  {Object.entries(data.tier_distribution)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([tier, count]) => {
                      const total = Object.values(data.tier_distribution).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={tier} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge className="text-[10px] font-mono" style={{ backgroundColor: `${TIER_COLORS[tier]}20`, color: TIER_COLORS[tier], borderColor: `${TIER_COLORS[tier]}50` }}>
                                Tier {tier}
                              </Badge>
                              <span className="text-muted-foreground text-xs">{count} leads</span>
                            </div>
                            <span className="font-medium">{pct}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: TIER_COLORS[tier] }} />
                          </div>
                        </div>
                      );
                    })}
                  {Object.keys(data.tier_distribution).length === 0 && (
                    <div className="text-center text-muted-foreground text-sm py-8">No tier data available yet</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Hot Leads by Agent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sortedReps.filter((r) => r.hot_leads > 0).length > 0 ? (
                  sortedReps
                    .filter((r) => r.hot_leads > 0)
                    .sort((a, b) => b.hot_leads - a.hot_leads)
                    .map((rep) => (
                      <div key={rep.ctm_user_id} className="flex items-center justify-between p-2 rounded-md bg-accent/20">
                        <div className="flex items-center gap-2">
                          <Flame className="w-4 h-4 text-orange-400" />
                          <span className="font-medium text-sm">{rep.agent_name}</span>
                        </div>
                        <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30">{rep.hot_leads} hot</Badge>
                      </div>
                    ))
                ) : (
                  <div className="text-center text-muted-foreground text-sm py-8">No hot leads detected yet</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
