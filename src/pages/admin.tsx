import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { 
  useListCallSessions, 
  useListMissedCalls, 
  useListReps,
  useListRoutingEvents,
  useGetWriteLog,
  useListKbDocuments,
  useListFailedWrites,
  useRetryFailedWrite,
  useListFieldAuditLog,
  useGetRepRankings,
  useGetThresholds,
  useUpdateThresholds,
  useListEscalationRules,
  useApproveKbDocument,
  useRevokeKbDocument,
  useReindexKb,
  useUnapproveKbDocument,
  useListDuplicates,
  useMergeLeads,
  useGetFullTranscript,
  useReplayCall,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { Phone, Users, Activity, FileText, Settings, ShieldAlert, CheckCircle2, XCircle, Database, RotateCcw, Trophy, Sliders, AlertTriangle, Eye, Copy, GitMerge, MessageSquare, Loader2, ChevronDown, ChevronRight, ClipboardCheck, BarChart3, Star, BookOpen, GraduationCap, Lightbulb, ThumbsUp, ThumbsDown, Merge } from "lucide-react";

export default function Admin() {
  const { data: sessionsData, isLoading: loadingSessions } = useListCallSessions({ limit: 50 });
  const { data: missedData, isLoading: loadingMissed } = useListMissedCalls({ limit: 50 });
  const { data: repsData, isLoading: loadingReps } = useListReps();
  const { data: routingData, isLoading: loadingRouting } = useListRoutingEvents();
  const { data: writeLogData, isLoading: loadingWrites } = useGetWriteLog({ limit: 50 });
  const { data: kbData, isLoading: loadingKb, refetch: refetchKb } = useListKbDocuments();
  const { data: failedData, isLoading: loadingFailed, refetch: refetchFailed } = useListFailedWrites({ limit: 100 });
  const { data: auditData, isLoading: loadingAudit } = useListFieldAuditLog({ limit: 200 });
  const { data: rankingsData, isLoading: loadingRankings } = useGetRepRankings();
  const { data: thresholdsData, isLoading: loadingThresholds, refetch: refetchThresholds } = useGetThresholds();
  const { data: rulesData, isLoading: loadingRules } = useListEscalationRules();

  const { data: dupesData, isLoading: loadingDupes, refetch: refetchDupes } = useListDuplicates({ limit: 50 });

  const [completenessData, setCompletenessData] = useState<any>(null);
  const [loadingCompleteness, setLoadingCompleteness] = useState(false);

  const [qaScores, setQaScores] = useState<any>(null);
  const [loadingQaScores, setLoadingQaScores] = useState(false);
  const [qaSummary, setQaSummary] = useState<any>(null);
  const [qaFilter, setQaFilter] = useState<string>("all");
  const [qaDetailCallId, setQaDetailCallId] = useState<string>("");
  const [qaDetail, setQaDetail] = useState<any>(null);
  const [loadingQaDetail, setLoadingQaDetail] = useState(false);

  const fetchCompleteness = async () => {
    setLoadingCompleteness(true);
    try {
      const res = await apiFetch(`/admin/completeness?limit=100`);
      if (res.ok) {
        setCompletenessData(await res.json());
      }
    } catch (e) {
    } finally {
      setLoadingCompleteness(false);
    }
  };

  const fetchQaScores = async (status?: string) => {
    setLoadingQaScores(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status && status !== "all") params.set("qa_status", status);
      const res = await apiFetch(`/admin/qa-scores?${params}`);
      if (res.ok) setQaScores(await res.json());
    } catch (e) {} finally { setLoadingQaScores(false); }
  };

  const fetchQaSummary = async () => {
    try {
      const res = await apiFetch(`/admin/qa-summary`);
      if (res.ok) setQaSummary(await res.json());
    } catch (e) {}
  };

  const fetchQaDetail = async (callId: string) => {
    if (!callId) return;
    setLoadingQaDetail(true);
    try {
      const res = await apiFetch(`/admin/qa-scores/${callId}`);
      if (res.ok) setQaDetail(await res.json());
    } catch (e) {} finally { setLoadingQaDetail(false); }
  };

  useEffect(() => { fetchCompleteness(); fetchQaScores(); fetchQaSummary(); }, []);

  const retryWrite = useRetryFailedWrite();
  const updateThresholds = useUpdateThresholds();
  const approveDoc = useApproveKbDocument();
  const revokeDoc = useRevokeKbDocument();
  const reindexKb = useReindexKb();
  const unapproveDoc = useUnapproveKbDocument();
  const mergeLeads = useMergeLeads();

  const [liveWrite, setLiveWrite] = useState("");
  const [showConfirm, setShowConfirm] = useState("");
  const [mergeTarget, setMergeTarget] = useState<any>(null);
  const [transcriptCallId, setTranscriptCallId] = useState("");
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null);
  const [docDetail, setDocDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [qaGrades, setQaGrades] = useState<any>(null);
  const [loadingQaGrades, setLoadingQaGrades] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<any>(null);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [kbDrafts, setKbDrafts] = useState<any>(null);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [kbAnalytics, setKbAnalytics] = useState<any>(null);
  const [repCoaching, setRepCoaching] = useState<any>(null);
  const [loadingCoaching, setLoadingCoaching] = useState(false);
  const [selectedRepForCoaching, setSelectedRepForCoaching] = useState("");
  const [qaTrends, setQaTrends] = useState<any>(null);
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [gradeDetailId, setGradeDetailId] = useState("");
  const [gradeDetail, setGradeDetail] = useState<any>(null);

  const fetchQaGrades = async () => {
    setLoadingQaGrades(true);
    try {
      const res = await apiFetch(`/admin/qa/grades?limit=50`);
      if (res.ok) setQaGrades(await res.json());
    } catch (e) {} finally { setLoadingQaGrades(false); }
  };

  const fetchReviewQueue = async () => {
    setLoadingReviews(true);
    try {
      const res = await apiFetch(`/admin/qa/review-queue`);
      if (res.ok) setReviewQueue(await res.json());
    } catch (e) {} finally { setLoadingReviews(false); }
  };

  const fetchKbDrafts = async () => {
    setLoadingDrafts(true);
    try {
      const [draftsRes, analyticsRes] = await Promise.all([
        apiFetch(`/admin/kb-drafts/queue?limit=50`),
        apiFetch(`/admin/kb-drafts/analytics`),
      ]);
      if (draftsRes.ok) setKbDrafts(await draftsRes.json());
      if (analyticsRes.ok) setKbAnalytics(await analyticsRes.json());
    } catch (e) {} finally { setLoadingDrafts(false); }
  };

  const fetchQaTrends = async () => {
    try {
      const res = await apiFetch(`/admin/qa/trends?limit=100`);
      if (res.ok) setQaTrends(await res.json());
    } catch (e) {}
  };

  const fetchRepCoaching = async (repId: string) => {
    if (!repId) return;
    setLoadingCoaching(true);
    try {
      const res = await apiFetch(`/admin/qa/rep-grading/${repId}?limit=20`);
      if (res.ok) setRepCoaching(await res.json());
    } catch (e) {} finally { setLoadingCoaching(false); }
  };

  const handleApproveDraft = async (draftId: number) => {
    try {
      const res = await apiFetch(`/admin/kb-drafts/draft/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: "admin" }),
      });
      if (res.ok) fetchKbDrafts();
    } catch (e) {}
  };

  const handleRejectDraft = async (draftId: number) => {
    try {
      const res = await apiFetch(`/admin/kb-drafts/draft/${draftId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejected_by: "admin", reason: "Rejected by supervisor" }),
      });
      if (res.ok) fetchKbDrafts();
    } catch (e) {}
  };

  const handleRunDiscovery = async () => {
    setDiscoveryRunning(true);
    try {
      const res = await apiFetch(`/admin/kb-drafts/run-discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) fetchKbDrafts();
    } catch (e) {} finally { setDiscoveryRunning(false); }
  };

  const handleCompleteReview = async (reviewId: number, notes: string) => {
    try {
      const res = await apiFetch(`/admin/qa/review/${reviewId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewer_id: "admin", coaching_notes: notes }),
      });
      if (res.ok) fetchReviewQueue();
    } catch (e) {}
  };

  const fetchGradeDetail = async (callId: string) => {
    try {
      const res = await apiFetch(`/admin/qa/grades/${callId}`);
      if (res.ok) setGradeDetail(await res.json());
    } catch (e) {}
  };

  useEffect(() => {
    if (expandedDocId === null) {
      setDocDetail(null);
      return;
    }
    setLoadingDetail(true);
    fetch(`/admissions-copilot/kb/documents/${expandedDocId}/detail`)
      .then(r => r.json())
      .then(data => { setDocDetail(data); setLoadingDetail(false); })
      .catch(() => setLoadingDetail(false));
  }, [expandedDocId]);

  const handleThresholdSave = () => {
    const payload: any = {};
    if (liveWrite) payload.confidence_live_write = parseFloat(liveWrite);
    if (showConfirm) payload.confidence_show_confirm = parseFloat(showConfirm);
    updateThresholds.mutate({ data: payload }, {
      onSuccess: () => {
        refetchThresholds();
        setLiveWrite("");
        setShowConfirm("");
      },
    });
  };

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6 md:space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
          <p className="text-muted-foreground">System overview, audit logs, and configuration.</p>
        </div>
      </div>

      <Tabs defaultValue="sessions" className="space-y-6">
        <TabsList className="bg-muted/50 p-1 flex flex-wrap h-auto">
          <TabsTrigger value="sessions" className="flex items-center gap-2"><Phone className="w-4 h-4"/> Sessions</TabsTrigger>
          <TabsTrigger value="reps" className="flex items-center gap-2"><Users className="w-4 h-4"/> Reps</TabsTrigger>
          <TabsTrigger value="rankings" className="flex items-center gap-2"><Trophy className="w-4 h-4"/> Rankings</TabsTrigger>
          <TabsTrigger value="missed" className="flex items-center gap-2"><ShieldAlert className="w-4 h-4"/> Missed</TabsTrigger>
          <TabsTrigger value="routing" className="flex items-center gap-2"><Activity className="w-4 h-4"/> Routing</TabsTrigger>
          <TabsTrigger value="writes" className="flex items-center gap-2"><FileText className="w-4 h-4"/> Writes</TabsTrigger>
          <TabsTrigger value="failed" className="flex items-center gap-2"><XCircle className="w-4 h-4"/> Failed</TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-2"><Eye className="w-4 h-4"/> Audit</TabsTrigger>
          <TabsTrigger value="thresholds" className="flex items-center gap-2"><Sliders className="w-4 h-4"/> Thresholds</TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2"><AlertTriangle className="w-4 h-4"/> Escalation</TabsTrigger>
          <TabsTrigger value="duplicates" className="flex items-center gap-2"><Copy className="w-4 h-4"/> Duplicates</TabsTrigger>
          <TabsTrigger value="transcript" className="flex items-center gap-2"><MessageSquare className="w-4 h-4"/> Transcript</TabsTrigger>
          <TabsTrigger value="completeness" className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4"/> Completeness</TabsTrigger>
          <TabsTrigger value="qa-dashboard" className="flex items-center gap-2"><BarChart3 className="w-4 h-4"/> QA Dashboard</TabsTrigger>
          <TabsTrigger value="kb" className="flex items-center gap-2"><Database className="w-4 h-4"/> KB</TabsTrigger>
          <TabsTrigger value="qa-review" className="flex items-center gap-2" onClick={() => { fetchQaGrades(); fetchReviewQueue(); fetchQaTrends(); }}><Star className="w-4 h-4"/> QA Review</TabsTrigger>
          <TabsTrigger value="kb-drafts" className="flex items-center gap-2" onClick={() => fetchKbDrafts()}><BookOpen className="w-4 h-4"/> KB Drafts</TabsTrigger>
          <TabsTrigger value="coaching" className="flex items-center gap-2" onClick={() => fetchQaTrends()}><GraduationCap className="w-4 h-4"/> Coaching</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <Card>
            <CardHeader><CardTitle>All Call Sessions</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Status</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Agent</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Caller</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Score</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right">Fields (W/T)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingSessions ? (
                      <tr><td colSpan={7} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : sessionsData?.sessions?.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No sessions found</td></tr>
                    ) : (
                      sessionsData?.sessions?.map(session => (
                        <tr key={session.id} className="hover:bg-muted/20 transition-colors">
                          <td className="p-3 font-mono text-xs">{session.ctm_call_id}</td>
                          <td className="p-3">
                            <Badge variant={session.status === 'active' ? 'default' : session.status === 'ended' ? 'secondary' : 'outline'}>
                              {session.status}
                            </Badge>
                          </td>
                          <td className="p-3 font-medium">{session.rep_name || session.rep_id || '-'}</td>
                          <td className="p-3">{session.caller_phone || '-'}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-1">
                              {session.lead_quality_tier && (
                                <Badge className={`text-[10px] ${
                                  session.lead_quality_tier === 'A' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' :
                                  session.lead_quality_tier === 'B' ? 'bg-blue-600/20 text-blue-400 border-blue-600/30' :
                                  session.lead_quality_tier === 'C' ? 'bg-amber-600/20 text-amber-400 border-amber-600/30' :
                                  'bg-red-600/20 text-red-400 border-red-600/30'
                                }`}>{session.lead_quality_tier}</Badge>
                              )}
                              {session.lead_score != null && <span className="text-xs text-muted-foreground">{session.lead_score}</span>}
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {session.started_at ? format(new Date(session.started_at), 'MMM d, h:mm a') : '-'}
                          </td>
                          <td className="p-3 text-right">
                            <span className="font-medium text-green-600">{session.written_count || 0}</span>
                            <span className="text-muted-foreground mx-1">/</span>
                            <span className="text-muted-foreground">{session.field_count || 0}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reps">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {loadingReps ? (
              Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
            ) : repsData?.reps?.length === 0 ? (
              <div className="col-span-full p-8 text-center text-muted-foreground border rounded-xl">No reps found</div>
            ) : (
              repsData?.reps?.map(rep => (
                <Card key={rep.rep_id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{rep.rep_name || rep.rep_id}</CardTitle>
                      <div className={`w-2.5 h-2.5 rounded-full ${rep.availability_status === 'available' ? 'bg-green-500' : 'bg-amber-500'}`} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm space-y-2 mt-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Active Leads</span>
                        <span className="font-medium">{rep.active_open_leads || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Answer Rate</span>
                        <span className="font-medium">{rep.recent_answer_rate ? `${(rep.recent_answer_rate * 100).toFixed(0)}%` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Book Rate</span>
                        <span className="font-medium">{rep.recent_book_rate ? `${(rep.recent_book_rate * 100).toFixed(0)}%` : '-'}</span>
                      </div>
                      {rep.specialty_tags && rep.specialty_tags.length > 0 && (
                        <div className="pt-2 flex flex-wrap gap-1 mt-2 border-t">
                          {rep.specialty_tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="rankings">
          <Card>
            <CardHeader><CardTitle>Rep Rankings (Callback Priority)</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Rank</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Rep</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Status</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Score</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Answer</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Book</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Callback</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Missed</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingRankings ? (
                      <tr><td colSpan={9} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : !rankingsData?.rankings?.length ? (
                      <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No rankings available</td></tr>
                    ) : (
                      rankingsData.rankings.map((r, idx) => (
                        <tr key={r.rep_id} className={`hover:bg-muted/20 ${r.score < 0 ? 'opacity-50' : ''}`}>
                          <td className="p-3 font-bold text-primary">{idx + 1}</td>
                          <td className="p-3 font-medium">{r.rep_name || r.rep_id}</td>
                          <td className="p-3">
                            <Badge variant={r.status === 'available' ? 'default' : 'outline'}>{r.status}</Badge>
                          </td>
                          <td className="p-3 font-mono">{r.score >= 0 ? r.score.toFixed(3) : 'N/A'}</td>
                          <td className="p-3">{((r.answer_rate ?? 0) * 100).toFixed(0)}%</td>
                          <td className="p-3">{((r.book_rate ?? 0) * 100).toFixed(0)}%</td>
                          <td className="p-3">{((r.callback_success_rate ?? 0) * 100).toFixed(0)}%</td>
                          <td className="p-3">{r.missed_count}</td>
                          <td className="p-3">{r.open_leads}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="missed">
          <Card>
            <CardHeader><CardTitle>Missed Calls Queue</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Caller</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Assigned Rep</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingMissed ? (
                      <tr><td colSpan={4} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : missedData?.missed_calls?.length === 0 ? (
                      <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No missed calls recorded.</td></tr>
                    ) : (
                      missedData?.missed_calls?.map(call => (
                        <tr key={call.ctm_call_id} className="hover:bg-muted/20">
                          <td className="p-3 font-mono text-xs">{call.ctm_call_id}</td>
                          <td className="p-3 font-medium">{call.caller_phone || '-'}</td>
                          <td className="p-3">{call.rep_id || 'Unassigned'}</td>
                          <td className="p-3 text-muted-foreground">
                            {call.started_at ? format(new Date(call.started_at), 'MMM d, h:mm a') : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="writes">
          <Card>
            <CardHeader><CardTitle>Zoho CRM Write Log</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] border rounded-md overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b sticky top-0 z-10">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Status</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Fields Written</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Record ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingWrites ? (
                      <tr><td colSpan={5} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : writeLogData?.logs?.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No write logs found.</td></tr>
                    ) : (
                      writeLogData?.logs?.map(log => (
                        <tr key={log.id} className="hover:bg-muted/20">
                          <td className="p-3">
                            {log.success ? (
                              <CheckCircle2 className="w-5 h-5 text-green-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-destructive" />
                            )}
                          </td>
                          <td className="p-3 font-mono text-xs">{log.ctm_call_id}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {log.fields?.map(f => (
                                <Badge key={f} variant="secondary" className="text-[10px] px-1 py-0">{f}</Badge>
                              ))}
                            </div>
                            {!log.success && log.error && (
                              <div className="text-xs text-destructive mt-1">{log.error}</div>
                            )}
                          </td>
                          <td className="p-3 font-mono text-xs">{log.zoho_record_id || '-'}</td>
                          <td className="p-3 text-muted-foreground">
                            {log.written_at ? format(new Date(log.written_at), 'MMM d, HH:mm:ss') : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="failed">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Failed CRM Writes</CardTitle>
                <Badge variant="destructive">{failedData?.total || 0} failed</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Fields</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Error</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Retries</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingFailed ? (
                      <tr><td colSpan={6} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : !failedData?.failed_writes?.length ? (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No failed writes. All clear.</td></tr>
                    ) : (
                      failedData.failed_writes.map(fw => (
                        <tr key={fw.id} className="hover:bg-muted/20">
                          <td className="p-3 font-mono text-xs">{fw.ctm_call_id}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {fw.fields && Object.keys(fw.fields).map(f => (
                                <Badge key={f} variant="secondary" className="text-[10px] px-1 py-0">{f}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-xs text-destructive max-w-[200px] truncate">{fw.error || '-'}</td>
                          <td className="p-3 text-center">{fw.retry_count || 0}</td>
                          <td className="p-3 text-muted-foreground text-xs">
                            {fw.written_at ? format(new Date(fw.written_at), 'MMM d, HH:mm') : '-'}
                          </td>
                          <td className="p-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retryWrite.mutate({ writeLogId: fw.id }, { onSuccess: () => refetchFailed() })}
                              disabled={retryWrite.isPending}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle>Field-Level Decision Audit Log</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] border rounded-md overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b sticky top-0 z-10">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Field</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Value</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Confidence</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Decision</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Reason</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingAudit ? (
                      <tr><td colSpan={7} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : !auditData?.audit_logs?.length ? (
                      <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No audit entries yet.</td></tr>
                    ) : (
                      auditData.audit_logs.map(a => (
                        <tr key={a.id} className="hover:bg-muted/20">
                          <td className="p-3 font-mono text-xs">{a.ctm_call_id}</td>
                          <td className="p-3 font-medium">{a.field_name}</td>
                          <td className="p-3">{a.field_value || '-'}</td>
                          <td className="p-3">
                            <span className={`font-mono ${a.confidence >= 0.92 ? 'text-green-600' : a.confidence >= 0.7 ? 'text-amber-600' : 'text-red-500'}`}>
                              {(a.confidence * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td className="p-3">
                            <Badge variant={a.decision === 'live_write' ? 'default' : a.decision === 'show_confirm' ? 'secondary' : 'outline'}>
                              {a.decision}
                            </Badge>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground max-w-[250px] truncate">{a.decision_reason}</td>
                          <td className="p-3 text-muted-foreground text-xs">
                            {a.created_at ? format(new Date(a.created_at), 'MMM d, HH:mm') : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="thresholds">
          <Card>
            <CardHeader><CardTitle>Confidence Threshold Settings</CardTitle></CardHeader>
            <CardContent>
              {loadingThresholds ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-6 max-w-md">
                  <div className="p-4 border rounded-lg bg-muted/30">
                    <div className="text-sm font-medium mb-1">Current Thresholds</div>
                    <div className="flex gap-8 text-sm">
                      <div>
                        <span className="text-muted-foreground">Live Write:</span>{" "}
                        <span className="font-mono font-bold text-green-600">{thresholdsData?.confidence_live_write ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Show Confirm:</span>{" "}
                        <span className="font-mono font-bold text-amber-600">{thresholdsData?.confidence_show_confirm ?? '-'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Live Write Threshold (0.0 - 1.0)</label>
                      <p className="text-xs text-muted-foreground mb-2">Fields above this confidence are written to CRM automatically.</p>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        placeholder={String(thresholdsData?.confidence_live_write ?? 0.92)}
                        value={liveWrite}
                        onChange={e => setLiveWrite(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Show Confirm Threshold (0.0 - 1.0)</label>
                      <p className="text-xs text-muted-foreground mb-2">Fields above this but below live write are shown for rep confirmation.</p>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        placeholder={String(thresholdsData?.confidence_show_confirm ?? 0.70)}
                        value={showConfirm}
                        onChange={e => setShowConfirm(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleThresholdSave} disabled={updateThresholds.isPending || (!liveWrite && !showConfirm)}>
                      <Settings className="w-4 h-4 mr-2" />
                      Save Thresholds
                    </Button>
                    {updateThresholds.isSuccess && (
                      <p className="text-sm text-green-600">Thresholds updated successfully.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader><CardTitle>Escalation Rules</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Rule</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Keywords</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Severity</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Action</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Enabled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingRules ? (
                      <tr><td colSpan={5} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : !rulesData?.rules?.length ? (
                      <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No escalation rules configured.</td></tr>
                    ) : (
                      rulesData.rules.map(rule => (
                        <tr key={rule.id} className="hover:bg-muted/20">
                          <td className="p-3 font-medium">{rule.rule_name}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {rule.keywords?.map(kw => (
                                <Badge key={kw} variant="outline" className="text-[10px] px-1 py-0">{kw}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge variant={rule.severity === 'critical' ? 'destructive' : rule.severity === 'high' ? 'default' : 'secondary'}>
                              {rule.severity}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground">{rule.action}</td>
                          <td className="p-3">
                            {rule.enabled ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <XCircle className="w-4 h-4 text-muted-foreground" />
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routing">
          <Card>
            <CardHeader><CardTitle>Routing Decisions</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Selected Rep</th>
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingRouting ? (
                      <tr><td colSpan={4} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                    ) : routingData?.events?.length === 0 ? (
                      <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No routing events found.</td></tr>
                    ) : (
                      routingData?.events?.map(event => (
                        <tr key={event.id} className="hover:bg-muted/20">
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {event.created_at ? format(new Date(event.created_at), 'MMM d, h:mm a') : '-'}
                          </td>
                          <td className="p-3 font-mono text-xs">{event.ctm_call_id}</td>
                          <td className="p-3 font-medium">{event.selected_rep_id || 'Unassigned'}</td>
                          <td className="p-3 text-muted-foreground">{event.reason_text}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duplicates">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Possible Duplicate Leads</CardTitle>
                <Badge variant="secondary">{dupesData?.total || 0} found</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loadingDupes ? (
                <Skeleton className="h-32 w-full" />
              ) : !dupesData?.duplicates?.length ? (
                <div className="text-center py-8 text-muted-foreground">No duplicate candidates found.</div>
              ) : (
                <div className="space-y-4">
                  {dupesData.duplicates.map((dup: any, idx: number) => (
                    <div key={idx} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Phone className="w-4 h-4 text-muted-foreground" />
                          <span className="font-mono font-medium">{dup.phone}</span>
                          <Badge variant="outline" className="text-xs">{dup.session_count} sessions</Badge>
                          <Badge variant="secondary" className="text-xs">{dup.reason?.replace(/_/g, " ")}</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setMergeTarget(dup)}
                          >
                            <GitMerge className="w-3 h-3 mr-1" />
                            Review & Merge
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground"
                            onClick={() => {
                              if (dup.lead_ids?.[0]) {
                                mergeLeads.mutate({ data: { primary_lead_id: dup.lead_ids[0], action: "dismiss" } }, { onSuccess: () => refetchDupes() });
                              }
                            }}
                            disabled={mergeLeads.isPending}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Lead IDs: {dup.lead_ids?.join(", ") || "none"}
                      </div>
                      <div className="rounded border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50 border-b">
                            <tr>
                              <th className="p-2 text-left font-semibold">Call ID</th>
                              <th className="p-2 text-left font-semibold">Lead ID</th>
                              <th className="p-2 text-left font-semibold">Rep</th>
                              <th className="p-2 text-left font-semibold">Status</th>
                              <th className="p-2 text-left font-semibold">Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {dup.sessions?.map((s: any) => (
                              <tr key={s.ctm_call_id} className="hover:bg-muted/20">
                                <td className="p-2 font-mono">{s.ctm_call_id}</td>
                                <td className="p-2 font-mono">{s.zoho_lead_id || "-"}</td>
                                <td className="p-2">{s.rep_id || "-"}</td>
                                <td className="p-2"><Badge variant="outline" className="text-[10px]">{s.status}</Badge></td>
                                <td className="p-2 text-muted-foreground">{s.started_at ? format(new Date(s.started_at), "MMM d, h:mm a") : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {mergeTarget && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <Card className="w-full max-w-lg mx-4">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <GitMerge className="w-5 h-5" />
                        Merge Review — {mergeTarget.phone}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="text-sm text-muted-foreground">
                        Select the primary lead to keep. All sessions from other leads will be reassigned.
                      </div>
                      <div className="space-y-2">
                        {mergeTarget.lead_ids?.map((leadId: string) => (
                          <div key={leadId} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/20">
                            <div>
                              <div className="font-mono text-sm font-medium">{leadId}</div>
                              <div className="text-xs text-muted-foreground">
                                {mergeTarget.sessions?.filter((s: any) => s.zoho_lead_id === leadId).length || 0} sessions
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => {
                                const secondaries = mergeTarget.lead_ids.filter((id: string) => id !== leadId);
                                mergeLeads.mutate({
                                  data: { primary_lead_id: leadId, secondary_lead_ids: secondaries, action: "merge" }
                                }, {
                                  onSuccess: () => { setMergeTarget(null); refetchDupes(); }
                                });
                              }}
                              disabled={mergeLeads.isPending}
                            >
                              {mergeLeads.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                              Use as Primary
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2 pt-2 border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (mergeTarget.lead_ids?.[0]) {
                              mergeLeads.mutate({ data: { primary_lead_id: mergeTarget.lead_ids[0], action: "dismiss" } }, {
                                onSuccess: () => { setMergeTarget(null); refetchDupes(); }
                              });
                            }
                          }}
                          disabled={mergeLeads.isPending}
                        >
                          Dismiss (Not Duplicates)
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setMergeTarget(null)}>
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transcript">
          <Card>
            <CardHeader>
              <CardTitle>Transcript Replay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter Call ID (e.g. DEMO-CALL-001)"
                  value={transcriptCallId}
                  onChange={(e: any) => setTranscriptCallId(e.target.value)}
                  className="max-w-md"
                />
              </div>

              {transcriptCallId && <TranscriptReplayView callId={transcriptCallId} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completeness">
          <div className="space-y-6">
            {completenessData?.aggregate && (
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Sessions</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{completenessData.aggregate.total_sessions}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg Completion</CardTitle></CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${
                      completenessData.aggregate.avg_completion >= 80 ? 'text-green-600' :
                      completenessData.aggregate.avg_completion >= 50 ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {completenessData.aggregate.avg_completion}%
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Fully Complete</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-green-600">{completenessData.aggregate.sessions_complete}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Blocked</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-red-600">{completenessData.aggregate.sessions_blocked}</div></CardContent>
                </Card>
              </div>
            )}

            {completenessData?.aggregate?.most_common_missing?.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Most Commonly Missing Required Fields</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {completenessData.aggregate.most_common_missing.map((item: any) => (
                      <div key={item.field} className="flex items-center justify-between p-2 rounded border">
                        <span className="text-sm font-medium">{item.field}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-32 bg-muted rounded-full h-2">
                            <div
                              className="h-2 rounded-full bg-red-500"
                              style={{ width: `${Math.min((item.count / (completenessData.aggregate.total_sessions || 1)) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right">{item.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {completenessData?.breakdowns && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Auto vs Human Confirmation</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Auto-written</span>
                        <Badge variant="outline" className="bg-blue-50 text-blue-600">{completenessData.breakdowns.auto_vs_human.auto_written}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Human-confirmed</span>
                        <Badge variant="outline" className="bg-green-50 text-green-600">{completenessData.breakdowns.auto_vs_human.human_confirmed}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Rejected</span>
                        <Badge variant="outline" className="bg-red-50 text-red-600">{completenessData.breakdowns.auto_vs_human.rejected}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">By Source</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {(completenessData.breakdowns.by_source || []).map((s: any) => (
                        <div key={s.source} className="flex items-center justify-between text-sm">
                          <span>{s.source}</span>
                          <span className="text-muted-foreground">{s.field_count} fields</span>
                        </div>
                      ))}
                      {(!completenessData.breakdowns.by_source?.length) && (
                        <span className="text-muted-foreground text-xs">No source data yet.</span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">Completion by Rep</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(completenessData.breakdowns.by_rep || []).map((r: any) => (
                        <div key={r.rep_id} className="flex items-center justify-between">
                          <span className="text-sm font-mono">{r.rep_id}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{r.session_count} calls</span>
                            <Badge variant="outline" className={r.avg_completion >= 80 ? 'bg-green-50 text-green-600' : r.avg_completion >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}>
                              {r.avg_completion}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {(!completenessData.breakdowns.by_rep?.length) && (
                        <span className="text-muted-foreground text-xs">No rep data yet.</span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">By Interaction Type</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(completenessData.breakdowns.by_interaction_type || []).map((it: any) => (
                        <div key={it.interaction_type} className="flex items-center justify-between">
                          <span className="text-sm">{it.interaction_type}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{it.session_count} calls</span>
                            <Badge variant="outline">{it.avg_completion}%</Badge>
                          </div>
                        </div>
                      ))}
                      {(!completenessData.breakdowns.by_interaction_type?.length) && (
                        <span className="text-muted-foreground text-xs">No interaction type data yet.</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Session Completion History</CardTitle>
                  <Button variant="outline" size="sm" onClick={fetchCompleteness} disabled={loadingCompleteness}>
                    <RotateCcw className={`w-4 h-4 mr-1 ${loadingCompleteness ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr className="text-left font-medium text-muted-foreground">
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Completion</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Status</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Missing Required</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Unresolved</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Checked At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {loadingCompleteness ? (
                        <tr><td colSpan={6} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                      ) : !completenessData?.summaries?.length ? (
                        <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No completion data yet.</td></tr>
                      ) : (
                        completenessData.summaries.map((s: any) => (
                          <tr key={s.ctm_call_id} className="hover:bg-muted/20">
                            <td className="p-3 font-mono text-xs">{s.ctm_call_id}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <div className="w-20 bg-muted rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full ${
                                      s.completion_percent >= 80 ? 'bg-green-500' :
                                      s.completion_percent >= 50 ? 'bg-amber-500' : 'bg-red-500'
                                    }`}
                                    style={{ width: `${Math.min(s.completion_percent, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-medium">{Math.round(s.completion_percent)}%</span>
                              </div>
                            </td>
                            <td className="p-3">
                              {s.can_complete ? (
                                <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">OK</Badge>
                              ) : (
                                <Badge variant="destructive">Blocked</Badge>
                              )}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1">
                                {(s.required_missing || []).map((f: string) => (
                                  <Badge key={f} variant="secondary" className="text-[10px] px-1 py-0">{f}</Badge>
                                ))}
                                {(!s.required_missing || s.required_missing.length === 0) && (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-center">{s.unresolved_count || 0}</td>
                            <td className="p-3 text-muted-foreground text-xs">
                              {s.checked_at ? format(new Date(s.checked_at), 'MMM d, HH:mm') : '-'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="qa-dashboard">
          <div className="space-y-6">
            {qaSummary && (
              <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold">{qaSummary.total_scored}</div>
                    <div className="text-xs text-muted-foreground">Total Scored</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{qaSummary.passing}</div>
                    <div className="text-xs text-muted-foreground">Passing</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{qaSummary.failing}</div>
                    <div className="text-xs text-muted-foreground">Failing</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-amber-600">{qaSummary.needs_review}</div>
                    <div className="text-xs text-muted-foreground">Needs Review</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-red-500">{qaSummary.auto_fails}</div>
                    <div className="text-xs text-muted-foreground">Auto Fails</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold">{qaSummary.average_score}</div>
                    <div className="text-xs text-muted-foreground">Avg Score</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{qaSummary.pass_rate}%</div>
                    <div className="text-xs text-muted-foreground">Pass Rate</div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>QA Scores</CardTitle>
                  <div className="flex items-center gap-2">
                    {["all", "pass", "fail", "needs_review"].map(f => (
                      <Button
                        key={f}
                        size="sm"
                        variant={qaFilter === f ? "default" : "outline"}
                        onClick={() => { setQaFilter(f); fetchQaScores(f); }}
                      >
                        {f === "needs_review" ? "Review" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr className="text-left font-medium text-muted-foreground">
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Call ID</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Score</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Status</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Auto Fail</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Mode</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {loadingQaScores ? (
                        <tr><td colSpan={7} className="p-4 text-center"><Skeleton className="h-6 w-full"/></td></tr>
                      ) : !qaScores?.scores?.length ? (
                        <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No QA scores found.</td></tr>
                      ) : (
                        qaScores.scores.map((s: any) => (
                          <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                            <td className="p-3 font-mono text-xs">{s.ctm_call_id}</td>
                            <td className="p-3">
                              <span className={`font-bold ${s.call_score_total >= 70 ? "text-green-600" : s.call_score_total >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                {s.call_score_total?.toFixed(1)}
                              </span>
                              <span className="text-muted-foreground">/100</span>
                            </td>
                            <td className="p-3">
                              <Badge variant={s.qa_status === "pass" ? "default" : s.qa_status === "fail" ? "destructive" : "secondary"}>
                                {s.qa_status}
                              </Badge>
                            </td>
                            <td className="p-3 text-xs max-w-[200px] truncate">
                              {s.automatic_fail_reason ? (
                                <span className="text-red-600">{s.automatic_fail_reason}</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-[10px]">{s.reviewer_mode}</Badge>
                            </td>
                            <td className="p-3 text-muted-foreground text-xs">
                              {s.scored_at ? format(new Date(s.scored_at), 'MMM d, HH:mm') : '-'}
                            </td>
                            <td className="p-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setQaDetailCallId(s.ctm_call_id); fetchQaDetail(s.ctm_call_id); }}
                              >
                                <Eye className="w-3 h-3 mr-1" /> Detail
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {qaDetail && (
              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    QA Detail: {qaDetail.ctm_call_id}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingQaDetail ? (
                    <Skeleton className="h-32 w-full" />
                  ) : (
                    <>
                      {qaDetail.scores?.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Score Breakdown</div>
                          {qaDetail.scores.map((s: any) => (
                            <div key={s.id} className="space-y-2 mb-4">
                              <div className="flex items-center gap-3">
                                <span className={`text-lg font-bold ${s.call_score_total >= 70 ? "text-green-600" : "text-red-600"}`}>
                                  {s.call_score_total?.toFixed(1)}/100
                                </span>
                                <Badge variant={s.qa_status === "pass" ? "default" : s.qa_status === "fail" ? "destructive" : "secondary"}>
                                  {s.qa_status}
                                </Badge>
                                {s.automatic_fail_reason && (
                                  <Badge variant="destructive" className="text-[10px]">AUTO FAIL</Badge>
                                )}
                              </div>
                              {s.score_reasoning && (
                                <p className="text-sm text-muted-foreground">{s.score_reasoning}</p>
                              )}
                              {s.call_score_breakdown && (
                                <div className="grid gap-2 md:grid-cols-3">
                                  {Object.entries(s.call_score_breakdown).map(([cat, detail]: any) => (
                                    <div key={cat} className="border rounded p-2 text-sm">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium text-xs">{cat}</span>
                                        <span className={`font-mono text-xs ${detail.score >= detail.max * 0.7 ? "text-green-600" : "text-amber-600"}`}>
                                          {detail.score}/{detail.max}
                                        </span>
                                      </div>
                                      {detail.notes && (
                                        <p className="text-[11px] text-muted-foreground mt-1">{detail.notes}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {qaDetail.flow_states?.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Call Flow State</div>
                          {qaDetail.flow_states.map((f: any) => (
                            <div key={f.id} className="border rounded p-3 text-sm space-y-2">
                              <div className="flex items-center gap-3">
                                <span className="font-medium">Stage {f.current_stage}: {f.current_stage_name}</span>
                                <span className="text-xs text-muted-foreground">Adherence: {f.script_adherence_score?.toFixed(0)}%</span>
                              </div>
                              {f.completed_stages?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  <span className="text-xs text-muted-foreground mr-1">Completed:</span>
                                  {f.completed_stages.map((s: string) => (
                                    <Badge key={s} variant="default" className="text-[10px] px-1 py-0">{s}</Badge>
                                  ))}
                                </div>
                              )}
                              {f.skipped_stages?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  <span className="text-xs text-muted-foreground mr-1">Skipped:</span>
                                  {f.skipped_stages.map((s: string) => (
                                    <Badge key={s} variant="destructive" className="text-[10px] px-1 py-0">{s}</Badge>
                                  ))}
                                </div>
                              )}
                              {f.missing_info?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  <span className="text-xs text-muted-foreground mr-1">Missing:</span>
                                  {f.missing_info.map((m: string) => (
                                    <Badge key={m} variant="secondary" className="text-[10px] px-1 py-0">{m}</Badge>
                                  ))}
                                </div>
                              )}
                              {f.next_best_question && (
                                <div className="text-xs bg-muted/30 rounded p-2">
                                  <span className="font-medium">Next Q:</span> {f.next_best_question}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {qaDetail.objections?.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Objections Detected</div>
                          <div className="space-y-2">
                            {qaDetail.objections.map((o: any) => (
                              <div key={o.id} className="border rounded p-3 text-sm space-y-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant={o.resolved ? "default" : "secondary"}>{o.objection_category.replace(/_/g, " ")}</Badge>
                                  <span className="text-xs text-muted-foreground">Confidence: {(o.confidence * 100).toFixed(0)}%</span>
                                  {o.resolved && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                                </div>
                                {o.suggested_response && (
                                  <p className="text-xs text-muted-foreground">Rebuttal: {o.suggested_response}</p>
                                )}
                                {o.redirect_question && (
                                  <p className="text-xs text-muted-foreground">Redirect: {o.redirect_question}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {qaDetail.completeness && (
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Zoho Completeness</div>
                          <div className="border rounded p-3 text-sm space-y-2">
                            <div className="flex items-center gap-2">
                              {qaDetail.completeness.overall_pass ? (
                                <Badge variant="default">PASS</Badge>
                              ) : (
                                <Badge variant="destructive">FAIL</Badge>
                              )}
                              {qaDetail.completeness.missing_fields?.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {qaDetail.completeness.missing_fields.length} missing field(s)
                                </span>
                              )}
                            </div>
                            {qaDetail.completeness.missing_fields?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {qaDetail.completeness.missing_fields.map((f: string) => (
                                  <Badge key={f} variant="secondary" className="text-[10px] px-1 py-0">{f}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="kb">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Knowledge Base Governance</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => reindexKb.mutate(undefined, { onSuccess: () => refetchKb() })}
                  disabled={reindexKb.isPending}
                >
                  <RotateCcw className={`w-4 h-4 ${reindexKb.isPending ? 'animate-spin' : ''}`} />
                  {reindexKb.isPending ? 'Reindexing...' : 'Reindex All'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[700px]">
                <div className="space-y-4">
                  {loadingKb ? (
                    Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
                  ) : kbData?.documents?.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground border rounded-xl">No KB documents found.</div>
                  ) : (
                    kbData?.documents?.map((doc: any) => (
                      <div key={doc.id} className="border rounded-lg p-4 space-y-3 hover:bg-muted/10 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <button
                                className="p-0 bg-transparent border-none cursor-pointer"
                                onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)}
                              >
                                {expandedDocId === doc.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                              <span className="font-medium text-base">{doc.title}</span>
                              {(doc.priority || 0) > 0 && (
                                <Badge variant="default" className="text-[10px]">Priority: {doc.priority}</Badge>
                              )}
                              <Badge variant={doc.approved ? 'default' : 'outline'}>
                                {doc.approved ? 'Approved' : 'Pending'}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Source: {doc.source || 'N/A'} | Created: {doc.created_at ? format(new Date(doc.created_at), 'MMM d, yyyy') : '-'}
                              {doc.last_reviewed_at && ` | Last Reviewed: ${format(new Date(doc.last_reviewed_at), 'MMM d, yyyy')}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {doc.approved ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive"
                                onClick={() => unapproveDoc.mutate({ docId: doc.id }, { onSuccess: () => refetchKb() })}
                                disabled={unapproveDoc.isPending}
                              >
                                Unapprove
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => approveDoc.mutate({ docId: doc.id }, { onSuccess: () => refetchKb() })}
                                disabled={approveDoc.isPending}
                              >
                                Approve
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-muted-foreground">Chunks: <span className="font-mono font-medium text-foreground">{doc.chunk_count || 0}</span></span>
                          <span className="text-muted-foreground">Queries: <span className="font-mono font-medium text-foreground">{doc.query_count || 0}</span></span>
                          <span className="text-muted-foreground">Hits: <span className="font-mono font-medium text-foreground">{doc.hit_count || 0}</span></span>
                          {(doc.query_count || 0) > 0 && (
                            <span className="text-muted-foreground">Hit Rate: <span className="font-mono font-medium text-green-600">{((doc.hit_count || 0) / (doc.query_count || 1) * 100).toFixed(0)}%</span></span>
                          )}
                        </div>
                        {doc.tags && doc.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {doc.tags.map((tag: string) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                            ))}
                          </div>
                        )}
                        {expandedDocId === doc.id && (
                          <div className="mt-3 border-t pt-3 space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Section Index</div>
                            {loadingDetail ? (
                              <Skeleton className="h-16 w-full" />
                            ) : docDetail && docDetail.sections ? (
                              <div className="rounded-md border overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/50 border-b">
                                    <tr>
                                      <th className="p-2 text-left font-semibold">Section</th>
                                      <th className="p-2 text-left font-semibold">Chunks</th>
                                      <th className="p-2 text-left font-semibold">Tags</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {docDetail.sections.map((sec: any, idx: number) => (
                                      <tr key={idx} className="hover:bg-muted/20">
                                        <td className="p-2 font-medium">{sec.section_name}</td>
                                        <td className="p-2 font-mono">{sec.chunk_count}</td>
                                        <td className="p-2">
                                          <div className="flex flex-wrap gap-1">
                                            {sec.tags?.map((t: string) => (
                                              <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">{t}</Badge>
                                            ))}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">No section data available.</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qa-review">
          <div className="space-y-6">
            {qaTrends?.summary && (
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Total Graded</div>
                    <div className="text-2xl font-bold">{qaTrends.summary.total_graded}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Avg Score</div>
                    <div className="text-2xl font-bold">{qaTrends.summary.avg_score}%</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Pass Rate</div>
                    <div className={`text-2xl font-bold ${qaTrends.summary.pass_rate >= 80 ? "text-green-600" : qaTrends.summary.pass_rate >= 60 ? "text-amber-600" : "text-red-500"}`}>
                      {qaTrends.summary.pass_rate}%
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Auto-Fail Rate</div>
                    <div className={`text-2xl font-bold ${qaTrends.summary.auto_fail_rate <= 5 ? "text-green-600" : "text-red-500"}`}>
                      {qaTrends.summary.auto_fail_rate}%
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>QA Grades</CardTitle>
                    <Button variant="outline" size="sm" onClick={fetchQaGrades} disabled={loadingQaGrades}>
                      {loadingQaGrades ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {loadingQaGrades ? (
                        Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)
                      ) : !qaGrades?.grades?.length ? (
                        <div className="p-8 text-center text-muted-foreground border rounded-xl">No QA grades yet. Grades are created after each call ends.</div>
                      ) : (
                        qaGrades.grades.map((g: any) => (
                          <div key={g.id} className="border rounded-lg p-3 space-y-2 hover:bg-muted/10 cursor-pointer transition-colors" onClick={() => { setGradeDetailId(g.ctm_call_id); fetchGradeDetail(g.ctm_call_id); }}>
                            <div className="flex items-center justify-between">
                              <div className="font-mono text-xs">{g.ctm_call_id}</div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-bold ${g.overall_score >= 70 ? "text-green-600" : g.overall_score >= 50 ? "text-amber-600" : "text-red-500"}`}>
                                  {g.overall_score}%
                                </span>
                                {g.passed ? (
                                  <Badge variant="default" className="text-[10px]">Pass</Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-[10px]">Fail</Badge>
                                )}
                                {g.auto_fail && <Badge variant="destructive" className="text-[10px]">Auto-Fail</Badge>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {g.rep_id && <span>Rep: {g.rep_id}</span>}
                              {g.graded_at && <span>{format(new Date(g.graded_at), "MMM d, h:mm a")}</span>}
                              {g.needs_supervisor_review && <Badge variant="outline" className="text-[10px]">Needs Review</Badge>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader><CardTitle>Supervisor Review Queue</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-2">
                        {loadingReviews ? (
                          Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)
                        ) : !reviewQueue?.reviews?.length ? (
                          <div className="p-6 text-center text-muted-foreground border rounded-xl">No reviews pending</div>
                        ) : (
                          reviewQueue.reviews.map((r: any) => (
                            <div key={r.id} className="border rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="font-mono text-xs">{r.ctm_call_id}</div>
                                <Badge variant={r.status === "pending" ? "destructive" : "outline"} className="text-[10px]">{r.status}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Score: {r.original_score}% | Rep: {r.rep_id || "-"}
                                {r.auto_fail && " | Auto-fail"}
                              </div>
                              {r.review_reason && <div className="text-xs text-red-500">{r.review_reason}</div>}
                              {r.status === "pending" && (
                                <Button size="sm" variant="outline" className="text-xs" onClick={() => handleCompleteReview(r.id, "Reviewed and acknowledged")}>
                                  Complete Review
                                </Button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {gradeDetail && (
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Grade Detail: {gradeDetailId}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {gradeDetail.category_scores && Object.entries(gradeDetail.category_scores).map(([cat, score]: any) => (
                            <div key={cat} className="flex items-center justify-between p-1.5 rounded border">
                              <span className="text-xs text-muted-foreground capitalize">{cat.replace(/_/g, " ")}</span>
                              <span className={`text-xs font-bold ${score >= 70 ? "text-green-600" : score >= 50 ? "text-amber-600" : "text-red-500"}`}>{score}%</span>
                            </div>
                          ))}
                        </div>
                        {gradeDetail.coaching_suggestions?.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Coaching Suggestions</div>
                            <div className="space-y-1">
                              {gradeDetail.coaching_suggestions.map((s: string, i: number) => (
                                <div key={i} className="text-xs bg-amber-50 dark:bg-amber-950/30 p-2 rounded flex items-start gap-2">
                                  <Lightbulb className="w-3 h-3 mt-0.5 text-amber-500 shrink-0" />
                                  <span>{s}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {gradeDetail.missed_steps?.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Missed Steps</div>
                            <div className="flex flex-wrap gap-1">
                              {gradeDetail.missed_steps.map((s: string) => (
                                <Badge key={s} variant="outline" className="text-[10px]">{s.replace(/_/g, " ")}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="kb-drafts">
          <div className="space-y-6">
            {kbAnalytics && (
              <div className="grid gap-4 md:grid-cols-5">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Pending</div>
                    <div className="text-2xl font-bold">{kbAnalytics.draft_volume?.pending || 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Approved</div>
                    <div className="text-2xl font-bold text-green-600">{kbAnalytics.draft_volume?.approved || 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Rejected</div>
                    <div className="text-2xl font-bold text-red-500">{kbAnalytics.draft_volume?.rejected || 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Merged</div>
                    <div className="text-2xl font-bold">{kbAnalytics.draft_volume?.merged || 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Approval Rate</div>
                    <div className="text-2xl font-bold">{kbAnalytics.approval_rate || 0}%</div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>KB Draft Queue</CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleRunDiscovery} disabled={discoveryRunning}>
                      {discoveryRunning ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Lightbulb className="w-4 h-4 mr-1" />}
                      {discoveryRunning ? "Scanning..." : "Run Discovery"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchKbDrafts} disabled={loadingDrafts}>
                      <RotateCcw className={`w-4 h-4 ${loadingDrafts ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px]">
                  <div className="space-y-3">
                    {loadingDrafts ? (
                      Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
                    ) : !kbDrafts?.drafts?.length ? (
                      <div className="p-8 text-center text-muted-foreground border rounded-xl">
                        No draft articles pending. Click "Run Discovery" to scan transcripts for knowledge gaps.
                      </div>
                    ) : (
                      kbDrafts.drafts.map((d: any) => (
                        <div key={d.id} className="border rounded-lg p-4 space-y-3 hover:bg-muted/10 transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1 flex-1">
                              <div className="font-medium">{d.title}</div>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px]">{d.draft_type?.replace(/_/g, " ")}</Badge>
                                <span className="text-xs text-muted-foreground">
                                  {d.source_transcript_count} transcript{d.source_transcript_count !== 1 ? "s" : ""}
                                </span>
                                {d.similar_existing_count > 0 && (
                                  <span className="text-xs text-amber-600">{d.similar_existing_count} similar KB article{d.similar_existing_count !== 1 ? "s" : ""}</span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  Confidence: {(d.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                            <Badge variant={d.status === "draft" ? "secondary" : d.status === "approved" ? "default" : "outline"} className="text-[10px]">{d.status}</Badge>
                          </div>
                          {d.problem_statement && (
                            <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded">{d.problem_statement.slice(0, 200)}...</div>
                          )}
                          {d.recommended_answer && (
                            <div className="text-sm bg-blue-50 dark:bg-blue-950/20 p-2 rounded border-l-2 border-blue-400">{d.recommended_answer.slice(0, 300)}...</div>
                          )}
                          {d.status === "draft" && (
                            <div className="flex gap-2">
                              <Button size="sm" variant="default" className="text-xs" onClick={() => handleApproveDraft(d.id)}>
                                <ThumbsUp className="w-3 h-3 mr-1" /> Approve & Publish
                              </Button>
                              <Button size="sm" variant="outline" className="text-xs text-red-500 hover:text-red-600" onClick={() => handleRejectDraft(d.id)}>
                                <ThumbsDown className="w-3 h-3 mr-1" /> Reject
                              </Button>
                            </div>
                          )}
                          {d.created_at && <div className="text-[10px] text-muted-foreground">{format(new Date(d.created_at), "MMM d, h:mm a")}</div>}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {kbAnalytics?.top_recurring_gaps?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Top Recurring Knowledge Gaps</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {kbAnalytics.top_recurring_gaps.map((g: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 border rounded text-sm">
                        <span className="capitalize text-muted-foreground">{g.topic_type?.replace(/_/g, " ")}</span>
                        <span className="font-bold">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="coaching">
          <div className="space-y-6">
            {qaTrends?.summary && (
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Team Pass Rate</div>
                    <div className={`text-2xl font-bold ${qaTrends.summary.pass_rate >= 80 ? "text-green-600" : "text-amber-600"}`}>
                      {qaTrends.summary.pass_rate}%
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Team Avg Score</div>
                    <div className="text-2xl font-bold">{qaTrends.summary.avg_score}%</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-muted-foreground">Auto-Fail Rate</div>
                    <div className={`text-2xl font-bold ${qaTrends.summary.auto_fail_rate <= 5 ? "text-green-600" : "text-red-500"}`}>
                      {qaTrends.summary.auto_fail_rate}%
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {qaTrends?.summary?.common_missed_steps?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Most Commonly Missed Call Flow Steps</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {qaTrends.summary.common_missed_steps.map((s: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 border rounded text-sm">
                        <span className="capitalize text-muted-foreground">{s.item?.replace(/_/g, " ")}</span>
                        <span className="font-bold">{s.count}x</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle>Rep Coaching Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Enter rep ID..."
                    value={selectedRepForCoaching}
                    onChange={(e) => setSelectedRepForCoaching(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button size="sm" onClick={() => fetchRepCoaching(selectedRepForCoaching)} disabled={!selectedRepForCoaching || loadingCoaching}>
                    {loadingCoaching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load"}
                  </Button>
                </div>

                {repCoaching && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 border rounded text-center">
                        <div className="text-xs text-muted-foreground">Total Graded</div>
                        <div className="text-xl font-bold">{repCoaching.total_graded}</div>
                      </div>
                      <div className="p-3 border rounded text-center">
                        <div className="text-xs text-muted-foreground">Avg Score</div>
                        <div className={`text-xl font-bold ${repCoaching.avg_overall_score >= 70 ? "text-green-600" : "text-amber-600"}`}>{repCoaching.avg_overall_score}%</div>
                      </div>
                      <div className="p-3 border rounded text-center">
                        <div className="text-xs text-muted-foreground">Pass Rate</div>
                        <div className="text-xl font-bold">{repCoaching.pass_rate}%</div>
                      </div>
                      <div className="p-3 border rounded text-center">
                        <div className="text-xs text-muted-foreground">Auto-Fail Count</div>
                        <div className={`text-xl font-bold ${repCoaching.auto_fail_count === 0 ? "text-green-600" : "text-red-500"}`}>{repCoaching.auto_fail_count}</div>
                      </div>
                    </div>

                    {repCoaching.category_averages && (
                      <div>
                        <div className="text-sm font-semibold mb-2">Category Averages</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {Object.entries(repCoaching.category_averages).sort(([, a]: any, [, b]: any) => a - b).map(([cat, score]: any) => (
                            <div key={cat} className="flex items-center justify-between p-2 border rounded text-sm">
                              <span className="text-xs text-muted-foreground capitalize">{cat.replace(/_/g, " ")}</span>
                              <span className={`text-xs font-bold ${score >= 70 ? "text-green-600" : score >= 50 ? "text-amber-600" : "text-red-500"}`}>{score}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {repCoaching.common_missed_steps?.length > 0 && (
                      <div>
                        <div className="text-sm font-semibold mb-2">Common Missed Steps</div>
                        <div className="flex flex-wrap gap-1">
                          {repCoaching.common_missed_steps.map((s: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs">{s.item?.replace(/_/g, " ")} ({s.count}x)</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {repCoaching.grades?.length > 0 && (
                      <div>
                        <div className="text-sm font-semibold mb-2">Recent Grades</div>
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-1">
                            {repCoaching.grades.map((g: any) => (
                              <div key={g.id} className="flex items-center justify-between p-2 border rounded text-sm">
                                <span className="font-mono text-xs">{g.ctm_call_id}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`font-bold ${g.overall_score >= 70 ? "text-green-600" : "text-red-500"}`}>{g.overall_score}%</span>
                                  {g.passed ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <XCircle className="w-3 h-3 text-red-500" />}
                                  {g.auto_fail && <Badge variant="destructive" className="text-[10px]">AF</Badge>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TranscriptReplayView({ callId }: { callId: string }) {
  const { data: txData, isLoading } = useGetFullTranscript(callId);
  const replayCall = useReplayCall();
  const [replayResult, setReplayResult] = useState<any>(null);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!txData) {
    return <div className="text-center py-8 text-muted-foreground">No transcript found for {callId}</div>;
  }

  const handleReplay = () => {
    replayCall.mutate({ ctmCallId: callId }, {
      onSuccess: (data: any) => setReplayResult(data),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="font-medium">{txData.session?.caller_phone || "Unknown"}</div>
            <div className="text-xs text-muted-foreground">
              Rep: {txData.session?.rep_id || "Unassigned"} | Status: {txData.session?.status} | {txData.chunk_count} chunks
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleReplay} disabled={replayCall.isPending}>
          {replayCall.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
          Re-extract & Coach
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Transcript</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-3 pr-4">
                {txData.transcript?.map((chunk: any, i: number) => {
                  const isRep = chunk.speaker?.toLowerCase().includes("rep");
                  return (
                    <div key={i} className={`flex flex-col ${isRep ? "items-end" : "items-start"}`}>
                      <span className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wider font-semibold px-1">
                        {chunk.speaker || "Unknown"}
                      </span>
                      <div className={`px-3 py-2 rounded-2xl max-w-[85%] text-sm ${isRep ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
                        {chunk.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {txData.fields && txData.fields.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Extracted Fields</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {txData.fields.map((f: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 border rounded text-sm">
                      <div>
                        <span className="font-medium text-xs uppercase tracking-wider text-muted-foreground">{f.field_name}</span>
                        <div className="font-medium">{f.field_value || "-"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${f.confidence >= 0.92 ? "text-green-600" : f.confidence >= 0.7 ? "text-amber-600" : "text-red-500"}`}>
                          {(f.confidence * 100).toFixed(0)}%
                        </span>
                        <Badge variant={f.status === "written" ? "default" : f.status === "confirmed" ? "default" : "outline"} className="text-[10px]">
                          {f.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {txData.coaching_history && txData.coaching_history.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Coaching History</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-3 pr-4">
                    {txData.coaching_history.map((c: any) => (
                      <div key={c.id} className="border rounded-lg p-3 text-sm space-y-1">
                        {c.intent && <div className="text-xs text-muted-foreground">Intent: {c.intent}</div>}
                        {c.suggested_response && <div className="font-medium">"{c.suggested_response}"</div>}
                        {c.next_best_question && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            Next Q: "{c.next_best_question}"
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {c.confidence != null && <span>Confidence: {(c.confidence * 100).toFixed(0)}%</span>}
                          {c.escalation_flag && <Badge variant="destructive" className="text-[10px]">Escalation</Badge>}
                          {c.created_at && <span>{format(new Date(c.created_at), "HH:mm:ss")}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {replayResult && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Replay Results</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {replayResult.extraction && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Re-extraction</div>
                    <div className="text-sm bg-muted/30 rounded p-2">
                      {replayResult.extraction.intent && <div>Intent: {replayResult.extraction.intent}</div>}
                      {replayResult.extraction.fields && Object.entries(replayResult.extraction.fields).map(([k, v]: any) => (
                        <div key={k} className="text-xs">{k}: {typeof v === "object" ? v?.value : v}</div>
                      ))}
                    </div>
                  </div>
                )}
                {replayResult.coaching && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Coaching</div>
                    <div className="text-sm bg-muted/30 rounded p-2">
                      {replayResult.coaching.suggested_response && <div>"{replayResult.coaching.suggested_response}"</div>}
                      {replayResult.coaching.next_best_question && (
                        <div className="text-xs text-muted-foreground mt-1">Next: "{replayResult.coaching.next_best_question}"</div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
