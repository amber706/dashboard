import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useParams, Link } from "wouter";
import {
  useGetLiveCall,
  useApproveField,
  useReplayCall,
  useQueryKb
} from "@workspace/api-client-react";
import {
  Phone, CheckCircle2, ArrowRight, MessageSquare, Loader2,
  Sparkles, AlertTriangle, ShieldAlert, RotateCcw, Search, XCircle, Clock,
  ClipboardCheck, ChevronDown, ChevronUp, Copy, Lock, Info
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkflow } from "@/lib/workflow-context";
import { StatusIndicator, EscalationBanner } from "@/components/status-indicator";
import { ConfidenceBadge, SuggestionFeedback, DuplicateWarning } from "@/components/rep-feedback";
import { LeadScoreCard } from "@/components/lead-scoring";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";

function WrapUpFieldInput({ callId, fieldName }: { callId: string; fieldName: string }) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!value.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch(`/session/${callId}/confirm-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_name: fieldName, confirmed_value: value.trim() }),
      });
      setSubmitted(true);
    } catch (e) {
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;

  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-6 w-24 text-[10px] px-1.5 py-0"
        placeholder="Enter value..."
        value={value}
        onChange={(e: any) => setValue(e.target.value)}
        onKeyDown={(e: any) => e.key === "Enter" && handleSubmit()}
      />
      <Button
        size="sm"
        className="h-6 px-2 py-0 text-[10px]"
        onClick={handleSubmit}
        disabled={submitting || !value.trim()}
      >
        {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Set"}
      </Button>
    </div>
  );
}

export default function LiveCall() {
  const params = useParams();
  const callId = params.id || "DEMO-CALL-001";
  const { setMode, setCallId } = useWorkflow();

  useEffect(() => {
    setMode("live-call");
    setCallId(callId);
  }, [callId, setMode, setCallId]);

  const { data: liveState, isLoading } = useGetLiveCall(callId, {
    query: { refetchInterval: 3000, queryKey: [`/api/dashboard/live-call/${callId}`] }
  });
  const approveField = useApproveField();
  const replayCall = useReplayCall();
  const queryKb = useQueryKb();

  const [searchQuery, setSearchQuery] = useState("");
  const [completionExpanded, setCompletionExpanded] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveState?.transcript]);

  const handleApprove = (fieldName: string, value: string | undefined | null) => {
    approveField.mutate({
      data: { ctm_call_id: callId, field_name: fieldName, confirmed_value: value }
    });
  };

  const [rejectingField, setRejectingField] = useState<string | null>(null);
  const handleReject = async (fieldName: string) => {
    setRejectingField(fieldName);
    try {
      await apiFetch(`/session/${callId}/reject-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_name: fieldName }),
      });
    } catch (e) {
    } finally {
      setRejectingField(null);
    }
  };

  const handleReplay = () => {
    replayCall.mutate({ ctmCallId: callId });
  };

  const handleSearchKb = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    queryKb.mutate({ data: { query: searchQuery } });
  };

  const handleCopySuggestion = () => {
    const text = (liveState as any)?.coaching?.suggested_response;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useKeyboardShortcuts([
    { key: "c", ctrl: true, shift: true, description: "Copy suggested response", category: "Live Call", action: handleCopySuggestion },
    { key: "r", ctrl: true, shift: true, description: "Replay extraction", category: "Live Call", action: handleReplay },
  ]);

  if (isLoading && !liveState) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Connecting to call...</p>
        </div>
      </div>
    );
  }

  if (!liveState) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4">
        <Phone className="w-12 h-12 text-muted-foreground/30" />
        <h2 className="text-lg font-semibold">Session Not Found</h2>
        <p className="text-sm text-muted-foreground">Unable to load data for {callId}</p>
        <Link href="/">
          <Button variant="outline" size="sm">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const { session, transcript, fields, coaching, buffer_state, completion, completion_unresolved } = liveState as any;
  const rejectedFields = fields.rejected || [];

  const writtenCount = fields.written?.length || 0;
  const pendingCount = fields.pending?.length || 0;
  const rejectedCount = rejectedFields.length;

  const callDuration = session.started_at ? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60000) : 0;

  const mockLeadScore = {
    total_score: 65,
    quality_tier: "warm" as const,
    conversion_probability: 0.42,
    is_hot: false,
    score_drivers: ["Program interest", "Timely follow-up"],
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-muted/10">
      {coaching?.escalation_flag && (
        <EscalationBanner
          reason="High emotional distress or safety concern detected."
          onAcknowledge={() => {}}
        />
      )}

      <header className="bg-background border-b px-6 py-3 flex items-center justify-between shrink-0" role="banner">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${session.status === 'in-progress' || session.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
          <h1 className="font-semibold text-base tracking-tight">{session.caller_phone || "Unknown Caller"}</h1>
          <Badge variant="outline" className="font-mono text-[10px] uppercase">{callId}</Badge>
          <StatusIndicator state={session.status === 'active' || session.status === 'in-progress' ? "listening" : "call-ended"} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Button variant="outline" size="sm" onClick={handleReplay} disabled={replayCall.isPending} className="text-xs h-7 gap-1.5">
            <RotateCcw className="w-3 h-3" />
            Replay
          </Button>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{session.rep_id || "Unassigned"}</span>
            <span className="mx-1.5">&bull;</span>
            <span className="font-mono">{callDuration}m</span>
          </div>
          <Link href={`/wrap-up/${callId}`}>
            <Button size="sm" variant="secondary" className="text-xs h-7 gap-1.5">
              <ClipboardCheck className="w-3 h-3" />
              Wrap Up
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-4 p-4">
        <div className="w-full lg:w-7/12 flex flex-col gap-4 overflow-hidden">
          <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-xl border border-indigo-500/20 shadow-md p-5 shrink-0 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <Sparkles className="w-28 h-28" />
            </div>

            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-indigo-300">AI Coach</h2>
                </div>
                {coaching?.suggested_response && coaching.suggested_response !== "No approved answer found." && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-white/50 hover:text-white hover:bg-white/10 gap-1" onClick={handleCopySuggestion}>
                    <Copy className="w-3 h-3" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                )}
              </div>

              {coaching?.suggested_response === "No approved answer found." ? (
                <div className="space-y-3">
                  <div className="bg-amber-500/20 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-amber-200">No Approved Answer</div>
                      <div className="text-xs text-amber-100/60 mt-0.5">Consult a supervisor or approved materials.</div>
                    </div>
                  </div>
                </div>
              ) : coaching?.suggested_response ? (
                <div className="space-y-3">
                  <p className="text-base font-medium leading-relaxed">"{coaching.suggested_response}"</p>

                  {coaching.next_best_question && (
                    <div className="flex items-start gap-2 bg-black/20 rounded-lg p-3 border border-white/5">
                      <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-indigo-400 shrink-0" />
                      <div>
                        <span className="text-[10px] text-indigo-300 font-semibold uppercase tracking-wider">Next Best Question</span>
                        <p className="text-sm mt-0.5">"{coaching.next_best_question}"</p>
                      </div>
                    </div>
                  )}

                  {coaching.source_titles?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center text-[10px] text-white/40">
                      <span className="font-semibold uppercase tracking-wider">Sources:</span>
                      {coaching.source_titles.map((title: string, i: number) => (
                        <span key={i} className="bg-white/10 px-2 py-0.5 rounded text-white/70">{title}</span>
                      ))}
                      {coaching.confidence != null && (
                        <ConfidenceBadge confidence={coaching.confidence} showLabel={false} />
                      )}
                    </div>
                  )}

                  <SuggestionFeedback suggestion={coaching.suggested_response} />
                </div>
              ) : (
                <p className="text-sm text-indigo-200/50">Analyzing conversation...</p>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-background rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between shrink-0">
              <h2 className="font-semibold text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Data Extraction
              </h2>
              <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" />{writtenCount}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500" />{pendingCount}</span>
                {rejectedCount > 0 && <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" />{rejectedCount}</span>}
              </div>
            </div>

            <ScrollArea className="flex-1 p-3">
              <div className="space-y-4">
                {fields.pending?.length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-2 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> Requires Confirmation
                    </h3>
                    <div className="space-y-1.5">
                      {fields.pending.map((field: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border bg-amber-50/30 border-amber-200/40 hover:bg-amber-50/50 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{field.field_name}</span>
                              <ConfidenceBadge confidence={field.confidence} showLabel={false} />
                            </div>
                            <div className="font-medium text-sm mt-0.5">{field.field_value || <span className="text-muted-foreground">Empty</span>}</div>
                          </div>
                          <div className="flex gap-1 ml-2 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleReject(field.field_name)}
                              disabled={rejectingField === field.field_name}
                              title="Reject (Esc)"
                              aria-label={`Reject ${field.field_name}`}
                            >
                              {rejectingField === field.field_name ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-[10px] bg-amber-500 hover:bg-amber-600 text-white shadow-none"
                              onClick={() => handleApprove(field.field_name, field.field_value)}
                              disabled={approveField.isPending}
                              title="Confirm (Enter)"
                              aria-label={`Confirm ${field.field_name}`}
                            >
                              Confirm
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {fields.written?.length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-2 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" /> Saved to Zoho
                    </h3>
                    <div className="grid gap-1.5 grid-cols-1 xl:grid-cols-2">
                      {fields.written.map((field: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg border bg-muted/10 hover:bg-muted/20 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{field.field_name}</div>
                              <div className="font-medium text-sm mt-0.5 truncate">{field.field_value}</div>
                            </div>
                            {field.status === "confirmed" ? (
                              <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-600 border-blue-200 shrink-0">Confirmed</Badge>
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-1" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rejectedFields.length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-2 flex items-center gap-1.5">
                      <XCircle className="w-3 h-3" /> Rejected
                    </h3>
                    <div className="grid gap-1.5 grid-cols-1 xl:grid-cols-2">
                      {rejectedFields.map((field: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg border bg-red-50/20 border-red-200/30">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{field.field_name}</div>
                              <div className="font-medium text-sm mt-0.5 line-through text-muted-foreground">{field.field_value || "—"}</div>
                            </div>
                            <WrapUpFieldInput callId={callId} fieldName={field.field_name} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(!fields.pending?.length && !fields.written?.length && !rejectedFields.length) && (
                  <div className="text-center py-10 text-sm text-muted-foreground/60 border border-dashed rounded-lg">
                    <Clock className="w-6 h-6 mx-auto mb-2 text-muted-foreground/30" />
                    Listening for key information...
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {completion && (
            <div className="flex flex-col bg-background rounded-xl border shadow-sm overflow-hidden shrink-0">
              <button
                className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between shrink-0 w-full text-left hover:bg-muted/40 transition-colors"
                onClick={() => setCompletionExpanded(!completionExpanded)}
                aria-expanded={completionExpanded}
              >
                <h2 className="font-semibold text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Lead Completion
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${completion.completion_percent >= 80 ? 'text-green-600' : completion.completion_percent >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {Math.round(completion.completion_percent)}%
                  </span>
                  {completionExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
              </button>

              <div className="p-3">
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" />{completion.completed} done</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500" />{completion.pending_confirmation} pending</span>
                  <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" />{completion.missing} missing</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${completion.completion_percent >= 80 ? 'bg-green-500' : completion.completion_percent >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(completion.completion_percent, 100)}%` }}
                  />
                </div>

                {completionExpanded && completion_unresolved?.length > 0 && (
                  <ScrollArea className="max-h-48 mt-3 rounded border p-2 bg-muted/10">
                    <div className="space-y-1">
                      {completion_unresolved
                        .sort((a: any, b: any) => (b.required ? 1 : 0) - (a.required ? 1 : 0))
                        .map((field: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/30 gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${field.required ? 'bg-red-400' : 'bg-amber-400'}`} />
                              <span className="truncate">{field.field_name}</span>
                            </div>
                            <WrapUpFieldInput callId={callId} fieldName={field.field_name} />
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-full lg:w-5/12 flex flex-col gap-4 overflow-hidden">
          <div className="flex flex-col bg-background rounded-xl border shadow-sm overflow-hidden" style={{ minHeight: 0, flex: transcriptExpanded ? "1 1 auto" : "0 0 auto" }}>
            <button
              className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between shrink-0 w-full text-left hover:bg-muted/40 transition-colors"
              onClick={() => setTranscriptExpanded(!transcriptExpanded)}
              aria-expanded={transcriptExpanded}
            >
              <h2 className="font-semibold text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <MessageSquare className="w-3.5 h-3.5" />
                Transcript
              </h2>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[9px] px-1.5">{transcript.length} msgs</Badge>
                {transcriptExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            </button>
            {transcriptExpanded && (
              <ScrollArea className="flex-1 p-3">
                <div className="space-y-3 pb-4">
                  {transcript.length === 0 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground/50">Waiting for speech...</div>
                  ) : (
                    transcript.map((chunk: any, i: number) => {
                      const isRep = chunk.speaker?.toLowerCase().includes("rep");
                      return (
                        <div key={i} className={`flex flex-col ${isRep ? "items-end" : "items-start"}`}>
                          <span className="text-[9px] text-muted-foreground/60 mb-0.5 uppercase tracking-wider font-medium px-1">
                            {chunk.speaker || "Unknown"}
                          </span>
                          <div className={`px-3 py-2 rounded-2xl max-w-[88%] text-sm leading-relaxed ${isRep ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
                            {chunk.text}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </ScrollArea>
            )}
          </div>

          <LeadScoreCard data={mockLeadScore} compact />

          <Card className="shrink-0">
            <CardHeader className="pb-2 p-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                KB Search
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <form onSubmit={handleSearchKb} className="flex gap-1.5">
                <Input
                  placeholder="Search knowledge base..."
                  value={searchQuery}
                  onChange={(e: any) => setSearchQuery(e.target.value)}
                  className="h-7 text-xs"
                  aria-label="Search knowledge base"
                />
                <Button type="submit" size="sm" className="h-7 px-2.5" disabled={queryKb.isPending || !searchQuery.trim()}>
                  {queryKb.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                </Button>
              </form>
              {queryKb.data && (
                <div className="mt-2 text-xs text-muted-foreground bg-muted/20 rounded-lg p-2.5 border">
                  {(queryKb.data as any)?.answer || "No results found."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
