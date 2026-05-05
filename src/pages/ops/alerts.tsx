import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, Loader2, CheckCircle2, ShieldCheck,
  Clock, Phone, Headphones, User as UserIcon, Timer, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";
import { IncidentCard, type Severity, type Status } from "@/components/dashboard/IncidentCard";

type AlertType = "self_harm" | "threat_violence" | "threat_criminal" | "emergency_services";
type AlertSeverity = "critical" | "high" | "medium";
type AlertStatus = "pending" | "acknowledged" | "resolved";

interface AlertRow {
  id: string;
  call_session_id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
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

function getScore(call: AlertRow["call"]) {
  if (!call?.score) return null;
  if (Array.isArray(call.score)) return call.score[0] ?? null;
  return call.score;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  self_harm: "Self-harm",
  threat_violence: "Threat of violence",
  threat_criminal: "Criminal threat",
  emergency_services: "Emergency services",
};

// Map domain severity to IncidentCard's broader severity scale
function toSev(s: AlertSeverity): Severity {
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  return "medium";
}

export default function AlertsQueue() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ pending: 0, acknowledged: 0, resolved: 0, all: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Fire counts query in parallel with the list query so the filter
    // tabs always show accurate totals regardless of the active filter.
    const countsPromise = supabase
      .from("high_priority_alerts")
      .select("status", { count: "exact" });
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
    const [listRes, countsRes] = await Promise.all([q, countsPromise]);
    if (listRes.error) {
      setError(listRes.error.message);
    } else {
      setAlerts((listRes.data ?? []) as unknown as AlertRow[]);
    }
    if (!countsRes.error && countsRes.data) {
      const all = countsRes.data as Array<{ status: AlertStatus }>;
      setCounts({
        pending: all.filter((a) => a.status === "pending").length,
        acknowledged: all.filter((a) => a.status === "acknowledged").length,
        resolved: all.filter((a) => a.status === "resolved").length,
        all: all.length,
      });
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      eyebrow="ALERTS"
      title="High-priority alerts"
      subtitle="Crisis-language signals flagged by the AI classifier. Review the excerpt, listen to the recording, and sign off so leadership knows it was handled."
      maxWidth={1400}
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      }
    >
      {/* Filter row — match Card-based pattern used on other ops pages */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["pending", "acknowledged", "resolved", "all"] as const).map((f) => {
          const active = statusFilter === f;
          const count = counts[f];
          return (
            <Button
              key={f}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => setStatusFilter(f)}
              className="h-8 gap-1.5 capitalize text-xs"
            >
              <span>{f}</span>
              <Badge variant={active ? "secondary" : "outline"} className="text-[10px] h-4 px-1.5">
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {error && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="pt-3 pb-3 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {loading && alerts.length === 0 ? (
        <Card>
          <CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading alerts…
          </CardContent>
        </Card>
      ) : !error && alerts.length === 0 ? (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground space-y-2">
            <ShieldCheck className="w-8 h-8 text-emerald-500/70 mx-auto" />
            <div className="text-foreground">No alerts in this status.</div>
            <div className="text-xs">
              {statusFilter === "pending" ? "That's a good thing." : `Nothing to show right now.`}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertItem
              key={a.id}
              alert={a}
              expanded={expandedId === a.id}
              onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
              currentUserId={user?.id ?? null}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function AlertItem({
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
      .then(({ data }) => {
        setTranscript((data ?? []) as any);
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

  const score = getScore(alert.call);
  const agent = alert.call?.ctm_raw_payload?.agent;
  const agentName = agent?.name ?? agent?.email ?? null;
  const callerLabel = alert.call?.caller_name ?? alert.call?.caller_phone_normalized ?? "Unknown caller";
  // CTM caller-ID often returns "PHOENIX      AZ" — show as a pseudo-location chip
  const callerLocation = alert.call?.ctm_raw_payload?.cnam && /^[A-Z]+\s+[A-Z]{2}$/.test(String(alert.call.ctm_raw_payload.cnam).trim())
    ? String(alert.call.ctm_raw_payload.cnam).trim()
    : null;
  const recordingUrl = alert.call?.ctm_raw_payload?.audio ? String(alert.call.ctm_raw_payload.audio) : null;

  const timingChips = [
    { icon: Clock, label: fmtTime(alert.call?.started_at ?? alert.classified_at), srLabel: "Time" },
    ...(alert.call?.talk_seconds != null
      ? [{ icon: Timer, label: fmtDuration(alert.call.talk_seconds), srLabel: "Duration" }]
      : []),
  ];

  const contextChips = [
    {
      icon: Phone,
      label: <>{alert.call?.caller_phone_normalized ?? "—"}{callerLocation ? <span className="text-muted-foreground ml-1">· {callerLocation}</span> : null}</>,
      mono: true,
      srLabel: "Caller phone",
    },
    ...(callerLabel !== "Unknown caller" && alert.call?.caller_name
      ? [{ icon: UserIcon, label: alert.call.caller_name, srLabel: "Caller name" }]
      : []),
    ...(agentName
      ? [{ icon: UserIcon, label: <>Specialist: <span className="text-foreground">{agentName}</span></>, srLabel: "Specialist" }]
      : []),
    ...(alert.call?.ctm_call_id
      ? [{ label: <>call <span className="text-muted-foreground">{alert.call.ctm_call_id}</span></>, mono: true, muted: true, srLabel: "CTM call ID" }]
      : []),
    ...(score?.composite_score != null
      ? [{
          label: <>QA <span className={score.composite_score >= 80 ? "text-emerald-500" : score.composite_score >= 60 ? "text-amber-500" : "text-red-500"}>{score.composite_score}</span></>,
          srLabel: "QA score",
        }]
      : []),
  ];

  const actions = (
    <div className="flex flex-wrap items-center gap-2 ml-auto">
      {recordingUrl && !expanded && (
        <a
          href={recordingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
        >
          <Headphones className="w-3.5 h-3.5" /> Recording
        </a>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="h-8 text-xs"
      >
        {expanded ? "Close" : "Review"}
      </Button>
      {alert.status === "pending" && (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); acknowledge(); }}
          disabled={actionLoading !== null}
          className="h-8 text-xs"
        >
          {actionLoading === "ack" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1.5" />}
          Acknowledge
        </Button>
      )}
      {alert.status !== "resolved" && (
        <Button
          size="sm"
          onClick={(e) => { e.stopPropagation(); resolve(); }}
          disabled={actionLoading !== null}
          className="h-8 text-xs"
        >
          {actionLoading === "resolve" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1.5" />}
          Mark resolved
        </Button>
      )}
    </div>
  );

  const expandedBody = (
    <div className="space-y-4 mt-3">
      {recordingUrl && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Headphones className="w-3 h-3" /> Call recording
          </div>
          <audio controls preload="none" className="w-full" src={recordingUrl}>
            Your browser does not support audio playback.
          </audio>
        </div>
      )}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Full transcript</div>
        {transcriptLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading transcript…
          </div>
        ) : !transcript || transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transcript available for this call.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2 bg-muted/30 border rounded-lg p-3 text-[13px] leading-relaxed">
            {transcript.map((t) => (
              <div key={t.sequence_number}>
                <span className="text-[11px] font-medium text-muted-foreground mr-2 uppercase tracking-wide">
                  {t.speaker ?? "?"}
                </span>
                <span>{t.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {alert.status !== "resolved" && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Resolution notes</div>
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
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">Resolution</div>
          <p className="text-[13px] leading-relaxed">{alert.resolution_notes}</p>
          <p className="text-[11.5px] text-muted-foreground mt-1">Resolved {fmtTime(alert.resolved_at)}</p>
        </div>
      )}

      {actionError && <div className="text-xs text-red-500">{actionError}</div>}
    </div>
  );

  return (
    <IncidentCard
      severity={toSev(alert.severity)}
      category={ALERT_TYPE_LABEL[alert.alert_type]}
      status={alert.status as Status}
      timingChips={timingChips}
      contextChips={contextChips}
      body={<>&ldquo;{alert.trigger_excerpt}&rdquo;</>}
      actions={actions}
      expandable
      defaultExpanded={expanded}
      expandedBody={expandedBody}
      ariaLabel={`${alert.severity} ${ALERT_TYPE_LABEL[alert.alert_type]} alert, status ${alert.status}`}
    />
  );
}
