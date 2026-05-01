import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Bot, Loader2, Phone, Clock, Timer, Headphones, ChevronDown, ChevronRight,
  ThumbsUp, ThumbsDown, AlertCircle, CheckCircle2, MessageSquare,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type Rating = "good" | "needs_review" | "bad";

interface BotProfile {
  id: string;
  full_name: string | null;
}

interface BotCall {
  id: string;
  ctm_call_id: string;
  caller_phone: string | null;
  caller_name: string | null;
  started_at: string | null;
  talk_seconds: number | null;
  status: string;
  ctm_raw_payload: any;
  specialist_id: string;
  bot_name: string | null;
  existing_feedback: { id: string; rating: Rating; notes: string | null; tags: string[] | null } | null;
}

const TAG_OPTIONS = [
  "good-handling",
  "wrong-info",
  "missed-handoff",
  "escalation-needed",
  "off-script",
  "long-pauses",
  "good-rapport",
  "transcription-issue",
  "should-have-collected-X",
];

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}

const ratingClass: Record<Rating, string> = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  needs_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  bad: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
};

export default function AIBotFeedback() {
  const { user } = useAuth();
  const [bots, setBots] = useState<BotProfile[]>([]);
  const [calls, setCalls] = useState<BotCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unrated" | Rating>("unrated");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);

    const { data: botProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_ai_agent", true)
      .eq("is_active", true);
    setBots((botProfiles ?? []) as BotProfile[]);
    const botIds = (botProfiles ?? []).map((b) => b.id);
    if (botIds.length === 0) {
      setCalls([]); setLoading(false);
      return;
    }

    const { data: callsRaw, error: callsErr } = await supabase
      .from("call_sessions")
      .select(`
        id, ctm_call_id, caller_phone_normalized, caller_name, started_at, talk_seconds, status,
        ctm_raw_payload, specialist_id,
        bot:profiles!call_sessions_specialist_id_fkey(full_name),
        feedback:ai_bot_feedback(id, rating, notes, tags)
      `)
      .in("specialist_id", botIds)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (callsErr) { setError(callsErr.message); setLoading(false); return; }

    const mapped: BotCall[] = ((callsRaw ?? []) as any[]).map((c) => {
      const feedbackArr = Array.isArray(c.feedback) ? c.feedback : (c.feedback ? [c.feedback] : []);
      const existing = feedbackArr[0] ?? null;
      const bot = Array.isArray(c.bot) ? c.bot[0] : c.bot;
      return {
        id: c.id,
        ctm_call_id: c.ctm_call_id,
        caller_phone: c.caller_phone_normalized,
        caller_name: c.caller_name,
        started_at: c.started_at,
        talk_seconds: c.talk_seconds,
        status: c.status,
        ctm_raw_payload: c.ctm_raw_payload,
        specialist_id: c.specialist_id,
        bot_name: bot?.full_name ?? null,
        existing_feedback: existing ? {
          id: existing.id,
          rating: existing.rating,
          notes: existing.notes,
          tags: existing.tags,
        } : null,
      };
    });

    const filtered = filter === "all" ? mapped
      : filter === "unrated" ? mapped.filter((c) => !c.existing_feedback)
      : mapped.filter((c) => c.existing_feedback?.rating === filter);

    setCalls(filtered);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Bot className="w-6 h-6" /> AI Bot Feedback
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calls handled by AI bots when no human was available. Rate each one to drive prompt/model improvements.
          {bots.length > 0 && ` Tracking ${bots.length} bot${bots.length === 1 ? "" : "s"}: ${bots.map((b) => b.full_name).join(", ")}.`}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["unrated", "needs_review", "bad", "good", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f.replace("_", " ")}
          </Button>
        ))}
      </div>

      {loading && <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading bot calls…</CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && calls.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">
          No calls in this filter.
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {calls.map((c) => (
          <BotCallRow
            key={c.id}
            call={c}
            expanded={expandedId === c.id}
            onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            currentUserId={user?.id ?? null}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function BotCallRow({
  call, expanded, onToggle, currentUserId, onChanged,
}: {
  call: BotCall; expanded: boolean; onToggle: () => void;
  currentUserId: string | null; onChanged: () => void;
}) {
  const audio = call.ctm_raw_payload?.audio;
  const [transcript, setTranscript] = useState<Array<{ sequence_number: number; speaker: string | null; content: string }> | null>(null);
  const [tloading, setTloading] = useState(false);

  const [rating, setRating] = useState<Rating | null>(call.existing_feedback?.rating ?? null);
  const [notes, setNotes] = useState(call.existing_feedback?.notes ?? "");
  const [tags, setTags] = useState<string[]>(call.existing_feedback?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || transcript) return;
    setTloading(true);
    supabase
      .from("transcript_chunks")
      .select("sequence_number, speaker, content")
      .eq("call_session_id", call.id)
      .order("sequence_number", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setTranscript((data ?? []) as any);
        setTloading(false);
      });
  }, [expanded, call.id, transcript]);

  function toggleTag(tag: string) {
    setTags((t) => t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]);
  }

  async function save() {
    if (!rating) { setSaveError("Pick a rating first"); return; }
    setSaving(true); setSaveError(null);

    const payload = {
      call_session_id: call.id,
      bot_profile_id: call.specialist_id,
      rating,
      notes: notes.trim() || null,
      tags: tags.length > 0 ? tags : null,
      reviewer_id: currentUserId,
    };

    let err;
    if (call.existing_feedback) {
      ({ error: err } = await supabase
        .from("ai_bot_feedback")
        .update({ rating, notes: payload.notes, tags: payload.tags, reviewer_id: currentUserId })
        .eq("id", call.existing_feedback.id));
    } else {
      ({ error: err } = await supabase.from("ai_bot_feedback").insert(payload));
    }
    setSaving(false);
    if (err) setSaveError(err.message);
    else onChanged();
  }

  return (
    <Card className={call.existing_feedback ? `border-l-4 ${ratingClass[call.existing_feedback.rating].split(" ").pop()}` : "border-l-4 border-l-muted"}>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <Bot className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">{call.bot_name ?? "AI Bot"}</span>
              <Badge variant="outline" className="text-[10px]">{call.status}</Badge>
              {call.existing_feedback && (
                <Badge className={ratingClass[call.existing_feedback.rating]} variant="outline">
                  {call.existing_feedback.rating === "good" && <ThumbsUp className="w-3 h-3 mr-1" />}
                  {call.existing_feedback.rating === "bad" && <ThumbsDown className="w-3 h-3 mr-1" />}
                  {call.existing_feedback.rating === "needs_review" && <AlertCircle className="w-3 h-3 mr-1" />}
                  {call.existing_feedback.rating.replace("_", " ")}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(call.started_at)}</span>
              <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {fmtDur(call.talk_seconds)}</span>
              {call.caller_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {call.caller_phone}{call.caller_name && ` · ${call.caller_name}`}</span>}
              <span className="font-mono text-[10px]">CTM {call.ctm_call_id}</span>
            </div>
            {call.existing_feedback?.tags && call.existing_feedback.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {call.existing_feedback.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {audio && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Headphones className="w-3 h-3" /> Recording
              </h4>
              <audio controls preload="none" className="w-full max-w-md h-9" src={String(audio)} />
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" /> Transcript
            </h4>
            {tloading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </div>
            ) : !transcript || transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No transcript for this call.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1 border rounded-md p-3 text-sm">
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

          <div className="space-y-3 border-t pt-4">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Your feedback</h4>

            <div className="flex gap-2 flex-wrap">
              {(["good", "needs_review", "bad"] as const).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={rating === r ? "default" : "outline"}
                  onClick={() => setRating(r)}
                  className={rating === r ? "" : ""}
                >
                  {r === "good" && <ThumbsUp className="w-3 h-3 mr-1.5" />}
                  {r === "bad" && <ThumbsDown className="w-3 h-3 mr-1.5" />}
                  {r === "needs_review" && <AlertCircle className="w-3 h-3 mr-1.5" />}
                  {r.replace("_", " ")}
                </Button>
              ))}
            </div>

            <div>
              <div className="text-[11px] text-muted-foreground mb-1.5">Tags (click to toggle)</div>
              <div className="flex flex-wrap gap-1.5">
                {TAG_OPTIONS.map((t) => (
                  <Badge
                    key={t}
                    variant={tags.includes(t) ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => toggleTag(t)}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </div>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Specific notes — what should the bot have said differently? Where should it have escalated?"
              rows={3}
              className="text-sm"
            />

            {saveError && <div className="text-xs text-destructive">{saveError}</div>}

            <div className="flex justify-end">
              <Button size="sm" onClick={save} disabled={saving || !rating}>
                {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1.5" />}
                {call.existing_feedback ? "Update feedback" : "Save feedback"}
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
