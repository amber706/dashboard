import { useParams } from "wouter";
import { useGetLiveCall } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { CallScoreCard } from "@/components/call-scoring";
import { LeadScoreCard } from "@/components/lead-scoring";
import { TaskManagementPanel } from "@/components/task-management";
import { SyncStatusRow } from "@/components/status-indicator";
import { ConfidenceBadge } from "@/components/rep-feedback";
import {
  CheckCircle2, FileText, Phone, Clock, ArrowRight,
  ClipboardCheck, Sparkles, Loader2, Send, RotateCcw
} from "lucide-react";
import { useWorkflow } from "@/lib/workflow-context";
import { useEffect, useState } from "react";
import { Link } from "wouter";

export default function WrapUp() {
  const params = useParams();
  const callId = params.id || "DEMO-CALL-001";
  const { setMode, setCallId } = useWorkflow();
  const [finalized, setFinalized] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState("Interested - Follow Up");

  useEffect(() => {
    setMode("wrap-up");
    setCallId(callId);
  }, [callId, setMode, setCallId]);

  const { data: liveState, isLoading, isError } = useGetLiveCall(callId, {
    query: { refetchInterval: false, queryKey: [`/api/dashboard/live-call/${callId}`], retry: false },
  });

  if (isLoading) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-6 md:space-y-8">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      </div>
    );
  }

  if (isError || !liveState) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-6 md:space-y-8">
        <PageHeader
          title="Call Wrap-Up"
          subtitle="No call session found"
        />
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Phone className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <div>
              <h3 className="text-lg font-semibold">No Call Session Found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Wrap-up requires a completed or active call session to display results.
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
  const fields = (liveState as any)?.fields;
  const coaching = (liveState as any)?.coaching;
  const completion = (liveState as any)?.completion;

  const mockCallScore = {
    total_score: 78,
    confidence: 0.85,
    categories: {
      qualification_completeness: 8,
      rapport_empathy: 7,
      objection_handling: 6,
      urgency_handling: 8,
      next_step_clarity: 9,
      script_adherence: 7,
      compliance: 9,
      booking_transfer: 8,
      overall_quality: 8,
    },
    quality_signals: ["Empathetic tone", "Clear next steps", "Good pacing"],
    compliance_flags: [],
    coaching_takeaways: {
      well: ["Established rapport quickly", "Provided clear program details"],
      improve: ["Ask more discovery questions early", "Confirm financial aid eligibility sooner"],
    },
    trend: { direction: "up" as const, delta: 5 },
  };

  const mockLeadScore = {
    total_score: 72,
    quality_tier: "warm" as const,
    conversion_probability: 0.55,
    is_hot: false,
    score_drivers: ["Expressed urgency", "Program fit confirmed", "Financial aid eligible"],
    follow_up_sla_deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
  };

  const mockTasks = [
    { id: "t1", title: "Send program brochure via email", due_time: new Date(Date.now() + 2 * 3600000).toISOString(), priority: "high" as const, owner: session?.rep_id || "Jane D.", reason: "Caller requested materials", status: "pending" as const, auto_created: true },
    { id: "t2", title: "Schedule campus tour", due_time: new Date(Date.now() + 24 * 3600000).toISOString(), priority: "medium" as const, owner: session?.rep_id || "Jane D.", reason: "Expressed interest in visiting", status: "pending" as const, auto_created: true },
    { id: "t3", title: "Follow-up call in 48 hours", due_time: new Date(Date.now() + 48 * 3600000).toISOString(), priority: "medium" as const, owner: session?.rep_id || "Jane D.", reason: "Lead needs time to discuss with family", status: "pending" as const, auto_created: true },
  ];

  const dispositions = ["Interested - Follow Up", "Application Started", "Not Interested", "Callback Requested", "Wrong Number", "No Answer"];

  const writtenFields = fields?.written || [];
  const pendingFields = fields?.pending || [];

  const handleFinalize = () => {
    setFinalized(true);
  };

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Call Wrap-Up"
        subtitle={`Finalizing ${session?.caller_phone || callId}`}
        actions={
          finalized ? (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-sm px-4 py-2">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Finalized
            </Badge>
          ) : (
            <Button className="gap-2" onClick={handleFinalize}>
              <Send className="w-4 h-4" />
              Finalize & Close
            </Button>
          )
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="font-mono text-xs">{callId}</Badge>
        <Badge variant="secondary" className="text-xs">
          <Clock className="w-3 h-3 mr-1" />
          {session?.started_at ? `${Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60000)}m call` : "N/A"}
        </Badge>
      </div>

      {coaching?.suggested_response && (
        <Card className="bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Final Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{coaching.suggested_response}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CallScoreCard data={mockCallScore} />
        <LeadScoreCard data={mockLeadScore} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Disposition</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {dispositions.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={selectedDisposition === d ? "default" : "outline"}
                className="text-xs"
                onClick={() => setSelectedDisposition(d)}
              >
                {d}
              </Button>
            ))}
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <ArrowRight className="w-3 h-3 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Recommended:</span>
              <Badge variant="outline" className="text-xs">Interested - Follow Up</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <TaskManagementPanel tasks={mockTasks} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4" />
            Field Confirmation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {writtenFields.map((field: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-50/50 border border-green-200/50">
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">{field.field_name}</span>
                  <div className="text-sm font-medium">{field.field_value}</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              </div>
            ))}
            {pendingFields.map((field: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-50/50 border border-amber-200/50">
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">{field.field_name}</span>
                  <div className="text-sm font-medium">{field.field_value}</div>
                </div>
                <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600">Pending</Badge>
              </div>
            ))}
            {writtenFields.length === 0 && pendingFields.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">No fields extracted during this call.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sync Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <SyncStatusRow label="Transcript saved" status={finalized ? "synced" : "pending"} />
            <SyncStatusRow label="Zoho CRM fields" status={writtenFields.length > 0 ? "synced" : "idle"} />
            <SyncStatusRow label="Call score recorded" status={finalized ? "synced" : "idle"} />
            <SyncStatusRow label="Lead score updated" status={finalized ? "synced" : "idle"} />
            <SyncStatusRow label="Tasks created" status={finalized ? "synced" : "pending"} />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <ArrowRight className="w-5 h-5 text-primary" />
            <div>
              <div className="text-sm font-semibold">Next Best Action</div>
              <p className="text-xs text-muted-foreground mt-0.5">Send program brochure and schedule follow-up in 48 hours.</p>
            </div>
            <Button size="sm" className="ml-auto text-xs gap-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Accept
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
