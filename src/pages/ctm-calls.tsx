import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker, getDefaultDateRange, formatDateParam, type DateRange } from "@/components/date-range-picker";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Download,
  ExternalLink,
  Mic,
  FileText,
  Play,
  Loader2,
  User,
  BarChart3,
  Flame,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Heart,
  TrendingUp,
  Target,
  Flag,
  Zap,
  Scale,
  Brain,
} from "lucide-react";
import { format } from "date-fns";

interface CTMCall {
  id?: string;
  ctm_call_id: string;
  direction: string;
  call_status: string;
  caller_phone: string;
  caller_name: string;
  tracking_number: string;
  tracking_label: string;
  answering_ctm_user_id: string;
  agent_name: string | null;
  start_time: string;
  end_time: string;
  total_duration_seconds: number;
  talk_duration_seconds: number;
  missed_call_flag: boolean;
  has_recording: boolean;
  has_transcript: boolean;
  recording_url: string;
  transcript_preview: string;
  zoho_lead_id: string;
  source_event_type: string;
  lead_score: number | null;
  lead_quality_tier: string | null;
  call_score_total: number | null;
  qa_status: string | null;
  conversion_probability: number | null;
  hot_lead_flag: boolean | null;
}

interface CTMStats {
  total_calls: number;
  total_agents: number;
  pending_reviews: number;
  calls_by_direction: { inbound: number; outbound: number; missed: number };
  enrichment?: { calls_with_recording: number; calls_with_transcript: number };
}

function directionIcon(dir: string) {
  switch (dir) {
    case "inbound":
      return <PhoneIncoming className="w-4 h-4 text-blue-400" />;
    case "outbound":
      return <PhoneOutgoing className="w-4 h-4 text-emerald-400" />;
    case "msg_outbound":
    case "msg_inbound":
      return <MessageSquare className="w-4 h-4 text-violet-400" />;
    default:
      return <Phone className="w-4 h-4 text-slate-400" />;
  }
}

function statusBadge(status: string, missed: boolean) {
  if (missed) return <Badge variant="destructive" className="text-[10px]">Missed</Badge>;
  switch (status) {
    case "answered":
      return <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 text-[10px]">Answered</Badge>;
    case "in progress":
      return <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 text-[10px] animate-pulse">In Progress</Badge>;
    case "voicemail":
      return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[10px]">Voicemail</Badge>;
    case "no answer":
      return <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 text-[10px]">No Answer</Badge>;
    case "delivery_failed":
      return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status || "Unknown"}</Badge>;
  }
}

