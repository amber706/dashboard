import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, Loader2, CheckCircle2, ShieldCheck, X,
  Clock, Phone, Headphones, User as UserIcon, Timer, MapPin,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IncidentCard, type Severity, type Status } from "@/components/dashboard/IncidentCard";
import { GradientWord } from "@/components/dashboard/SectionHeader";

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

  const filterCount = statusFilter === "all" ? alerts.length : counts[statusFilter] ?? 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-[1400px] mx-auto space-y-8">
      {/* Page header */}
      <header>
        <div className="mb-3"><span className="eyebrow text-[#E89077]">00 — RISK SIGNALS</span></div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="font-display text-[40px] sm:text-[48px] font-normal leading-[0.98] tracking-[-0.025em] text-[#F4EFE6] flex items-center gap-3">
            <AlertTriangle className="w-9 h-9 text-[#E89077]" aria-hidden="true" />
            High-priority <GradientWord>alerts.</GradientWord>
          </h1>
        </div>
        <p className="mt-3 text-[15px] text-[#A6B5D0] max-w-2xl leading-relaxed">
          Crisis-language signals flagged by the AI classifier. Review the excerpt, listen to the recording, and sign off so leadership knows it was handled.
        </p>
        <div className="chc-divider mt-6 max-w-md opacity-80" />
      </header>

      {/* Segmented filter — pill row */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["pending", "acknowledged", "resolved", "all"] as const).map((f) => {
          const active = statusFilter === f;
          const count = f === "all" ? alerts.length : counts[f] ?? 0;
          return (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors capitalize ${
                active
                  ? "bg-[#5BA3D4] text-[#02071A] shadow-[0_0_0_1px_rgba(91,163,212,0.4),_0_4px_16px_rgba(91,163,212,0.25)]"
                  : "bg-[#0F2549] border border-[#11244A] text-[#A6B5D0] hover:border-[#1B335F] hover:text-[#F4EFE6]"
              }`}
            >
              <span>{f}</span>
              <span className={`text-[10.5px] tabular-nums px-1.5 rounded-full ${active ? "bg-white/20" : "bg-[#02071A]/60 text-[#6E7E9E]"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* States */}
      {loading && (
        <div className="glass rounded-2xl p-6 text-sm text-[#A6B5D0] flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading alerts…
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-[#E89077]/40 bg-[#E89077]/5 p-6 text-sm text-[#E89077]">{error}</div>
      )}
      {!loading && !error && alerts.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-[#10B981]/15 text-[#10B981] flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <p className="text-[15px] text-[#F4EFE6]">No alerts in this status.</p>
          <p className="text-[13px] text-[#6E7E9E] mt-1">{statusFilter === "pending" ? "That's a good thing." : `Showing ${filterCount} alert${filterCount === 1 ? "" : "s"}.`}</p>
        </div>
      )}

      {/* Alert list — IncidentCard per row */}
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
    </div>
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
      label: <>{alert.call?.caller_phone_normalized ?? "—"}{callerLocation ? <span className="text-[#6E7E9E] ml-1">· {callerLocation}</span> : null}</>,
      mono: true,
      srLabel: "Caller phone",
    },
    ...(callerLabel !== "Unknown caller" && alert.call?.caller_name
      ? [{ icon: UserIcon, label: alert.call.caller_name, srLabel: "Caller name" }]
      : []),
    ...(agentName
      ? [{ icon: UserIcon, label: <>Specialist: <span className="text-[#F4EFE6]">{agentName}</span></>, srLabel: "Specialist" }]
      : []),
    ...(alert.call?.ctm_call_id
      ? [{ label: <>call <span className="text-[#A6B5D0]">{alert.call.ctm_call_id}</span></>, mono: true, muted: true, srLabel: "CTM call ID" }]
      : []),
    ...(score?.composite_score != null
      ? [{
          label: <>QA <span className={score.composite_score >= 80 ? "text-[#10B981]" : score.composite_score >= 60 ? "text-[#E5C879]" : "text-[#E89077]"}>{score.composite_score}</span></>,
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
          className="inline-flex items-center gap-1.5 text-[12.5px] text-[#5BA3D4] hover:text-[#F4EFE6] transition-colors px-2 py-1"
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
          <div className="eyebrow text-[#5BA3D4] mb-2 flex items-center gap-1.5">
            <Headphones className="w-3 h-3" /> Call recording
          </div>
          <audio controls preload="none" className="w-full" src={recordingUrl}>
            Your browser does not support audio playback.
          </audio>
        </div>
      )}
      <div>
        <div className="eyebrow text-[#A6B5D0] mb-2">Full transcript</div>
        {transcriptLoading ? (
          <div className="text-sm text-[#A6B5D0] flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading transcript…
          </div>
        ) : !transcript || transcript.length === 0 ? (
          <p className="text-sm text-[#6E7E9E]">No transcript available for this call.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2 bg-[#050E24]/60 border border-[#11244A] rounded-lg p-3 text-[13px] leading-relaxed">
            {transcript.map((t) => (
              <div key={t.sequence_number}>
                <span className="text-[11px] font-medium text-[#5BA3D4] mr-2 uppercase tracking-wide">
                  {t.speaker ?? "?"}
                </span>
                <span className="text-[#A6B5D0]">{t.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {alert.status !== "resolved" && (
        <div>
          <div className="eyebrow text-[#A6B5D0] mb-2">Resolution notes</div>
          <Textarea
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            placeholder="What action was taken? E.g., warm transferred to clinical, called caller back, escalated to medical director…"
            rows={3}
            className="bg-[#050E24]/60 border-[#11244A] text-[#F4EFE6] placeholder:text-[#6E7E9E]"
          />
        </div>
      )}

      {alert.status === "resolved" && alert.resolution_notes && (
        <div>
          <div className="eyebrow text-[#10B981] mb-2">Resolution</div>
          <p className="text-[13px] text-[#F4EFE6] leading-relaxed">{alert.resolution_notes}</p>
          <p className="text-[11.5px] text-[#6E7E9E] mt-1">Resolved {fmtTime(alert.resolved_at)}</p>
        </div>
      )}

      {actionError && <div className="text-[12.5px] text-[#E89077]">{actionError}</div>}
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
