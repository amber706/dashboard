// Front-end API client. Originally talked to a Replit-side `/api/...` server;
// during the Supabase port we route specific paths to Supabase queries here so
// existing pages can keep using `apiFetch` unchanged. Endpoints not yet routed
// fall through to a 501 stub response so the UI can display an empty state.

import { supabase } from "./supabase";

// Inlined here to avoid a circular import with `@/hooks/use-ops-api`,
// which imports from this module. Keep these fields in sync if the
// canonical type in use-ops-api.ts changes.
interface RepWorkloadData {
  rep_id: string;
  rep_name: string;
  calls_today: number;
  missed_calls: number;
  open_leads: number;
  overdue_callbacks: number;
  capacity_status: string;
  capacity_score: number;
  first_contact_sla_backlog: number;
  qa_trend: number | null;
  avg_callback_speed_minutes: number | null;
  suggested_actions: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function getSuggestions(queryString: string): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const typeFilter = params.get("type");
  const priorityFilter = params.get("priority");
  const statusFilter = params.get("status");
  const repFilter = params.get("rep");

  let query = supabase
    .from("suggestions")
    .select(
      `id, suggestion_type, priority, title, summary, reasoning,
       recommended_action, recommended_owner, confidence,
       related_lead_id, related_rep_id, related_call_id,
       status, created_at,
       owner:profiles!suggestions_recommended_owner_fkey(full_name, email)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (typeFilter) query = query.eq("suggestion_type", typeFilter);
  if (priorityFilter) query = query.eq("priority", priorityFilter);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (repFilter) query = query.eq("related_rep_id", repFilter);

  const { data, count, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  const suggestions = (data ?? []).map((row) => {
    const owner = row.owner as { full_name: string | null; email: string | null } | null;
    return {
      id: row.id,
      type: row.suggestion_type,
      priority: row.priority,
      title: row.title,
      summary: row.summary,
      recommended_action: row.recommended_action ?? "",
      action_owner: owner?.full_name ?? owner?.email ?? "Unassigned",
      reason: row.reasoning ?? "",
      confidence: Number(row.confidence),
      related_lead_id: row.related_lead_id ?? undefined,
      related_rep_id: row.related_rep_id ?? undefined,
      related_call_id: row.related_call_id ?? undefined,
      status: row.status,
      created_at: row.created_at,
      call_context: null,
    };
  });

  return jsonResponse({ suggestions, total: count ?? suggestions.length });
}

async function getAttributionConflicts(): Promise<Response> {
  const { data, count, error } = await supabase
    .from("attribution_records")
    .select(
      `id, conflict_reason, audit_log, created_at,
       ctm_source_category, ctm_medium, ctm_campaign,
       normalized_source, normalized_medium, normalized_campaign,
       call_session:call_sessions!attribution_records_call_session_id_fkey(ctm_call_id)`,
      { count: "exact" },
    )
    .eq("has_conflict", true)
    .order("created_at", { ascending: false });

  if (error) return jsonResponse({ error: error.message }, 500);

  const conflicts = (data ?? []).map((row) => {
    const callSession = row.call_session as { ctm_call_id: string | null } | null;
    const audit = (row.audit_log as Record<string, unknown> | null) ?? {};
    const proposed = typeof audit.proposed_correction === "string"
      ? audit.proposed_correction
      : "Review the conflict and choose a correction";
    return {
      id: row.id,
      ctm_call_id: callSession?.ctm_call_id ?? "",
      ctm_source: row.ctm_source_category ?? "",
      ctm_medium: row.ctm_medium ?? "",
      ctm_campaign: row.ctm_campaign ?? "",
      zoho_source: row.normalized_source ?? "",
      zoho_medium: row.normalized_medium ?? "",
      zoho_campaign: row.normalized_campaign ?? "",
      conflict_reason: row.conflict_reason ?? "",
      proposed_correction: proposed,
      status: "pending",
      created_at: row.created_at,
    };
  });

  return jsonResponse({ conflicts, total: count ?? conflicts.length });
}

// Shape produced for a single FlaggedReview row, kept loose because the UI
// type lives in hooks/use-ops-api and would create a circular import here.
type FlaggedReviewRow = ReturnType<typeof mapFlaggedReview>;

function mapFlaggedReview(row: Record<string, unknown>): Record<string, unknown> {
  const callSession = row.call_session as
    | {
        ctm_call_id: string | null;
        lead_id: string | null;
        rep_id: string | null;
        recording_storage_path: string | null;
        lead: { zoho_lead_id: string | null } | null;
        rep: { full_name: string | null; email: string | null } | null;
      }
    | null;

  const qualitySignals = (row.quality_signals as Record<string, unknown> | null) ?? {};
  const concerns = Array.isArray(qualitySignals.concerns) ? qualitySignals.concerns : [];
  const complianceFlagsRaw = (row.compliance_flags as Array<Record<string, unknown>> | null) ?? [];
  const coachingTakeaways = (row.coaching_takeaways as Record<string, unknown> | null) ?? {};
  const recommendations = Array.isArray(coachingTakeaways.recommendations)
    ? coachingTakeaways.recommendations
    : [];

  const composite = row.composite_score as number | null;
  const reviewPriority =
    composite == null ? "medium" : composite < 50 ? "high" : composite < 70 ? "medium" : "low";

  const reviewReasons: Array<{ reason: string; detail: string }> = [];
  if (qualitySignals.auto_fail === true) {
    reviewReasons.push({ reason: "auto_fail", detail: "Call auto-failed grading" });
  }
  if (complianceFlagsRaw.length > 0) {
    reviewReasons.push({ reason: "compliance", detail: `${complianceFlagsRaw.length} compliance flag(s)` });
  }
  if (row.caller_sentiment === "negative") {
    reviewReasons.push({ reason: "sentiment", detail: "Negative caller sentiment detected" });
  }

  return {
    id: row.id,
    ctm_call_id: callSession?.ctm_call_id ?? "",
    zoho_lead_id: callSession?.lead?.zoho_lead_id ?? null,
    rep_id: callSession?.rep_id ?? null,
    rep_name: callSession?.rep?.full_name ?? callSession?.rep?.email ?? null,
    qa_score_percent: composite,
    poor_sentiment_flag: row.caller_sentiment === "negative",
    review_priority: reviewPriority,
    review_reasons: reviewReasons,
    concerns,
    issue_locations: [],
    qa_breakdown: {
      overall_score: composite ?? undefined,
      passed: qualitySignals.passed as boolean | undefined,
      auto_fail: qualitySignals.auto_fail as boolean | undefined,
      auto_fail_reasons: qualitySignals.auto_fail_reasons as string[] | undefined,
      category_scores: {
        qualification_completeness: row.qualification_completeness,
        rapport_and_empathy: row.rapport_and_empathy,
        objection_handling: row.objection_handling,
        urgency_handling: row.urgency_handling,
        next_step_clarity: row.next_step_clarity,
        script_adherence: row.script_adherence,
        compliance: row.compliance,
        booking_or_transfer: row.booking_or_transfer,
        overall_quality: row.overall_quality,
      },
      script_adherence_score: row.script_adherence as number | undefined,
      objection_handling_score: row.objection_handling as number | undefined,
    },
    sentiment_markers: [],
    coaching_recommendations: recommendations,
    status: row.supervisor_signoff_at ? "signed_off" : "pending",
    supervisor_review_required: row.needs_supervisor_review === true,
    supervisor_assigned_to: row.supervisor_signoff_by ?? null,
    supervisor_notes: row.signoff_notes ?? null,
    supervisor_signoff_at: row.supervisor_signoff_at ?? null,
    supervisor_action: null,
    coaching_required_flag: recommendations.length > 0,
    compliance_flag: complianceFlagsRaw.length > 0,
    score_correction_required_flag: false,
    escalation_flag: complianceFlagsRaw.length > 0 && composite != null && composite < 50,
    coaching_topic: null,
    transcript_text: null,
    recording_url: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const FLAGGED_REVIEW_SELECT = `
  id, composite_score, caller_sentiment, quality_signals, compliance_flags,
  coaching_takeaways, needs_supervisor_review, supervisor_signoff_by,
  supervisor_signoff_at, signoff_notes, created_at, updated_at,
  qualification_completeness, rapport_and_empathy, objection_handling,
  urgency_handling, next_step_clarity, script_adherence, compliance,
  booking_or_transfer, overall_quality,
  call_session:call_sessions!call_scores_call_session_id_fkey(
    ctm_call_id, lead_id, rep_id, recording_storage_path,
    lead:leads(zoho_lead_id),
    rep:profiles!call_sessions_rep_id_fkey(full_name, email)
  )
`;

async function getFlaggedReviews(queryString: string): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const status = params.get("status") ?? "pending";
  const limit = Number(params.get("limit") ?? "50");

  let query = supabase
    .from("call_scores")
    .select(FLAGGED_REVIEW_SELECT, { count: "exact" })
    .eq("needs_supervisor_review", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status === "pending") query = query.is("supervisor_signoff_at", null);
  else if (status === "signed_off") query = query.not("supervisor_signoff_at", "is", null);
  // status=all: no extra filter

  const { data, count, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  const items = (data ?? []).map((row) => mapFlaggedReview(row as Record<string, unknown>));
  const pending_count = items.filter((i: FlaggedReviewRow) => i.status === "pending").length;
  const high_priority_count = items.filter((i: FlaggedReviewRow) => i.review_priority === "high").length;

  return jsonResponse({ items, total: count ?? items.length, pending_count, high_priority_count });
}

async function getFlaggedReviewStats(): Promise<Response> {
  const { data, error } = await supabase
    .from("call_scores")
    .select(
      "id, composite_score, supervisor_signoff_at, compliance_flags, coaching_takeaways",
    )
    .eq("needs_supervisor_review", true);

  if (error) return jsonResponse({ error: error.message }, 500);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let pending = 0,
    high_priority = 0,
    coaching_scheduled = 0,
    compliance_flags = 0,
    signed_off_today = 0;

  for (const row of data ?? []) {
    const signoff = row.supervisor_signoff_at;
    const composite = row.composite_score as number | null;
    const flags = (row.compliance_flags as unknown[] | null) ?? [];
    const takeaways = (row.coaching_takeaways as Record<string, unknown> | null) ?? {};
    const recs = Array.isArray(takeaways.recommendations) ? takeaways.recommendations : [];

    if (!signoff) pending += 1;
    if (composite != null && composite < 50) high_priority += 1;
    if (recs.length > 0) coaching_scheduled += 1;
    if (flags.length > 0) compliance_flags += 1;
    if (signoff && new Date(signoff) >= startOfToday) signed_off_today += 1;
  }

  return jsonResponse({
    pending,
    high_priority,
    coaching_scheduled,
    compliance_flags,
    signed_off_today,
    total: (data ?? []).length,
  });
}

async function getFlaggedReviewById(id: string): Promise<Response> {
  const { data, error } = await supabase
    .from("call_scores")
    .select(FLAGGED_REVIEW_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return jsonResponse({ error: error.message }, 500);
  if (!data) return jsonResponse({ error: "Not found" }, 404);

  return jsonResponse(mapFlaggedReview(data as Record<string, unknown>));
}

async function getOpsOverview(): Promise<Response> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();

  const [
    conflictsCount,
    supervisorPending,
    inboundTodayCount,
    answeredTodayCount,
    missedTodayCount,
    repWorkloadForCapacity,
    openSuggestions,
  ] = await Promise.all([
    supabase
      .from("attribution_records")
      .select("id", { count: "exact", head: true })
      .eq("has_conflict", true),
    supabase
      .from("call_scores")
      .select("id", { count: "exact", head: true })
      .eq("needs_supervisor_review", true)
      .is("supervisor_signoff_at", null),
    supabase
      .from("call_sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", startOfDayISO)
      .eq("direction", "inbound"),
    supabase
      .from("call_sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", startOfDayISO)
      .not("status", "in", "(missed,abandoned,no_answer)"),
    supabase
      .from("call_sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", startOfDayISO)
      .in("status", ["missed", "abandoned"]),
    // Lightweight overloaded-rep count: specialists with >30 calls today.
    // Matches the same heuristic used in getRepWorkload's capacity_status.
    supabase
      .from("call_sessions")
      .select("specialist_id")
      .gte("started_at", startOfDayISO)
      .not("specialist_id", "is", null),
    supabase
      .from("suggestions")
      .select(
        `id, suggestion_type, priority, title, summary, reasoning,
         recommended_action, recommended_owner, confidence,
         related_lead_id, related_rep_id, related_call_id,
         status, created_at,
         owner:profiles!suggestions_recommended_owner_fkey(full_name, email)`,
      )
      .eq("status", "open")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // Hydrate call_context for each suggestion that has a related_call_id.
  // Single batch query rather than per-row.
  const callIds = (openSuggestions.data ?? [])
    .map((r) => r.related_call_id)
    .filter((id): id is string => Boolean(id));
  const callMap = new Map<string, any>();
  const transcriptMap = new Map<string, string>();
  const scoreMap = new Map<string, any>();
  if (callIds.length > 0) {
    const [callsRes, chunksRes, scoresRes] = await Promise.all([
      supabase
        .from("call_sessions")
        .select("id, ctm_call_id, caller_phone_normalized, caller_name, started_at, talk_seconds, direction, status, ctm_raw_payload, lead_id")
        .in("id", callIds),
      supabase
        .from("transcript_chunks")
        .select("call_session_id, sequence_number, speaker, content")
        .in("call_session_id", callIds)
        .order("sequence_number", { ascending: true })
        .limit(callIds.length * 8),
      supabase
        .from("call_scores")
        .select(`call_session_id, composite_score, caller_sentiment, needs_supervisor_review,
          qualification_completeness, rapport_and_empathy, objection_handling, urgency_handling,
          next_step_clarity, script_adherence, compliance, booking_or_transfer, overall_quality,
          quality_signals, compliance_flags, coaching_takeaways`)
        .in("call_session_id", callIds),
    ]);
    for (const c of callsRes.data ?? []) callMap.set(c.id, c);
    for (const s of scoresRes.data ?? []) scoreMap.set(s.call_session_id, s);
    // Build a short transcript excerpt per call (first 6 turns, ~500 chars max).
    const byCall = new Map<string, Array<{ sequence_number: number; speaker: string | null; content: string }>>();
    for (const ch of chunksRes.data ?? []) {
      const arr = byCall.get(ch.call_session_id) ?? [];
      if (arr.length < 6) arr.push(ch as any);
      byCall.set(ch.call_session_id, arr);
    }
    for (const [callId, chunks] of byCall.entries()) {
      const lines = chunks.map((c) => `${c.speaker ?? "?"}: ${c.content}`);
      let excerpt = lines.join("\n");
      if (excerpt.length > 500) excerpt = excerpt.slice(0, 500) + "…";
      transcriptMap.set(callId, excerpt);
    }
  }

  const top_recommendations = (openSuggestions.data ?? []).map((row) => {
    const owner = row.owner as { full_name: string | null; email: string | null } | null;
    const call = row.related_call_id ? callMap.get(row.related_call_id) : null;
    const agentRaw = call?.ctm_raw_payload?.agent;
    const repName = agentRaw?.name ?? agentRaw?.email ?? null;
    const transcriptExcerpt = row.related_call_id ? transcriptMap.get(row.related_call_id) ?? null : null;

    const score = row.related_call_id ? scoreMap.get(row.related_call_id) : null;

    const call_context = call ? {
      call_session_id: call.id,
      ctm_call_id: call.ctm_call_id,
      caller_phone: call.caller_phone_normalized,
      caller_name: call.caller_name,
      rep_name: repName,
      call_time: call.started_at,
      duration_seconds: call.talk_seconds,
      talk_seconds: call.talk_seconds,
      direction: call.direction,
      call_status: call.status,
      transcript_excerpt: transcriptExcerpt,
      recording_url: call.ctm_raw_payload?.audio ?? null,
      lead_score: null,
      lead_quality_tier: null,
      score: score ? {
        composite: score.composite_score,
        sentiment: score.caller_sentiment,
        needs_supervisor_review: score.needs_supervisor_review,
        rubric: {
          qualification_completeness: score.qualification_completeness,
          rapport_and_empathy: score.rapport_and_empathy,
          objection_handling: score.objection_handling,
          urgency_handling: score.urgency_handling,
          next_step_clarity: score.next_step_clarity,
          script_adherence: score.script_adherence,
          compliance: score.compliance,
          booking_or_transfer: score.booking_or_transfer,
          overall_quality: score.overall_quality,
        },
        compliance_flags: score.compliance_flags ?? [],
        coaching_takeaways: score.coaching_takeaways ?? null,
        quality_signals: score.quality_signals ?? [],
      } : null,
    } : null;

    return {
      id: row.id,
      type: row.suggestion_type,
      priority: row.priority,
      title: row.title,
      summary: row.summary,
      recommended_action: row.recommended_action ?? "",
      action_owner: owner?.full_name ?? owner?.email ?? "Unassigned",
      reason: row.reasoning ?? "",
      confidence: Number(row.confidence),
      related_lead_id: row.related_lead_id ?? undefined,
      related_rep_id: row.related_rep_id ?? undefined,
      related_call_id: row.related_call_id ?? undefined,
      status: row.status,
      created_at: row.created_at,
      call_context,
    };
  });

  // Compute overloaded reps from the today-call list (count by specialist_id).
  const callsBySpecialist = new Map<string, number>();
  for (const row of (repWorkloadForCapacity.data ?? []) as Array<{ specialist_id: string }>) {
    callsBySpecialist.set(row.specialist_id, (callsBySpecialist.get(row.specialist_id) ?? 0) + 1);
  }
  const overloadedReps = [...callsBySpecialist.values()].filter((n) => n >= 31).length;

  return jsonResponse({
    inbound_calls_today: inboundTodayCount.count ?? 0,
    answered_today: answeredTodayCount.count ?? 0,
    missed_today: missedTodayCount.count ?? 0,
    // Backlog/awaiting/overdue need a CRM tasks table that isn't ported yet.
    callback_backlog: 0,
    leads_awaiting_first_contact: 0,
    overdue_followups: 0,
    attribution_conflicts: conflictsCount.count ?? 0,
    qa_review_queue: supervisorPending.count ?? 0,
    supervisor_review_queue: supervisorPending.count ?? 0,
    rep_capacity_warnings: overloadedReps,
    top_recommendations,
  });
}

// Drill-down handlers for the Operations Overview stat cards.
// Each returns { items: [...], total: N } for the DrillDownPanel.

async function getOpsOverviewInbound(queryString: string): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(params.get("offset") ?? "0", 10) || 0;
  const statusFilter = params.get("status"); // optional: "answered"

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();

  let q = supabase
    .from("call_sessions")
    .select(
      `id, ctm_call_id, status, caller_phone_normalized, caller_name, started_at, talk_seconds, ctm_raw_payload`,
      { count: "exact" },
    )
    .eq("direction", "inbound")
    .gte("started_at", startOfDayISO)
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (statusFilter === "answered") q = q.not("status", "in", "(missed,abandoned,no_answer)");

  const { data, count, error } = await q;
  if (error) return jsonResponse({ error: error.message }, 500);

  const items = (data ?? []).map((c: any) => ({
    call_session_id: c.id,
    ctm_call_id: c.ctm_call_id,
    caller_name: c.caller_name ?? c.caller_phone_normalized ?? "Unknown",
    caller_phone: c.caller_phone_normalized,
    call_time: c.started_at,
    call_status: c.status,
    duration_seconds: c.talk_seconds ?? 0,
    rep_name: c.ctm_raw_payload?.agent?.name ?? c.ctm_raw_payload?.agent?.email ?? null,
  }));
  return jsonResponse({ items, total: count ?? items.length });
}

async function getOpsOverviewMissed(queryString: string): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(params.get("offset") ?? "0", 10) || 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();

  const { data, count, error } = await supabase
    .from("call_sessions")
    .select(
      `id, ctm_call_id, caller_phone_normalized, caller_name, started_at, ctm_raw_payload`,
      { count: "exact" },
    )
    .gte("started_at", startOfDayISO)
    .in("status", ["missed", "abandoned"])
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return jsonResponse({ error: error.message }, 500);

  const items = (data ?? []).map((c: any) => ({
    call_session_id: c.id,
    ctm_call_id: c.ctm_call_id,
    caller_phone: c.caller_phone_normalized,
    caller_name: c.caller_name ?? "Unknown",
    call_time: c.started_at,
    tracking_source: c.ctm_raw_payload?.tracking_label ?? c.ctm_raw_payload?.tracking_source ?? "—",
  }));
  return jsonResponse({ items, total: count ?? items.length });
}

async function getOpsOverviewQAReview(queryString: string): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(params.get("offset") ?? "0", 10) || 0;

  const { data, count, error } = await supabase
    .from("call_scores")
    .select(
      `id, composite_score, needs_supervisor_review, supervisor_signoff_at, compliance_flags,
       call:call_sessions(id, ctm_call_id, ctm_raw_payload)`,
      { count: "exact" },
    )
    .eq("needs_supervisor_review", true)
    .is("supervisor_signoff_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return jsonResponse({ error: error.message }, 500);

  const items = (data ?? []).map((row: any) => {
    const call = Array.isArray(row.call) ? row.call[0] : row.call;
    const flags = Array.isArray(row.compliance_flags) ? row.compliance_flags : [];
    const flagReason = flags.length > 0 ? (flags[0]?.flag ?? "Compliance flag") : "Low composite score";
    return {
      call_session_id: call?.id,
      ctm_call_id: call?.ctm_call_id ?? "—",
      rep_name: call?.ctm_raw_payload?.agent?.name ?? call?.ctm_raw_payload?.agent?.email ?? "Unknown",
      flag_reason: flagReason,
      qa_score_percent: row.composite_score,
      source: "AI score",
    };
  });
  return jsonResponse({ items, total: count ?? items.length });
}

// The "tasks" backed endpoints (callback backlog, awaiting first contact,
// overdue follow-ups) need a CRM tasks table that isn't ported to Supabase
// yet. Return empty lists so the panel shows "no items" instead of 501.
function emptyDrillResponse(): Response {
  return jsonResponse({ items: [], total: 0 });
}

async function signoffFlaggedReview(
  id: string,
  queryString: string,
): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const action = params.get("action");
  const notes = params.get("notes");
  const coachingTopic = params.get("coaching_topic");

  if (!action) {
    return jsonResponse({ error: "Missing action" }, 400);
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  // Pack action and (optional) coaching topic into signoff_notes so they
  // round-trip through the mapper without a schema change.
  const parts = [`[${action}]`];
  if (notes) parts.push(notes);
  if (coachingTopic) parts.push(`Coaching topic: ${coachingTopic}`);

  const { error } = await supabase
    .from("call_scores")
    .update({
      supervisor_signoff_at: new Date().toISOString(),
      supervisor_signoff_by: userId,
      signoff_notes: parts.join("\n"),
    })
    .eq("id", id);

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true });
}

async function resolveAttributionConflict(
  id: string,
  options: RequestInit,
): Promise<Response> {
  let body: { action?: string } = {};
  try {
    body = options.body ? JSON.parse(options.body as string) : {};
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const action = body.action;
  if (action !== "approve" && action !== "reject" && action !== "preserve_first_touch") {
    return jsonResponse({ error: `Unknown attribution action: ${action}` }, 400);
  }

  const { data: existing, error: readError } = await supabase
    .from("attribution_records")
    .select(
      "audit_log, ctm_source_category, ctm_medium, ctm_campaign, normalized_source, normalized_medium, normalized_campaign",
    )
    .eq("id", id)
    .maybeSingle();

  if (readError) return jsonResponse({ error: readError.message }, 500);
  if (!existing) return jsonResponse({ error: "Not found" }, 404);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const existingLog =
    typeof existing.audit_log === "object" && existing.audit_log !== null
      ? (existing.audit_log as Record<string, unknown>)
      : {};
  const priorResolutions = Array.isArray(existingLog.resolutions) ? existingLog.resolutions : [];
  const newResolution = {
    action,
    resolved_by: userId,
    resolved_at: new Date().toISOString(),
  };

  const update: Record<string, unknown> = {
    has_conflict: false,
    audit_log: { ...existingLog, resolutions: [...priorResolutions, newResolution] },
  };

  if (action === "approve") {
    update.normalized_source = existing.ctm_source_category;
    update.normalized_medium = existing.ctm_medium;
    update.normalized_campaign = existing.ctm_campaign;
  }

  const { error: writeError } = await supabase
    .from("attribution_records")
    .update(update)
    .eq("id", id);

  if (writeError) return jsonResponse({ error: writeError.message }, 500);
  return jsonResponse({ ok: true });
}

async function actOnSuggestion(id: string, action: string): Promise<Response> {
  if (action !== "acknowledge" && action !== "dismiss" && action !== "act") {
    return jsonResponse({ error: `Unknown suggestion action: ${action}` }, 400);
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  const now = new Date().toISOString();

  // Special-case: 'act' on assign_training_for_weakness suggestions routes
  // through the approve-suggestion Edge Function, which creates the
  // training_assignment + marks the suggestion completed atomically.
  if (action === "act") {
    const { data: sug } = await supabase
      .from("suggestions")
      .select("suggestion_type")
      .eq("id", id)
      .maybeSingle();
    if (sug?.suggestion_type === "assign_training_for_weakness") {
      const { data: invokeData, error: invokeErr } = await supabase.functions.invoke("approve-suggestion", {
        body: { suggestion_id: id, approver_id: userId },
      });
      if (invokeErr) return jsonResponse({ error: invokeErr.message }, 500);
      if (!invokeData?.ok) return jsonResponse({ error: invokeData?.error ?? "approve-suggestion failed", details: invokeData }, 400);
      return jsonResponse({ ok: true, ...invokeData });
    }
  }

  const update: Record<string, unknown> =
    action === "acknowledge"
      ? { status: "acknowledged", acknowledged_by: userId, acknowledged_at: now }
      : action === "dismiss"
        ? { status: "dismissed", dismissed_by: userId, dismissed_at: now }
        : { status: "completed", completed_by: userId, completed_at: now };

  const { error } = await supabase
    .from("suggestions")
    .update(update)
    .eq("id", id);

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true });
}

async function getRepWorkload(): Promise<Response> {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["specialist", "manager"])
    .eq("is_active", true)
    .order("full_name");
  if (error) return jsonResponse({ error: error.message }, 500);

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();
  const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fortyEightHoursAgoISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const reps: RepWorkloadData[] = await Promise.all((profiles ?? []).map(async (p) => {
    const [
      { count: callsToday },
      { count: missedToday },
      { count: missedBacklog },
      qaScoresRes,
      recentCallsRes,
    ] = await Promise.all([
      supabase
        .from("call_sessions")
        .select("id", { count: "exact", head: true })
        .eq("specialist_id", p.id)
        .gte("started_at", startOfDayISO),
      supabase
        .from("call_sessions")
        .select("id", { count: "exact", head: true })
        .eq("specialist_id", p.id)
        .in("status", ["missed", "abandoned"])
        .gte("started_at", startOfDayISO),
      supabase
        .from("call_sessions")
        .select("id", { count: "exact", head: true })
        .eq("specialist_id", p.id)
        .in("status", ["missed", "abandoned"])
        .gte("started_at", fortyEightHoursAgoISO),
      // QA trend: avg composite over last 7d
      supabase
        .from("call_scores")
        .select("composite_score, call:call_sessions!inner(specialist_id, started_at)")
        .eq("call.specialist_id", p.id)
        .gte("call.started_at", sevenDaysAgoISO),
      // Recent calls to estimate open leads (distinct lead_ids touched in last 7d)
      supabase
        .from("call_sessions")
        .select("lead_id")
        .eq("specialist_id", p.id)
        .not("lead_id", "is", null)
        .gte("started_at", sevenDaysAgoISO),
    ]);

    const qaVals = ((qaScoresRes.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
    const qaTrend = qaVals.length > 0 ? Math.round(qaVals.reduce((a, b) => a + b, 0) / qaVals.length) : null;

    const distinctLeads = new Set(((recentCallsRes.data ?? []) as any[]).map((r) => r.lead_id).filter(Boolean));

    // Capacity heuristic: 0 calls = idle, 1-15 = active, 16-30 = busy, 31+ = overloaded
    const todayCount = callsToday ?? 0;
    const capacity_status = todayCount === 0 ? "idle" : todayCount < 16 ? "active" : todayCount < 31 ? "busy" : "overloaded";
    const capacity_score = Math.min(100, Math.round((todayCount / 30) * 100));

    const suggested_actions: string[] = [];
    if ((missedBacklog ?? 0) > 0) suggested_actions.push(`Return ${missedBacklog} missed call${missedBacklog === 1 ? "" : "s"} from last 48h`);
    if (qaTrend != null && qaTrend < 50) suggested_actions.push(`QA trend (${qaTrend}) below threshold — review with manager`);
    if (capacity_status === "overloaded") suggested_actions.push("Capacity overloaded — consider re-routing");

    return {
      rep_id: p.id,
      rep_name: p.full_name ?? p.email ?? "Unknown",
      calls_today: todayCount,
      missed_calls: missedToday ?? 0,
      open_leads: distinctLeads.size,
      overdue_callbacks: missedBacklog ?? 0,
      capacity_status,
      capacity_score,
      first_contact_sla_backlog: missedBacklog ?? 0,
      qa_trend: qaTrend,
      avg_callback_speed_minutes: null,
      suggested_actions,
    };
  }));

  return jsonResponse({ reps });
}

// CTM Call Log handler: paginated list of call_sessions, shaped for the
// existing /ctm-calls page.
async function getCTMCalls(queryString: string): Promise<Response> {
  const params = new URLSearchParams(queryString);
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(params.get("offset") ?? "0", 10) || 0;
  const direction = params.get("direction");
  const startDate = params.get("start_date");
  const endDate = params.get("end_date");
  // status filter: "missed" (missed/abandoned), "completed", "ringing",
  // "in_progress", or comma-list. Drives drill-throughs from dashboards.
  const status = params.get("status");
  // has_transcript=true filters to calls where the CTM payload has transcription_text.
  const hasTranscript = params.get("has_transcript");

  let q = supabase
    .from("call_sessions")
    .select(`
      id, ctm_call_id, direction, status, caller_phone_normalized, caller_name,
      ctm_tracking_number, started_at, ended_at, talk_seconds, ring_seconds,
      ctm_raw_payload, lead_id,
      score:call_scores(composite_score, needs_supervisor_review)
    `, { count: "exact" })
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (direction && direction !== "all") q = q.eq("direction", direction);
  if (status && status !== "all") {
    if (status === "missed") q = q.in("status", ["missed", "abandoned"]);
    else if (status.includes(",")) q = q.in("status", status.split(",").map((s) => s.trim()).filter(Boolean));
    else q = q.eq("status", status);
  }
  if (hasTranscript === "true") q = q.not("ctm_raw_payload->>transcription_text", "is", null);
  if (startDate) q = q.gte("started_at", startDate);
  if (endDate) {
    // Frontend sends "yyyy-MM-dd" date strings; append end-of-day so calls
    // landing today aren't excluded by Postgres reading the bare date as
    // midnight (start of day).
    const endIso = /T\d/.test(endDate) ? endDate : `${endDate}T23:59:59.999Z`;
    q = q.lte("started_at", endIso);
  }

  const { data, error, count } = await q;
  if (error) return jsonResponse({ error: error.message }, 500);

  const calls = (data ?? []).map((c: any) => {
    const score = Array.isArray(c.score) ? c.score[0] : c.score;
    const audio = c.ctm_raw_payload?.audio;
    const transcript = c.ctm_raw_payload?.transcription_text;
    return {
      id: c.id,
      ctm_call_id: c.ctm_call_id,
      direction: c.direction,
      call_status: c.status,
      caller_phone: c.caller_phone_normalized ?? "",
      caller_name: c.caller_name ?? "",
      tracking_number: c.ctm_tracking_number ?? "",
      tracking_label: c.ctm_raw_payload?.tracking_label ?? "",
      answering_ctm_user_id: c.ctm_raw_payload?.agent_id ?? "",
      agent_name: c.ctm_raw_payload?.agent?.name ?? c.ctm_raw_payload?.agent?.email ?? (typeof c.ctm_raw_payload?.agent === "string" ? c.ctm_raw_payload.agent : null),
      start_time: c.started_at,
      end_time: c.ended_at,
      total_duration_seconds: (c.talk_seconds ?? 0) + (c.ring_seconds ?? 0),
      talk_duration_seconds: c.talk_seconds ?? 0,
      missed_call_flag: c.status === "missed" || c.status === "abandoned",
      has_recording: Boolean(audio),
      has_transcript: Boolean(transcript),
      recording_url: audio ?? "",
      transcript_preview: transcript ? String(transcript).slice(0, 200) : "",
      zoho_lead_id: "",
      source_event_type: "webhook",
      lead_score: null,
      lead_quality_tier: null,
      call_score_total: score?.composite_score ?? null,
      qa_status: score?.needs_supervisor_review ? "review" : (score?.composite_score != null ? "pass" : null),
      conversion_probability: null,
      hot_lead_flag: null,
    };
  });

  return jsonResponse({ calls, total: count ?? calls.length, limit, offset });
}

// Single-call detail for the expand row.
async function getCTMCallDetail(ctmCallId: string): Promise<Response> {
  const { data: call, error } = await supabase
    .from("call_sessions")
    .select(`
      id, ctm_call_id, direction, status, caller_phone_normalized, caller_name,
      ctm_tracking_number, started_at, ended_at, talk_seconds, ring_seconds, ctm_raw_payload,
      score:call_scores(composite_score, caller_sentiment, needs_supervisor_review,
        qualification_completeness, rapport_and_empathy, objection_handling, urgency_handling,
        next_step_clarity, script_adherence, compliance, booking_or_transfer, overall_quality,
        coaching_takeaways, compliance_flags)
    `)
    .eq("ctm_call_id", ctmCallId)
    .maybeSingle();
  if (error) return jsonResponse({ error: error.message }, 500);
  if (!call) return jsonResponse({ error: "not found" }, 404);

  const score = Array.isArray(call.score) ? call.score[0] : call.score;
  const audio = call.ctm_raw_payload?.audio;
  const transcript = call.ctm_raw_payload?.transcription_text;

  const { data: chunks } = await supabase
    .from("transcript_chunks")
    .select("sequence_number, speaker, content")
    .eq("call_session_id", call.id)
    .order("sequence_number", { ascending: true });

  return jsonResponse({
    call: {
      id: call.id,
      ctm_call_id: call.ctm_call_id,
      direction: call.direction,
      call_status: call.status,
      caller_phone: call.caller_phone_normalized,
      caller_name: call.caller_name,
      tracking_number: call.ctm_tracking_number,
      agent_name: call.ctm_raw_payload?.agent?.name ?? call.ctm_raw_payload?.agent?.email ?? (typeof call.ctm_raw_payload?.agent === "string" ? call.ctm_raw_payload.agent : null),
      start_time: call.started_at,
      end_time: call.ended_at,
      talk_duration_seconds: call.talk_seconds,
      total_duration_seconds: (call.talk_seconds ?? 0) + (call.ring_seconds ?? 0),
      recording_url: audio ?? "",
      transcript_text: transcript ?? "",
      transcript_chunks: chunks ?? [],
      zoho_lead_id: "",
    },
    analysis: score ? {
      agent_score: {
        percentage: score.composite_score,
        qa_status: score.needs_supervisor_review ? "review" : (score.composite_score >= 60 ? "pass" : "fail"),
      },
      categories: {
        qualification: score.qualification_completeness,
        rapport: score.rapport_and_empathy,
        objection: score.objection_handling,
        urgency: score.urgency_handling,
        next_step: score.next_step_clarity,
        script: score.script_adherence,
        compliance: score.compliance,
        booking: score.booking_or_transfer,
        overall: score.overall_quality,
      },
      caller_sentiment: score.caller_sentiment,
      coaching_takeaways: score.coaching_takeaways,
      compliance_flags: score.compliance_flags,
    } : null,
  });
}

// CTM Stats: counters for the page header.
async function getCTMStats(): Promise<Response> {
  const sinceISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: total }, { count: pending }, inboundRes, outboundRes, missedRes, withRecRes, withTransRes] = await Promise.all([
    supabase.from("call_sessions").select("id", { count: "exact", head: true }).gte("created_at", sinceISO),
    supabase.from("call_scores").select("id", { count: "exact", head: true }).eq("needs_supervisor_review", true).is("supervisor_signoff_at", null),
    supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", sinceISO),
    supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("direction", "outbound").gte("created_at", sinceISO),
    supabase.from("call_sessions").select("id", { count: "exact", head: true }).in("status", ["missed", "abandoned"]).gte("created_at", sinceISO),
    supabase.from("call_sessions").select("id", { count: "exact", head: true }).not("ctm_raw_payload->>audio", "is", null).gte("created_at", sinceISO),
    supabase.from("call_sessions").select("id", { count: "exact", head: true }).not("ctm_raw_payload->>transcription_text", "is", null).gte("created_at", sinceISO),
  ]);
  const { count: agents } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true).in("role", ["specialist", "manager"]);

  return jsonResponse({
    total_calls: total ?? 0,
    total_agents: agents ?? 0,
    pending_reviews: pending ?? 0,
    calls_by_direction: {
      inbound: inboundRes.count ?? 0,
      outbound: outboundRes.count ?? 0,
      missed: missedRes.count ?? 0,
    },
    enrichment: {
      calls_with_recording: withRecRes.count ?? 0,
      calls_with_transcript: withTransRes.count ?? 0,
    },
  });
}

// Route table: incoming `/ops/...` path -> handler that returns a fake Response.
// Add an entry here as each endpoint is ported to Supabase. Anything not
// matched falls through to a 501 stub.
async function routeApiPath(
  path: string,
  options: RequestInit,
): Promise<Response | null> {
  // Strip query string for matching; individual handlers parse it themselves.
  const [pathOnly, queryString = ""] = path.split("?");
  switch (pathOnly) {
    case "/ops/rep-workload":
    case "/ops/workload":
      return getRepWorkload();
    case "/ops/suggestions":
      return getSuggestions(queryString);
    case "/ops/attribution-conflicts":
      return getAttributionConflicts();
    case "/ops/flagged-reviews":
      return getFlaggedReviews(queryString);
    case "/ops/flagged-reviews/stats":
      return getFlaggedReviewStats();
    case "/ops/overview":
      return getOpsOverview();
    case "/ops/overview/inbound":
      return getOpsOverviewInbound(queryString);
    case "/ops/overview/missed":
      return getOpsOverviewMissed(queryString);
    case "/ops/overview/qa-review-queue":
    case "/ops/overview/supervisor-review-queue":
      return getOpsOverviewQAReview(queryString);
    case "/ops/overview/callback-backlog":
    case "/ops/overview/awaiting-first-contact":
    case "/ops/overview/overdue-followups":
      return emptyDrillResponse();
    case "/ctm-admin/calls":
      return getCTMCalls(queryString);
    case "/ctm-admin/stats":
      return getCTMStats();
    default: {
      const ctmDetailMatch = pathOnly.match(/^\/ctm-admin\/calls\/([^/]+)$/);
      if (ctmDetailMatch) return getCTMCallDetail(ctmDetailMatch[1]);

      // Backfill / enrichment endpoints — these are no-ops in the new
      // architecture (CTM webhooks push directly), so respond OK with
      // a friendly message instead of 501-ing.
      if (pathOnly === "/ctm-admin/backfill" || pathOnly === "/ctm-admin/enrich-pending"
          || pathOnly.startsWith("/ctm-admin/enrich/")) {
        return jsonResponse({ ok: true, message: "Webhook ingest is real-time; no manual backfill needed." });
      }

      const signoffMatch = pathOnly.match(/^\/ops\/flagged-reviews\/([^/]+)\/signoff$/);
      if (signoffMatch) return signoffFlaggedReview(signoffMatch[1], queryString);

      const detailMatch = pathOnly.match(/^\/ops\/flagged-reviews\/([^/]+)$/);
      if (detailMatch) return getFlaggedReviewById(detailMatch[1]);

      const suggestionActionMatch = pathOnly.match(
        /^\/ops\/suggestions\/([^/]+)\/(acknowledge|dismiss|act)$/,
      );
      if (suggestionActionMatch) {
        return actOnSuggestion(suggestionActionMatch[1], suggestionActionMatch[2]);
      }

      const attributionResolveMatch = pathOnly.match(
        /^\/ops\/attribution-conflicts\/([^/]+)\/resolve$/,
      );
      if (attributionResolveMatch) {
        return resolveAttributionConflict(attributionResolveMatch[1], options);
      }

      return null;
    }
  }
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const routed = await routeApiPath(path, options);
  if (routed) return routed;
  // Endpoint not yet ported — return an empty 501 so UI shows empty state
  // instead of throwing. Each unported path will be added to routeApiPath above.
  return jsonResponse(
    { error: `Endpoint ${path} not yet ported to Supabase` },
    501,
  );
}
