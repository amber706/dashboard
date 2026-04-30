import { useParams } from "wouter";
import { useGetLiveCall } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, EmptyState } from "@/components/section-header";
import { LeadScoreCard, TierBadge } from "@/components/lead-scoring";
import { StatusIndicator } from "@/components/status-indicator";
import {
  Phone, User, FileText, AlertTriangle, Clock, MessageSquare,
  History, Flame, ArrowRight, Sparkles, Loader2, Copy
} from "lucide-react";
import { useWorkflow } from "@/lib/workflow-context";
import { useEffect, useState } from "react";
import { Link } from "wouter";

export default function PreCall() {
  const params = useParams();
  const callId = params.id || "DEMO-CALL-001";
  const { setMode, setCallId } = useWorkflow();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMode("pre-call");
    setCallId(callId);
  }, [callId, setMode, setCallId]);

  const { data: liveState, isLoading, isError } = useGetLiveCall(callId, {
    query: { refetchInterval: false, queryKey: [`/api/dashboard/live-call/${callId}`], retry: false },
  });

  if (isLoading) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-4xl mx-auto space-y-6 md:space-y-8">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (isError || !liveState) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-4xl mx-auto space-y-6 md:space-y-8">
        <PageHeader
          title="Pre-Call Preparation"
          subtitle="No active call session found"
        />
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Phone className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <div>
              <h3 className="text-lg font-semibold">No Active Call Session</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Pre-call preparation requires an active or incoming call session.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Call ID: <span className="font-mono">{callId}</span> — session not found in the system.
              </p>
            </div>
            <div className="flex justify-center gap-3 pt-2">
              <Link href="/">
                <Button variant="outline" size="sm">Back to Home</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const session = (liveState as any)?.session;
  const coaching = (liveState as any)?.coaching;
  const completion = (liveState as any)?.completion;

  const mockLeadData = {
    total_score: 65,
    quality_tier: "warm" as const,
    conversion_probability: 0.42,
    is_hot: false,
    score_drivers: ["Returning inquiry", "Program interest match", "Timely follow-up"],
  };

  const mockCallbackHistory = [
    { date: "2 days ago", outcome: "Left voicemail", rep: "Mike S." },
    { date: "5 days ago", outcome: "Initial inquiry — web form", rep: "System" },
  ];

  const suggestedOpening = coaching?.suggested_response ||
    "Welcome back! I see you recently inquired about our nursing program. I'd love to help answer any remaining questions.";

  const handleCopy = () => {
    navigator.clipboard.writeText(suggestedOpening);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-4xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Pre-Call Preparation"
        subtitle={`Getting ready for ${session?.caller_phone || "incoming call"}`}
        actions={
          <Link href={`/live/${callId}`}>
            <Button className="gap-2">
              <Phone className="w-4 h-4" />
              Start Call
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        }
      />

      <div className="flex items-center gap-3">
        <StatusIndicator state="connected" />
        <Badge variant="outline" className="font-mono text-xs">{callId}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4" />
              Caller Identity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Phone</span>
              <span className="text-sm font-medium">{session?.caller_phone || "Unknown"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Rep</span>
              <span className="text-sm font-medium">{session?.rep_id || "Unassigned"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Lead Match</span>
              <Badge variant="secondary" className="text-xs">
                {session?.zoho_lead_id ? "Matched" : "New Lead"}
              </Badge>
            </div>
            {session?.zoho_lead_id && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Zoho ID</span>
                <span className="text-xs font-mono text-muted-foreground">{session.zoho_lead_id}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <LeadScoreCard data={mockLeadData} compact />
      </div>

      <Card className="bg-gradient-to-r from-primary/5 to-transparent border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Suggested Opening
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleCopy}>
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <blockquote className="text-sm leading-relaxed italic border-l-2 border-primary/30 pl-4 text-foreground/80">
            "{suggestedOpening}"
          </blockquote>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" />
              Callback History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mockCallbackHistory.length === 0 ? (
              <EmptyState title="No previous contact" description="This is a new lead." />
            ) : (
              <div className="space-y-3">
                {mockCallbackHistory.map((entry, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{entry.outcome}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3" /> {entry.date}
                        <span className="mx-0.5">&bull;</span>
                        {entry.rep}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Previous Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground leading-relaxed">
              {session?.zoho_lead_id
                ? "Previous interaction notes will appear here once connected to Zoho CRM."
                : "No previous notes available for this lead."}
            </div>
          </CardContent>
        </Card>
      </div>

      {completion && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Caution Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completion.missing > 3 && (
                <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs text-amber-700">{completion.missing} fields still missing — focus on gathering key info</span>
                </div>
              )}
              <div className="flex items-center gap-2 p-2 bg-muted/30 border rounded-lg">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">No urgent flags detected</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
