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
  const [conflictsCount, supervisorPending, openSuggestions] = await Promise.all([
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

  const top_recommendations = (openSuggestions.data ?? []).map((row) => {
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

  return jsonResponse({
    inbound_calls_today: 0,
    answered_today: 0,
    missed_today: 0,
    callback_backlog: 0,
    leads_awaiting_first_contact: 0,
    overdue_followups: 0,
    attribution_conflicts: conflictsCount.count ?? 0,
    qa_review_queue: supervisorPending.count ?? 0,
    supervisor_review_queue: supervisorPending.count ?? 0,
    rep_capacity_warnings: 0,
    top_recommendations,
  });
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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "specialist")
    .eq("is_active", true)
    .order("full_name");
  if (error) return jsonResponse({ error: error.message }, 500);

  const reps: RepWorkloadData[] = (data ?? []).map((p) => ({
    rep_id: p.id,
    rep_name: p.full_name ?? p.email ?? "Unknown",
    calls_today: 0,
    missed_calls: 0,
    open_leads: 0,
    overdue_callbacks: 0,
    capacity_status: "idle",
    capacity_score: 0,
    first_contact_sla_backlog: 0,
    qa_trend: null,
    avg_callback_speed_minutes: null,
    suggested_actions: [],
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
  if (startDate) q = q.gte("started_at", startDate);
  if (endDate) q = q.lte("started_at", endDate);

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
