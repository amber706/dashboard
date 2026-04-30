import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Users, TrendingUp, TrendingDown, Phone, PhoneMissed,
  Clock, AlertTriangle, ShieldCheck, ShieldAlert, Flame, ChevronRight,
  CheckCircle2, XCircle, Pause, ArrowRight, BarChart3, Activity,
  Zap, Target, Scale, Heart, Brain, Eye, Circle, Headphones, PhoneOff, Loader2,
  Calendar,
} from "lucide-react";

interface KPIs {
  inbound_calls_today: number;
  total_calls_today: number;
  answered_today: number;
  answered_rate: number;
  missed_today: number;
  missed_rate: number;
  callback_backlog: number;
  overdue_first_contacts: number;
  overdue_followups: number;
  active_sessions: number;
  current_utilization: number;
  staffing_risk_level: string;
  active_agents: number;
  phone_calls_today?: number;
  form_fills_today?: number;
  chats_today?: number;
  texts_today?: number;
}

interface RepMetric {
  rep_id: string;
  rep_name: string;
  email: string;
  team: string | null;
  calls_today: number;
  calls_answered: number;
  calls_missed: number;
  answer_rate: number;
  avg_talk_time: number | null;
  open_leads: number;
  callbacks_due: number;
  overdue_followups: number;
  avg_lead_score: number | null;
  qa_average: number | null;
  capacity_score: number;
  capacity_status: string;
  logged_in?: boolean;
  online?: boolean;
  live_status?: string;
  on_call?: boolean;
  wrapup?: boolean;
  live_eligible?: boolean;
}

interface Recommendation {
  id: number;
  type: string;
  priority: string;
  title: string;
  summary: string;
  action: string;
  impact: string;
  confidence: number;
  affected_reps: string[];
  metrics: Record<string, any>;
}

interface HeatmapHour {
  hour: number;
  label: string;
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  is_peak: boolean;
  is_current: boolean;
}

interface RiskPanel {
  category: string;
  title: string;
  level: string;
  value: string;
  detail: string;
}

function riskColor(level: string) {
  switch (level) {
    case "critical": return "text-red-400 bg-red-950/40 border-red-800/30";
    case "elevated": return "text-orange-400 bg-orange-950/40 border-orange-800/30";
    case "moderate": return "text-amber-400 bg-amber-950/40 border-amber-800/30";
    default: return "text-emerald-400 bg-emerald-950/40 border-emerald-800/30";
  }
}

function priorityBadge(priority: string) {
  const styles: Record<string, string> = {
    critical: "bg-red-600/20 text-red-400 border-red-600/30",
    high: "bg-orange-600/20 text-orange-400 border-orange-600/30",
    medium: "bg-amber-600/20 text-amber-400 border-amber-600/30",
    low: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };
  return <Badge className={`${styles[priority] || styles.low} text-[10px]`}>{priority}</Badge>;
}

function capacityBar(score: number, status: string) {
  const color = status === "overloaded" ? "bg-red-500"
    : status === "heavy" ? "bg-orange-500"
    : status === "underutilized" ? "bg-blue-400"
    : status === "light" ? "bg-cyan-400"
    : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-accent/30 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-[10px] font-mono w-10 text-right">{score}%</span>
    </div>
  );
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function presenceIcon(status: string) {
  switch (status) {
    case "active_online_available":
      return <Circle className="w-3 h-3 text-emerald-400 fill-emerald-400" />;
    case "active_online_on_call":
    case "active_online_busy":
      return <Headphones className="w-3 h-3 text-amber-400" />;
    case "active_online_wrapup":
      return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
    case "active_online_unavailable":
      return <Circle className="w-3 h-3 text-orange-400 fill-orange-400" />;
    case "logged_in_but_idle":
      return <Circle className="w-3 h-3 text-yellow-400 fill-yellow-400" />;
    case "offline":
    case "logged_out":
      return <PhoneOff className="w-3 h-3 text-slate-500" />;
    default:
      return <Circle className="w-3 h-3 text-slate-600" />;
  }
}

