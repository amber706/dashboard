import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { AlertTriangle, Loader2, CheckCircle2, ShieldCheck, X, Clock, Phone, Headphones, User as UserIcon, Timer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type AlertType = "self_harm" | "threat_violence" | "threat_criminal" | "emergency_services";
type Severity = "critical" | "high" | "medium";
type Status = "pending" | "acknowledged" | "resolved";

interface AlertRow {
  id: string;
  call_session_id: string;
  alert_type: AlertType;
  severity: Severity;
  status: Status;
  trigger_excerpt: string;
  trigger_chunk_id: string | null;
  classified_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  call: {
    id: string;
    ctm_call_id: string;
    caller_phone_normalized: string | null;
    caller_name: string | null;
    started_at: string | null;
    talk_seconds: number | null;
    ctm_raw_payload: Record<string, any> | null;
    score: { composite_score: number | null; caller_sentiment: string | null; needs_supervisor_review: boolean | null } | null;
  } | null;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function getScore(call: AlertRow["call"]): { composite_score: number | null; caller_sentiment: string | null; needs_supervisor_review: boolean | null } | null {
  if (!call?.score) return null;
  // PostgREST may return either an object or a single-element array depending on its FK detection.
  if (Array.isArray(call.score)) return call.score[0] ?? null;
  return call.score as any;
}

function scoreColorClass(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

const alertTypeLabel: Record<AlertType, string> = {
  self_harm: "Self-harm",
  threat_violence: "Threat of violence",
  threat_criminal: "Criminal threat",
  emergency_services: "Emergency services",
};

const severityClass: Record<Severity, string> = {
  critical: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-900",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-900",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-900",
};

const statusClass: Record<Status, string> = {
  pending: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  acknowledged: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AlertsQueue() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("high_priority_alerts")
      .select(`
        id, call_session_id, alert_type, severity, status, trigger_excerpt,
        trigger_chunk_id, classified_at, acknowledged_by, acknowledged_at,
        resolved_by, resolved_at, resolution_notes,
        call:call_sessions(id, ctm_call_id, caller_phone_normalized, caller_name, started_at, talk_seconds, ctm_raw_payload,
          score:call_scores(composite_score, caller_sentiment, needs_supervisor_review))
      `)
      .order("classified_at", { ascending: false })
      .limit(100);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data, error } = await q;
    if (error) setError(error.message);
    else setAlerts((data ?? []) as unknown as AlertRow[]);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    pending: alerts.filter((a) => a.status === "pending").length,
    acknowledged: alerts.filter((a) => a.status === "acknowledged").length,
    resolved: alerts.filter((a) => a.status === "resolved").length,
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-rose-600" />
          High-priority alerts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Crisis-language signals flagged by the AI classifier. Review, acknowledge, and sign off.
        </p>
      </div>

      <div className="flex gap-2">
        {(["pending", "acknowledged", "resolved", "all"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={statusFilter === f ? "default" : "outline"}
            onClick={() => setStatusFilter(f)}
          >
            {f}{f !== "all" && counts[f] != null && ` (${counts[f]})`}
          </Button>
        ))}
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading alerts…
        </CardContent></Card>
      )}

      {error && (
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>
      )}

      {!loading && !error && alerts.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">
          No alerts in this status. {statusFilter === "pending" && "That's a good thing."}
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {alerts.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            expanded={expandedId === a.id}
            onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
            currentUserId={user?.id ?? null}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  expanded,
  onToggle,
  currentUserId,
  onChanged,
}: {
  alert: AlertRow;
  expanded: boolean;
  onToggle: () => void;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const [transcript, setTranscript] = useState<Array<{ sequence_number: number; speaker: string | null; content: string }> | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState(alert.resolution_notes ?? "");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || transcript) return;
    setTranscriptLoading(true);
    supabase
      .from("transcript_chunks")
      .select("sequence_number, speaker, content")
      .eq("call_session_id", alert.call_session_id)
      .order("sequence_number", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setTranscript((data ?? []) as any);
        setTranscriptLoading(false);
      });
  }, [expanded, alert.call_session_id, transcript]);

  async function acknowledge() {
    if (!currentUserId) return;
    setActionLoading("ack");
    setActionError(null);
    const { error } = await supabase
      .from("high_priority_alerts")
      .update({
        status: "acknowledged",
        acknowledged_by: currentUserId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", alert.id);
    setActionLoading(null);
    if (error) setActionError(error.message);
    else onChanged();
  }

  async function resolve() {
    if (!currentUserId) return;
    setActionLoading("resolve");
    setActionError(null);
    const { error } = await supabase
      .from("high_priority_alerts")
      .update({
        status: "resolved",
        resolved_by: currentUserId,
        resolved_at: new Date().toISOString(),
        resolution_notes: resolutionNotes || null,
      })
      .eq("id", alert.id);
    setActionLoading(null);
    if (error) setActionError(error.message);
    else onChanged();
  }

  return (
    <Card className={`border-l-4 ${severityClass[alert.severity].split(" ")[3]}`}>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={severityClass[alert.severity]} variant="outline">
                {alert.severity}
              </Badge>
              <Badge variant="secondary">{alertTypeLabel[alert.alert_type]}</Badge>
              <Badge className={statusClass[alert.status]} variant="secondary">{alert.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" /> {fmtTime(alert.call?.started_at ?? alert.classified_at)}
              </span>
              {alert.call?.talk_seconds != null && (
                <span className="flex items-center gap-1">
                  <Timer className="w-3 h-3" /> {fmtDuration(alert.call.talk_seconds)}
                </span>
              )}
              {alert.call?.caller_phone_normalized && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {alert.call.caller_phone_normalized}
                  {alert.call.caller_name && ` · ${alert.call.caller_name}`}
                </span>
              )}
              {alert.call?.ctm_raw_payload?.agent && (
                <span className="flex items-center gap-1">
                  <UserIcon className="w-3 h-3" /> Specialist: {alert.call.ctm_raw_payload.agent?.name ?? alert.call.ctm_raw_payload.agent?.email ?? String(alert.call.ctm_raw_payload.agent)}
                </span>
              )}
              {alert.call?.ctm_raw_payload?.tracking_number && (
                <span>via {String(alert.call.ctm_raw_payload.tracking_number)}</span>
              )}
              {alert.call?.ctm_call_id && (
                <span className="font-mono text-[10px]">call {alert.call.ctm_call_id}</span>
              )}
              {(() => {
                const score = getScore(alert.call);
                if (!score?.composite_score) return null;
                return (
                  <span className="flex items-center gap-1">
                    QA: <span className={`font-semibold ${scoreColorClass(score.composite_score)}`}>{score.composite_score}</span>
                    {score.needs_supervisor_review && <Badge variant="outline" className="text-[10px] py-0 px-1 ml-0.5">flagged</Badge>}
                  </span>
                );
              })()}
              {alert.call?.ctm_raw_payload?.audio && (
                <a
                  href={String(alert.call.ctm_raw_payload.audio)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-foreground hover:underline"
                >
                  <Headphones className="w-3 h-3" /> Recording
                </a>
              )}
            </div>
            <p className="text-sm italic text-muted-foreground">"{alert.trigger_excerpt}"</p>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {alert.call?.ctm_raw_payload?.audio && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                <Headphones className="w-3 h-3" /> Call recording
              </h4>
              <audio controls preload="none" className="w-full" src={String(alert.call.ctm_raw_payload.audio)}>
                Your browser does not support audio playback.
              </audio>
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Full transcript</h4>
            {transcriptLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading transcript…
              </div>
            ) : !transcript || transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcript available for this call.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-1.5 border rounded-md p-3 text-sm">
                {transcript.map((t) => (
                  <div key={t.sequence_number}>
                    <span className="text-xs font-medium text-muted-foreground mr-2">
                      [{t.sequence_number}] {t.speaker ?? "?"}:
                    </span>
                    {t.content}
                  </div>
                ))}
              </div>
            )}
          </div>

          {alert.status !== "resolved" && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Resolution notes</h4>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="What action was taken? E.g., warm transferred to clinical, called caller back, escalated to medical director…"
                rows={3}
              />
            </div>
          )}

          {alert.status === "resolved" && alert.resolution_notes && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Resolution notes</h4>
              <p className="text-sm">{alert.resolution_notes}</p>
              <p className="text-xs text-muted-foreground mt-1">Resolved {fmtTime(alert.resolved_at)}</p>
            </div>
          )}

          {actionError && <div className="text-xs text-destructive">{actionError}</div>}

          <div className="flex gap-2 justify-end">
            {alert.status === "pending" && (
              <Button size="sm" variant="outline" onClick={acknowledge} disabled={actionLoading !== null}>
                {actionLoading === "ack" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1.5" />}
                Acknowledge
              </Button>
            )}
            {alert.status !== "resolved" && (
              <Button size="sm" onClick={resolve} disabled={actionLoading !== null}>
                {actionLoading === "resolve" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1.5" />}
                Mark resolved
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onToggle}>
              <X className="w-3 h-3 mr-1.5" /> Close
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