function tierBadge(tier: string | null) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    A: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
    B: "bg-blue-600/20 text-blue-400 border-blue-600/30",
    C: "bg-amber-600/20 text-amber-400 border-amber-600/30",
    D: "bg-orange-600/20 text-orange-400 border-orange-600/30",
    F: "bg-red-600/20 text-red-400 border-red-600/30",
  };
  return <Badge className={`${colors[tier] || "bg-slate-600/20 text-slate-400"} text-[10px] font-mono`}>{tier}</Badge>;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function CTMCalls() {
  const [calls, setCalls] = useState<CTMCall[]>([]);
  const [stats, setStats] = useState<CTMStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dirFilter, setDirFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | null>(getDefaultDateRange());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<any>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const limit = 50;

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (dirFilter !== "all") params.set("direction", dirFilter);
      if (dateRange) {
        params.set("start_date", formatDateParam(dateRange.startDate));
        params.set("end_date", formatDateParam(dateRange.endDate));
      } else {
        params.set("all_time", "true");
      }
      const res = await apiFetch(`/ctm-admin/calls?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCalls(data.calls);
        setTotal(data.total);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [offset, dirFilter, dateRange]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch("/ctm-admin/stats");
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setCallDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await apiFetch(`/ctm-admin/calls/${id}`);
      if (res.ok) setCallDetail(await res.json());
    } catch {}
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await apiFetch("/ctm-admin/backfill?hours=48", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Backfill complete: ${data.stored} calls stored, ${data.errors.length} errors`);
        fetchCalls();
        fetchStats();
      }
    } catch {
    } finally {
      setBackfilling(false);
    }
  };

  const handleEnrichAll = async () => {
    setEnriching(true);
    try {
      const res = await apiFetch("/ctm-admin/enrich-pending?limit=100", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Enrichment complete: ${data.enriched} calls enriched, ${data.no_updates} unchanged, ${data.errors} errors`);
        fetchCalls();
        fetchStats();
      }
    } catch {
    } finally {
      setEnriching(false);
    }
  };

  const handleEnrichSingle = async (ctmCallId: string) => {
    try {
      const res = await apiFetch(`/ctm-admin/enrich/${ctmCallId}`, { method: "POST" });
      if (res.ok) {
        if (expandedId === ctmCallId) {
          const detailRes = await apiFetch(`/ctm-admin/calls/${ctmCallId}`);
          if (detailRes.ok) setCallDetail(await detailRes.json());
        }
        fetchCalls();
      }
    } catch {}
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">CTM Call Log</h1>
          <p className="text-sm text-muted-foreground mt-1">Live calls with agent info, recordings, transcripts, and scoring</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker value={dateRange} onChange={(r) => { setDateRange(r); setOffset(0); }} />
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => { fetchCalls(); fetchStats(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={handleEnrichAll} disabled={enriching}>
            {enriching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Mic className="w-3.5 h-3.5 mr-1" />}
            {enriching ? "Enriching..." : "Fetch Recordings"}
          </Button>
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={handleBackfill} disabled={backfilling}>
            <Download className="w-3.5 h-3.5 mr-1" /> {backfilling ? "Backfilling..." : "Backfill 48h"}
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.total_calls}</div>
            <div className="text-xs text-muted-foreground">Total Calls</div>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.calls_by_direction.inbound}</div>
            <div className="text-xs text-muted-foreground">Inbound</div>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{stats.calls_by_direction.outbound}</div>
            <div className="text-xs text-muted-foreground">Outbound</div>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{stats.calls_by_direction.missed}</div>
            <div className="text-xs text-muted-foreground">Missed</div>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-cyan-400">{stats.enrichment?.calls_with_recording ?? 0}</div>
            <div className="text-xs text-muted-foreground">Recordings</div>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-violet-400">{stats.enrichment?.calls_with_transcript ?? 0}</div>
            <div className="text-xs text-muted-foreground">Transcripts</div>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-400">{stats.pending_reviews}</div>
            <div className="text-xs text-muted-foreground">Pending Reviews</div>
          </CardContent></Card>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={dirFilter} onValueChange={(v) => { setDirFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-40 h-11 md:h-8">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Directions</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
            <SelectItem value="msg_outbound">SMS Out</SelectItem>
            <SelectItem value="msg_inbound">SMS In</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
        </span>
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="sm" className="h-11 md:h-8" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</Button>
          <Button variant="outline" size="sm" className="h-11 md:h-8" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
        <ScrollArea className="h-[600px]">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <div className="divide-y divide-border min-w-[800px]">
              {calls.map((call) => (
                <div key={call.ctm_call_id}>
                  <button
                    onClick={() => toggleExpand(call.ctm_call_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-accent/30 transition-colors"
                  >
                    <div className="shrink-0">
                      {expandedId === call.ctm_call_id ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="shrink-0">{directionIcon(call.direction)}</div>
                    <div className="flex-1 min-w-0 grid grid-cols-8 gap-2 items-center">
                      <div>
                        <div className="text-sm font-medium truncate">{call.caller_name || "Unknown"}</div>
                        <div className="text-[11px] text-muted-foreground">{call.caller_phone}</div>
                      </div>
                      <div className="truncate">
                        {call.agent_name ? (
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-xs truncate">{call.agent_name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{call.tracking_label || "—"}</div>
                      <div>{statusBadge(call.call_status, call.missed_call_flag)}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDuration(call.total_duration_seconds)}
                      </div>
                      <div className="flex items-center gap-1">
                        {call.lead_quality_tier && tierBadge(call.lead_quality_tier)}
                        {call.lead_score != null && (
                          <span className="text-[10px] text-muted-foreground">{call.lead_score}</span>
                        )}
                        {call.hot_lead_flag && <Flame className="w-3 h-3 text-orange-400" />}
                      </div>
                      <div className="flex items-center gap-1">
                        {call.has_recording && <span title="Has recording"><Mic className="w-3.5 h-3.5 text-cyan-400" /></span>}
                        {call.has_transcript && <span title="Has transcript"><FileText className="w-3.5 h-3.5 text-violet-400" /></span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground text-right">
                        {call.start_time ? format(new Date(call.start_time), "MMM d, h:mm a") : "—"}
                      </div>
                    </div>
                  </button>

                  {expandedId === call.ctm_call_id && callDetail && (
                    <div className="px-12 pb-4 space-y-3">
                      {(callDetail.call as any).id && (
                        <a href={`/live/${(callDetail.call as any).id}`}
                           className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                           onClick={(e) => e.stopPropagation()}>
                          Open full live-call view →
                        </a>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">CTM Call ID:</span>
                          <span className="ml-1 font-mono">{callDetail.call.ctm_call_id}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Talk Time:</span>
                          <span className="ml-1">{formatDuration(callDetail.call.talk_duration_seconds)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tracking #:</span>
                          <span className="ml-1">{callDetail.call.tracking_number || "—"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Zoho Lead:</span>
                          <span className="ml-1">{callDetail.call.zoho_lead_id || "Not linked"}</span>
                        </div>
                      </div>

                      {callDetail.analysis && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <Card className="bg-gradient-to-br from-blue-950/40 to-blue-900/20 border-blue-800/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="flex items-center justify-center gap-1.5">
                                {callDetail.analysis.agent_score.qa_status === "pass" ? (
                                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                ) : callDetail.analysis.agent_score.qa_status === "fail" ? (
                                  <ShieldAlert className="w-4 h-4 text-red-400" />
                                ) : (
                                  <Scale className="w-4 h-4 text-amber-400" />
                                )}
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Agent QA</span>
                              </div>
                              <div className="text-2xl font-bold">
                                {callDetail.analysis.agent_score.percentage != null
                                  ? `${callDetail.analysis.agent_score.percentage}%`
                                  : "—"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {callDetail.analysis.agent_score.total_score}/{callDetail.analysis.agent_score.max_score} pts
                              </div>
                              <Badge className={
                                callDetail.analysis.agent_score.qa_status === "pass" ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30 text-[10px]" :
                                callDetail.analysis.agent_score.qa_status === "fail" ? "bg-red-600/20 text-red-400 border-red-600/30 text-[10px]" :
                                callDetail.analysis.agent_score.qa_status === "needs_review" ? "bg-amber-600/20 text-amber-400 border-amber-600/30 text-[10px]" :
                                "bg-slate-600/20 text-slate-400 border-slate-600/30 text-[10px]"
                              }>
                                {callDetail.analysis.agent_score.qa_status === "pass" ? "QA Pass" :
                                 callDetail.analysis.agent_score.qa_status === "fail" ? "QA Fail" :
                                 callDetail.analysis.agent_score.qa_status === "needs_review" ? "Needs Review" :
                                 "Unscored"}
                              </Badge>
                              {callDetail.analysis.agent_score.auto_fail_reason && (
                                <div className="text-[10px] text-red-400 mt-1 flex items-center gap-1 justify-center">
                                  <AlertTriangle className="w-3 h-3" /> {callDetail.analysis.agent_score.auto_fail_reason}
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          <Card className="bg-gradient-to-br from-violet-950/40 to-violet-900/20 border-violet-800/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="flex items-center justify-center gap-1.5">
                                <Heart className="w-4 h-4 text-violet-400" />
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sentiment</span>
                              </div>
                              <div className="text-2xl font-bold capitalize">
                                {callDetail.analysis.caller_sentiment.overall}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                Score: {callDetail.analysis.caller_sentiment.score}
                              </div>
                              <div className="flex items-center justify-center gap-2 text-[10px]">
                                <span className="text-emerald-400">+{callDetail.analysis.caller_sentiment.positive_count}</span>
                                <span className="text-red-400">-{callDetail.analysis.caller_sentiment.negative_count}</span>
                                {callDetail.analysis.caller_sentiment.concern_count > 0 && (
                                  <span className="text-amber-400">!{callDetail.analysis.caller_sentiment.concern_count}</span>
                                )}
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="bg-gradient-to-br from-emerald-950/40 to-emerald-900/20 border-emerald-800/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="flex items-center justify-center gap-1.5">
                                <TrendingUp className="w-4 h-4 text-emerald-400" />
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Lead Score</span>
                              </div>
                              <div className="text-2xl font-bold">
                                {callDetail.session?.lead_score ?? call.lead_score ?? "—"}
                              </div>
                              <div className="flex items-center justify-center gap-1.5">
                                {tierBadge(callDetail.session?.lead_quality_tier ?? call.lead_quality_tier)}
                                <span className="text-[10px] text-muted-foreground">Tier</span>
                              </div>
                              {(callDetail.session?.conversion_probability != null) && (
                                <div className="text-[10px] text-muted-foreground">
                                  {(callDetail.session.conversion_probability * 100).toFixed(0)}% conv. probability
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          <Card className="bg-gradient-to-br from-orange-950/40 to-orange-900/20 border-orange-800/30">
                            <CardContent className="p-3 space-y-1.5">
                              <div className="flex items-center justify-center gap-1.5">
                                <Flag className="w-4 h-4 text-orange-400" />
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Flags</span>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-center">
                                {(callDetail.session?.hot_lead_flag || call.hot_lead_flag) && (
                                  <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 text-[9px]">
                                    <Flame className="w-2.5 h-2.5 mr-0.5" /> Hot Lead
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.crisis_mention && (
                                  <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-[9px]">
                                    <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Crisis
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.immediate_need && (
                                  <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-[9px]">
                                    <Zap className="w-2.5 h-2.5 mr-0.5" /> Immediate
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.dui_related && (
                                  <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[9px]">
                                    <Scale className="w-2.5 h-2.5 mr-0.5" /> DUI
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.insurance_discussed && (
                                  <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 text-[9px]">
                                    <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> Insurance
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.financial_concern && (
                                  <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[9px]">
                                    Financial Concern
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.family_involvement && (
                                  <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 text-[9px]">
                                    Family Call
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.repeat_caller && (
                                  <Badge className="bg-violet-600/20 text-violet-400 border-violet-600/30 text-[9px]">
                                    Repeat Caller
                                  </Badge>
                                )}
                                {callDetail.analysis.flags.treatment_interest && (
                                  <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 text-[9px]">
                                    <Target className="w-2.5 h-2.5 mr-0.5" /> Treatment
                                  </Badge>
                                )}
                                {!Object.values(callDetail.analysis.flags).some(Boolean) && !(callDetail.session?.hot_lead_flag || call.hot_lead_flag) && (
                                  <span className="text-[10px] text-muted-foreground">No flags detected</span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )}

                      {callDetail.analysis?.agent_score?.breakdown && Object.keys(callDetail.analysis.agent_score.breakdown).length > 0 && (
                        <div className="bg-blue-950/20 border border-blue-800/20 rounded-md p-3 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                            <BarChart3 className="w-3.5 h-3.5" /> QA Score Breakdown
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {Object.entries(callDetail.analysis.agent_score.breakdown).map(([key, val]: [string, any]) => (
                              <div key={key} className="flex items-center gap-2 text-[11px]">
                                <div className="flex-1">
                                  <div className="flex justify-between mb-0.5">
                                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                                    <span className="font-mono text-foreground">{val.score}/{val.max}</span>
                                  </div>
                                  <div className="w-full bg-accent/30 rounded-full h-1.5">
                                    <div
                                      className={`h-1.5 rounded-full ${val.score / val.max >= 0.7 ? 'bg-emerald-500' : val.score / val.max >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                                      style={{ width: `${(val.score / val.max) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {callDetail.analysis?.agent_score?.coaching_flags?.length > 0 && (
                        <div className="bg-amber-950/20 border border-amber-800/20 rounded-md p-3 space-y-1.5">
                          <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                            <Brain className="w-3.5 h-3.5" /> Coaching Opportunities
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {callDetail.analysis.agent_score.coaching_flags.map((flag: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-[10px] text-amber-400 border-amber-600/30 capitalize">
                                {flag.replace(/_/g, " ")}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {!callDetail.analysis && callDetail.session && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <Card className="bg-emerald-950/30 border-emerald-800/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="text-[10px] text-muted-foreground uppercase">Lead Score</div>
                              <div className="text-2xl font-bold">{callDetail.session.lead_score ?? "—"}</div>
                              {tierBadge(callDetail.session.lead_quality_tier)}
                            </CardContent>
                          </Card>
                          <Card className="bg-emerald-950/30 border-emerald-800/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="text-[10px] text-muted-foreground uppercase">Conv. Prob.</div>
                              <div className="text-2xl font-bold">
                                {callDetail.session.conversion_probability != null
                                  ? `${(callDetail.session.conversion_probability * 100).toFixed(0)}%` : "—"}
                              </div>
                            </CardContent>
                          </Card>
                          <Card className="bg-emerald-950/30 border-emerald-800/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="text-[10px] text-muted-foreground uppercase">Hot Lead</div>
                              <div className="text-2xl font-bold">
                                {callDetail.session.hot_lead_flag ? <Flame className="w-6 h-6 text-orange-400 mx-auto" /> : "—"}
                              </div>
                            </CardContent>
                          </Card>
                          <Card className="bg-slate-800/30 border-slate-700/30">
                            <CardContent className="p-3 text-center space-y-1">
                              <div className="text-[10px] text-muted-foreground uppercase">Transcript Analysis</div>
                              <div className="text-sm text-muted-foreground">No transcript available</div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px] mt-1"
                                onClick={(e) => { e.stopPropagation(); handleEnrichSingle(call.ctm_call_id); }}
                              >
                                <RefreshCw className="w-3 h-3 mr-1" /> Fetch Transcript
                              </Button>
                            </CardContent>
                          </Card>
                        </div>
                      )}

                      {callDetail.agent && (
                        <div className="bg-blue-950/30 border border-blue-800/30 rounded-md p-3 space-y-1">
                          <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                            <User className="w-3.5 h-3.5" /> Handling Agent
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                            <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{callDetail.agent.full_name}</span></div>
                            <div><span className="text-muted-foreground">Email:</span> {callDetail.agent.email}</div>
                            <div><span className="text-muted-foreground">Role:</span> {callDetail.agent.role || "—"}</div>
                            <div><span className="text-muted-foreground">Team:</span> {callDetail.agent.team_name || "—"}</div>
                          </div>
                          {callDetail.agent.zoho_owner_id && (
                            <div className="text-[10px] text-muted-foreground">Zoho Owner: {callDetail.agent.zoho_owner_id}</div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2 flex-wrap">
                        {callDetail.call.voicemail_flag && <Badge variant="outline" className="text-[10px]">Voicemail</Badge>}
                        {callDetail.call.transferred_flag && <Badge variant="outline" className="text-[10px]">Transferred</Badge>}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={(e) => { e.stopPropagation(); handleEnrichSingle(call.ctm_call_id); }}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" /> Fetch Recording/Transcript
                        </Button>
                      </div>

                      {callDetail.call.recording_url && (
                        <div className="bg-cyan-950/30 border border-cyan-800/30 rounded-md p-3 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-cyan-400">
                            <Play className="w-3.5 h-3.5" /> Call Recording
                          </div>
                          <audio controls className="w-full h-8" preload="none">
                            <source src={callDetail.call.recording_url} />
                          </audio>
                          <a href={callDetail.call.recording_url} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> Open in new tab
                          </a>
                        </div>
                      )}

                      {callDetail.call.transcript_text && (
                        <div className="bg-violet-950/30 border border-violet-800/30 rounded-md p-3 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-violet-400">
                            <FileText className="w-3.5 h-3.5" /> Transcript
                          </div>
                          <ScrollArea className="max-h-60">
                            <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">
                              {callDetail.call.transcript_text}
                            </pre>
                          </ScrollArea>
                        </div>
                      )}

                      {!callDetail.call.recording_url && !callDetail.call.transcript_text && !callDetail.analysis && (
                        <div className="bg-accent/20 rounded-md p-3 text-xs text-muted-foreground text-center">
                          No recording or transcript available yet. Click "Fetch Recording/Transcript" to pull from CTM.
                        </div>
                      )}

                      {callDetail.attribution && (
                        <div className="bg-accent/30 rounded-md p-3 space-y-1">
                          <div className="text-xs font-medium mb-1">Attribution</div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                            <div><span className="text-muted-foreground">Source:</span> {callDetail.attribution.source || "—"}</div>
                            <div><span className="text-muted-foreground">Medium:</span> {callDetail.attribution.medium || "—"}</div>
                            <div><span className="text-muted-foreground">Campaign:</span> {callDetail.attribution.campaign || "—"}</div>
                            <div><span className="text-muted-foreground">Keyword:</span> {callDetail.attribution.keyword || "—"}</div>
                          </div>
                          {callDetail.attribution.landing_url && (
                            <div className="text-[11px] text-muted-foreground truncate">Landing: {callDetail.attribution.landing_url}</div>
                          )}
                        </div>
                      )}

                      {callDetail.attribution_events?.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Attribution Events</div>
                          {callDetail.attribution_events.map((ev: any) => (
                            <div key={ev.id} className="text-[11px] flex items-center gap-2 py-1">
                              <Badge variant={ev.review_required ? "destructive" : "outline"} className="text-[9px]">{ev.action}</Badge>
                              <span className="text-muted-foreground">{ev.field}:</span>
                              <span>{ev.old_value || "(empty)"} → {ev.new_value}</span>
                              {ev.reason && <span className="text-muted-foreground italic">({ev.reason})</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        </div>
      </Card>
    </div>
  );
}