function presenceLabel(status: string): string {
  const labels: Record<string, string> = {
    active_online_available: "Available",
    active_online_on_call: "On Call",
    active_online_busy: "Busy",
    active_online_wrapup: "Wrap-up",
    active_online_unavailable: "Unavailable",
    logged_in_but_idle: "Idle",
    offline: "Offline",
    logged_out: "Logged Out",
    scheduled_but_not_logged_in: "Not Logged In",
    unknown_status: "Unknown",
  };
  return labels[status] || status;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export default function ExecutiveOverview() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedRec, setExpandedRec] = useState<number | null>(null);
  const [showAllReps, setShowAllReps] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());

  const isToday = selectedDate === todayStr();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const dateParam = isToday ? "" : `?date=${selectedDate}`;
      const res = await apiFetch(`/executive/overview${dateParam}`);
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(new Date());
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [selectedDate, isToday]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData, isToday]);

  if (loading && !data) {
    return (
      <div className="p-5 md:p-8 lg:p-10 space-y-6 md:space-y-8 max-w-7xl mx-auto">
        <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return null;

  const kpis: KPIs = data.snapshot.kpis;
  const reps: RepMetric[] = data.rep_capacity;
  const recommendations: Recommendation[] = data.recommendations;
  const heatmap: HeatmapHour[] = data.heatmap;
  const risks: RiskPanel[] = data.risks;

  const riskIcon = kpis.staffing_risk_level === "critical" ? <ShieldAlert className="w-5 h-5 text-red-400" />
    : kpis.staffing_risk_level === "elevated" ? <AlertTriangle className="w-5 h-5 text-orange-400" />
    : kpis.staffing_risk_level === "moderate" ? <Scale className="w-5 h-5 text-amber-400" />
    : <ShieldCheck className="w-5 h-5 text-emerald-400" />;

  const activeReps = reps.filter(r => r.calls_today > 0);
  const displayReps = showAllReps ? reps : (activeReps.length > 0 ? activeReps : reps.slice(0, 10));

  const maxHeatVal = Math.max(...heatmap.map(h => h.total), 1);

  return (
    <div className="p-5 md:p-8 lg:p-10 space-y-6 md:space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-light tracking-tight">Executive Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isToday ? "Real-time staffing analysis and reallocation intelligence" : `Historical view for ${new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`}
            {data.snapshot?.facility_timezone && (
              <span className="ml-2 text-[10px] opacity-60">({data.snapshot.facility_timezone})</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={selectedDate}
              max={todayStr()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-[160px] h-11 md:h-8 text-sm bg-background border-border/50"
            />
            {!isToday && (
              <Button variant="ghost" size="sm" className="h-11 md:h-8 text-xs" onClick={() => setSelectedDate(todayStr())}>
                Today
              </Button>
            )}
          </div>
          {lastUpdated && (
            <span className="text-[11px] text-muted-foreground">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {!isToday && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-950/20 border border-amber-800/20 text-amber-400 text-sm">
          <Clock className="w-4 h-4 shrink-0" />
          Viewing historical data — live staffing and presence reflect current state only
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Card className="bg-gradient-to-br from-blue-950/30 to-blue-900/10 border-blue-800/20">
          <CardContent className="p-4 text-center">
            <Phone className="w-4 h-4 text-blue-400 mx-auto mb-1" />
            <div className="text-2xl font-semibold">{kpis.total_calls_today}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Total Today</div>
            {(kpis.form_fills_today || kpis.chats_today || kpis.texts_today) ? (
              <div className="text-[9px] text-muted-foreground mt-1 space-x-1.5">
                <span>{kpis.phone_calls_today ?? kpis.total_calls_today} calls</span>
                {kpis.form_fills_today ? <span>· {kpis.form_fills_today} forms</span> : null}
                {kpis.chats_today ? <span>· {kpis.chats_today} chats</span> : null}
                {kpis.texts_today ? <span>· {kpis.texts_today} texts</span> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-950/30 to-emerald-900/10 border-emerald-800/20">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
            <div className="text-2xl font-semibold">{kpis.answered_rate}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Answer Rate</div>
          </CardContent>
        </Card>
        <Card className={`bg-gradient-to-br ${kpis.missed_today > 3 ? "from-red-950/30 to-red-900/10 border-red-800/20" : "from-slate-900/30 to-slate-800/10 border-slate-700/20"}`}>
          <CardContent className="p-4 text-center">
            <PhoneMissed className={`w-4 h-4 ${kpis.missed_today > 3 ? "text-red-400" : "text-slate-400"} mx-auto mb-1`} />
            <div className="text-2xl font-semibold">{kpis.missed_today}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Missed ({kpis.missed_rate}%)</div>
          </CardContent>
        </Card>
        <Card className={`bg-gradient-to-br ${kpis.callback_backlog > 3 ? "from-orange-950/30 to-orange-900/10 border-orange-800/20" : "from-slate-900/30 to-slate-800/10 border-slate-700/20"}`}>
          <CardContent className="p-4 text-center">
            <Clock className={`w-4 h-4 ${kpis.callback_backlog > 3 ? "text-orange-400" : "text-slate-400"} mx-auto mb-1`} />
            <div className="text-2xl font-semibold">{kpis.callback_backlog}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Callback Backlog</div>
          </CardContent>
        </Card>
        <Card className={`bg-gradient-to-br ${kpis.overdue_first_contacts > 0 ? "from-amber-950/30 to-amber-900/10 border-amber-800/20" : "from-slate-900/30 to-slate-800/10 border-slate-700/20"}`}>
          <CardContent className="p-4 text-center">
            <Zap className={`w-4 h-4 ${kpis.overdue_first_contacts > 0 ? "text-amber-400" : "text-slate-400"} mx-auto mb-1`} />
            <div className="text-2xl font-semibold">{kpis.overdue_first_contacts}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Awaiting Contact</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-slate-900/30 to-slate-800/10 border-slate-700/20">
          <CardContent className="p-4 text-center">
            <TrendingDown className="w-4 h-4 text-slate-400 mx-auto mb-1" />
            <div className="text-2xl font-semibold">{kpis.overdue_followups}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Overdue Follow-ups</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-violet-950/30 to-violet-900/10 border-violet-800/20">
          <CardContent className="p-4 text-center">
            <Activity className="w-4 h-4 text-violet-400 mx-auto mb-1" />
            <div className="text-2xl font-semibold">{kpis.current_utilization}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Utilization</div>
          </CardContent>
        </Card>
        <Card className={`bg-gradient-to-br ${riskColor(kpis.staffing_risk_level)} border`}>
          <CardContent className="p-4 text-center">
            <div className="mx-auto mb-1 flex justify-center">{riskIcon}</div>
            <div className="text-lg font-semibold capitalize">{kpis.staffing_risk_level}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Risk Level</div>
          </CardContent>
        </Card>
      </div>

      {data.snapshot?.live_staffing && (
        <Card className="border-border/40">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium">Live Staffing</span>
              </div>
              <div className="flex items-center gap-3 md:gap-4 text-[11px] text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1"><Circle className="w-2 h-2 text-emerald-400 fill-emerald-400" /> Available {data.snapshot.live_staffing.available || 0}</div>
                <div className="flex items-center gap-1"><Headphones className="w-2 h-2 text-amber-400" /> Busy {data.snapshot.live_staffing.busy || 0}</div>
                <div className="flex items-center gap-1"><Loader2 className="w-2 h-2 text-blue-400" /> Wrap-up {data.snapshot.live_staffing.wrapup || 0}</div>
                <div className="flex items-center gap-1"><Circle className="w-2 h-2 text-yellow-400 fill-yellow-400" /> Idle {data.snapshot.live_staffing.idle || 0}</div>
                <div className="flex items-center gap-1"><PhoneOff className="w-2 h-2 text-slate-500" /> Offline {data.snapshot.live_staffing.offline || 0}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-accent/20 rounded-full h-3 overflow-hidden flex">
                {(() => {
                  const ls = data.snapshot.live_staffing;
                  const total = Math.max(ls.total_agents || 1, 1);
                  const segments = [
                    { count: ls.available || 0, color: "bg-emerald-500" },
                    { count: ls.idle || 0, color: "bg-yellow-500" },
                    { count: ls.busy || 0, color: "bg-amber-500" },
                    { count: ls.wrapup || 0, color: "bg-blue-500" },
                    { count: ls.unavailable || 0, color: "bg-orange-500" },
                    { count: ls.offline || 0, color: "bg-slate-600" },
                  ];
                  return segments.map((seg, i) =>
                    seg.count > 0 ? (
                      <div key={i} className={`${seg.color} h-full transition-all`} style={{ width: `${(seg.count / total) * 100}%` }} />
                    ) : null
                  );
                })()}
              </div>
              <span className="text-[11px] font-mono text-muted-foreground w-20 text-right">
                {data.snapshot.live_staffing.effective_capacity || 0} / {data.snapshot.live_staffing.total_agents || 0} ready
              </span>
            </div>
            {data.snapshot.staffing_risks && data.snapshot.staffing_risks.length > 0 && (
              <div className="mt-2 space-y-1">
                {data.snapshot.staffing_risks.map((risk: any, i: number) => (
                  <div key={i} className={`text-[11px] flex items-center gap-1.5 ${risk.severity === "critical" ? "text-red-400" : "text-amber-400"}`}>
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {risk.message}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">

          {recommendations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-medium">Reallocation Recommendations</h2>
                <Badge variant="outline" className="text-[10px] ml-1">{recommendations.length}</Badge>
              </div>
              <div className="space-y-2">
                {recommendations.map((rec) => (
                  <Card key={rec.id} className="border-border/50 hover:border-border/80 transition-colors">
                    <CardContent className="p-0">
                      <button
                        onClick={() => setExpandedRec(expandedRec === rec.id ? null : rec.id)}
                        className="w-full flex items-center gap-3 p-4 text-left"
                      >
                        <div className="shrink-0">{priorityBadge(rec.priority)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{rec.title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{rec.summary}</div>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${expandedRec === rec.id ? "rotate-90" : ""}`} />
                      </button>
                      {expandedRec === rec.id && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
                          <div className="text-[12px] text-foreground/80">{rec.summary}</div>
                          <div className="bg-accent/20 rounded-md p-3 space-y-1.5">
                            <div className="text-[11px] font-medium text-blue-400 flex items-center gap-1">
                              <ArrowRight className="w-3 h-3" /> Suggested Action
                            </div>
                            <div className="text-[12px]">{rec.action}</div>
                          </div>
                          <div className="bg-accent/20 rounded-md p-3 space-y-1.5">
                            <div className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
                              <Target className="w-3 h-3" /> Expected Impact
                            </div>
                            <div className="text-[12px]">{rec.impact}</div>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>Confidence: {Math.round(rec.confidence * 100)}%</span>
                            <span className="text-border">|</span>
                            <span>Type: {rec.type.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-medium">Staffing Allocation</h2>
                <Badge variant="outline" className="text-[10px] ml-1">{displayReps.length} of {reps.length}</Badge>
              </div>
              <Button variant="ghost" size="sm" className="text-[11px] h-11 md:h-7" onClick={() => setShowAllReps(!showAllReps)}>
                {showAllReps ? "Active Only" : "Show All"}
              </Button>
            </div>
            <Card>
              <div className="overflow-x-auto">
              <ScrollArea className="max-h-[500px]">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border/50">
                      <th className="text-left text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Rep</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Presence</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Calls</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Answer</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Open</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Callbacks</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Avg Talk</th>
                      <th className="text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider w-40">Capacity</th>
                      <th className="text-center text-[10px] font-medium text-muted-foreground p-3 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayReps.map((rep) => (
                      <tr key={rep.rep_id} className="border-b border-border/20 hover:bg-accent/10 transition-colors">
                        <td className="p-3">
                          <div className="text-sm font-medium">{rep.rep_name}</div>
                          <div className="text-[10px] text-muted-foreground">{rep.team || "—"}</div>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {presenceIcon(rep.live_status || "unknown_status")}
                            <span className="text-[10px]">{presenceLabel(rep.live_status || "unknown_status")}</span>
                          </div>
                        </td>
                        <td className="p-3 text-center text-sm">{rep.calls_today}</td>
                        <td className="p-3 text-center text-sm">{rep.answer_rate}%</td>
                        <td className="p-3 text-center text-sm">{rep.open_leads}</td>
                        <td className="p-3 text-center text-sm">
                          {rep.callbacks_due > 0 ? (
                            <span className="text-amber-400 font-medium">{rep.callbacks_due}</span>
                          ) : "0"}
                        </td>
                        <td className="p-3 text-center text-sm text-muted-foreground">{formatDuration(rep.avg_talk_time)}</td>
                        <td className="p-3">{capacityBar(rep.capacity_score, rep.capacity_status)}</td>
                        <td className="p-3 text-center">
                          <Badge className={`text-[9px] ${
                            rep.capacity_status === "overloaded" ? "bg-red-600/20 text-red-400 border-red-600/30" :
                            rep.capacity_status === "heavy" ? "bg-orange-600/20 text-orange-400 border-orange-600/30" :
                            rep.capacity_status === "underutilized" ? "bg-blue-600/20 text-blue-400 border-blue-600/30" :
                            rep.capacity_status === "light" ? "bg-cyan-600/20 text-cyan-400 border-cyan-600/30" :
                            "bg-emerald-600/20 text-emerald-400 border-emerald-600/30"
                          }`}>
                            {rep.capacity_status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </ScrollArea>
              </div>
            </Card>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-medium">Risk Assessment</h2>
            </div>
            <div className="space-y-2">
              {risks.map((risk, i) => (
                <Card key={i} className={`${riskColor(risk.level)} border`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-medium">{risk.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{risk.detail}</div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="text-lg font-semibold">{risk.value}</div>
                        <Badge variant="outline" className="text-[9px] capitalize">{risk.level}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-medium">Hourly Volume</h2>
            </div>
            <Card>
              <CardContent className="p-4">
                {(() => {
                  const BAR_AREA_PX = 120;
                  return (
                    <div className="flex items-end gap-px" style={{ height: `${BAR_AREA_PX + 16}px` }}>
                      {heatmap.map((h) => {
                        const barH = h.total > 0 ? Math.max(6, Math.round((h.total / maxHeatVal) * BAR_AREA_PX)) : 2;
                        const missedH = h.total > 0 ? Math.round((h.missed / h.total) * barH) : 0;
                        return (
                          <div key={h.hour} className="flex-1 flex flex-col items-center justify-end group relative" style={{ height: `${BAR_AREA_PX + 16}px` }}>
                            <div className="w-full relative rounded-t-sm overflow-hidden" style={{ height: `${barH}px` }}>
                              <div className={`absolute bottom-0 w-full rounded-t-sm ${h.is_current ? "bg-blue-500" : h.is_peak ? "bg-cyan-500" : "bg-slate-600"}`} style={{ height: "100%" }} />
                              {missedH > 0 && (
                                <div className="absolute top-0 w-full bg-red-500/60 rounded-t-sm" style={{ height: `${missedH}px` }} />
                              )}
                            </div>
                            {h.hour % 3 === 0 && (
                              <span className="text-[8px] text-muted-foreground mt-0.5 leading-none">{h.label}</span>
                            )}
                            <div className="absolute bottom-full mb-1 bg-popover border border-border rounded px-2 py-1 text-[10px] hidden group-hover:block whitespace-nowrap z-20 shadow-lg">
                              <div className="font-medium">{h.label}</div>
                              <div>Total: {h.total} | Missed: {h.missed}</div>
                              <div>Inbound: {h.inbound} | Outbound: {h.outbound}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-blue-500" /> Current</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-cyan-500" /> Peak</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-slate-600" /> Normal</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-red-500/60" /> Missed</div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-slate-400" />
              <h2 className="text-lg font-medium">Quick Stats</h2>
            </div>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Calls Today</span>
                  <span className="font-medium">{kpis.total_calls_today}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Active Agents</span>
                  <span className="font-medium">{kpis.active_agents}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Online Now</span>
                  <span className="font-medium">{data.snapshot?.live_staffing?.online || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Active Sessions</span>
                  <span className="font-medium">{kpis.active_sessions}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Calls per Agent</span>
                  <span className="font-medium">{kpis.active_agents > 0 ? (kpis.total_calls_today / kpis.active_agents).toFixed(1) : "—"}</span>
                </div>
                {(() => {
                  const overloaded = reps.filter(r => r.capacity_status === "overloaded").length;
                  const underutil = reps.filter(r => r.capacity_status === "underutilized").length;
                  return (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Overloaded Reps</span>
                        <span className={`font-medium ${overloaded > 0 ? "text-red-400" : ""}`}>{overloaded}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Underutilized Reps</span>
                        <span className={`font-medium ${underutil > 0 ? "text-blue-400" : ""}`}>{underutil}</span>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
