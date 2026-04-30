import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

interface UsePollingOptions {
  interval?: number;
  enabled?: boolean;
}

export function usePollingFetch<T>(path: string, options: UsePollingOptions = {}) {
  const { interval = 30000, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch(path);
      if (!mountedRef.current) return;
      if (res.ok) {
        setData(await res.json());
        setError(null);
      } else {
        setError(`Failed to fetch: ${res.status}`);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e.message || "Network error");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchData();
    let timer: ReturnType<typeof setInterval> | null = null;
    if (interval > 0) {
      timer = setInterval(fetchData, interval);
    }
    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}

export interface OpsOverviewData {
  inbound_calls_today: number;
  answered_today: number;
  missed_today: number;
  callback_backlog: number;
  leads_awaiting_first_contact: number;
  overdue_followups: number;
  attribution_conflicts: number;
  qa_review_queue: number;
  supervisor_review_queue: number;
  rep_capacity_warnings: number;
  top_recommendations: OpsRecommendation[];
}

export interface OpsRecommendation {
  id: number;
  type: string;
  priority: string;
  title: string;
  summary: string;
  recommended_action: string;
  action_owner: string;
  reason: string;
  confidence: number;
  related_lead_id?: string;
  related_rep_id?: string;
  related_call_id?: string;
  status: string;
  created_at: string;
  call_context?: CallContext | null;
}

export interface CallContext {
  caller_name?: string | null;
  caller_phone?: string | null;
  caller_city?: string | null;
  caller_state?: string | null;
  direction?: string | null;
  call_status?: string | null;
  call_time?: string | null;
  duration_seconds?: number | null;
  talk_seconds?: number | null;
  rep_name?: string | null;
  tracking_label?: string | null;
  transcript_excerpt?: string | null;
  recording_url?: string | null;
  zoho_lead_id?: string | null;
  lead_score?: number | null;
  lead_quality_tier?: string | null;
}

export interface OpsSuggestion {
  id: number;
  type: string;
  priority: string;
  title: string;
  summary: string;
  recommended_action: string;
  action_owner: string;
  reason: string;
  confidence: number;
  related_lead_id?: string;
  related_rep_id?: string;
  related_call_id?: string;
  status: string;
  created_at: string;
  call_context?: CallContext | null;
}

export interface RepWorkloadData {
  rep_id: string;
  rep_name: string;
  calls_today: number;
  missed_calls: number;
  open_leads: number;
  overdue_callbacks: number;
  first_contact_sla_backlog: number;
  qa_trend: number | null;
  avg_callback_speed_minutes: number | null;
  capacity_score: number;
  capacity_status: string;
  suggested_actions: string[];
}

export interface AttributionConflict {
  id: number;
  ctm_call_id: string;
  ctm_source: string;
  ctm_medium: string;
  ctm_campaign: string;
  zoho_source: string;
  zoho_medium: string;
  zoho_campaign: string;
  conflict_reason: string;
  proposed_correction: string;
  status: string;
  created_at: string;
}

export interface AnswerProposal {
  text: string | null;
  confidence: number;
  status: string;
  source_ids?: number[];
  source_titles?: string[];
  examples?: { caller: string; rep: string; call_id: string }[];
  pattern_summary?: string | null;
  next_best_question?: string | null;
  caution_notes?: string | null;
}

export interface AnswerProposals {
  has_proposals: boolean;
  generation_attempted: boolean;
  kb_answer: AnswerProposal | null;
  transcript_answer: AnswerProposal | null;
  merged_answer: AnswerProposal | null;
}

export interface KnowledgeItem {
  id: number;
  type: string;
  title: string;
  frequency: number;
  last_seen: string;
  draft_article?: {
    id: number;
    title: string;
    content: string;
    confidence: number;
    status: string;
  };
  status: string;
  answer_proposals?: AnswerProposals | null;
}

export function useOpsOverview(options?: UsePollingOptions) {
  return usePollingFetch<OpsOverviewData>("/ops/overview", options);
}

export function useOpsSuggestions(params?: { type?: string; priority?: string; status?: string; rep?: string }, options?: UsePollingOptions) {
  const query = new URLSearchParams();
  if (params?.type && params.type !== "all") query.set("type", params.type);
  if (params?.priority && params.priority !== "all") query.set("priority", params.priority);
  if (params?.status && params.status !== "all") query.set("status", params.status);
  if (params?.rep && params.rep !== "all") query.set("rep", params.rep);
  const qs = query.toString();
  return usePollingFetch<{ suggestions: OpsSuggestion[]; total: number }>(`/ops/suggestions${qs ? `?${qs}` : ""}`, options);
}

export function useRepWorkload(options?: UsePollingOptions & { date?: string }) {
  const datePart = options?.date ? `?date=${options.date}` : "";
  return usePollingFetch<{ reps: RepWorkloadData[]; date?: string }>(`/ops/rep-workload${datePart}`, options);
}

export function useAttributionConflicts(options?: UsePollingOptions) {
  return usePollingFetch<{ conflicts: AttributionConflict[]; total: number }>("/ops/attribution-conflicts", options);
}

export function useKnowledgeItems(options?: UsePollingOptions) {
  return usePollingFetch<{ items: KnowledgeItem[]; total: number }>("/ops/knowledge-review", options);
}

export async function fetchDrillDownData(
  path: string,
  limit?: number,
  offset?: number,
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const separator = path.includes("?") ? "&" : "?";
  let url = path;
  if (limit !== undefined) url += `${separator}limit=${limit}`;
  if (offset !== undefined) url += `${url.includes("?") ? "&" : "?"}offset=${offset}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const data = await res.json();
  const items = data.items || data.conflicts || data.reps || [];
  const total = data.total ?? items.length;
  return { items, total };
}

export async function actOnSuggestion(id: number, action: "acknowledge" | "dismiss" | "act") {
  return apiFetch(`/ops/suggestions/${id}/${action}`, { method: "POST" });
}

export async function resolveAttribution(id: number, action: "approve" | "reject" | "preserve_first_touch") {
  return apiFetch(`/ops/attribution-conflicts/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export async function resolveKnowledgeItem(id: number, action: "approve" | "edit" | "reject" | "approve-kb" | "approve-transcript" | "approve-merged") {
  return apiFetch(`/ops/knowledge-review/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export async function generateKnowledgeProposals(id: number) {
  return apiFetch(`/ops/knowledge-review/${id}/generate-proposals`, {
    method: "POST",
  });
}

export interface FlaggedReview {
  id: number;
  ctm_call_id: string;
  zoho_lead_id: string | null;
  rep_id: string | null;
  rep_name: string | null;
  qa_score_percent: number | null;
  poor_sentiment_flag: boolean;
  review_priority: string;
  review_reasons: Array<{ reason: string; detail: string }>;
  concerns: Array<{
    concern_type: string;
    severity: string;
    explanation: string;
    supporting_evidence?: string;
    related_qa_category?: string;
  }>;
  issue_locations: Array<{
    concern_type: string;
    guidance: string;
    found_in_transcript: boolean;
    matches?: Array<{ position: number; timestamp: string; speaker: string; snippet: string }>;
  }>;
  qa_breakdown: {
    overall_score?: number;
    passed?: boolean;
    auto_fail?: boolean;
    auto_fail_reasons?: string[];
    category_scores?: Record<string, number>;
    script_adherence_score?: number;
    objection_handling_score?: number;
    zoho_completeness_score?: number;
  };
  sentiment_markers: Array<{ type: string; indicator?: string; detail?: string; context_snippet?: string }>;
  coaching_recommendations: Array<{ source: string; recommendation: string; concern_type?: string }>;
  status: string;
  supervisor_review_required: boolean;
  supervisor_assigned_to: string | null;
  supervisor_notes: string | null;
  supervisor_signoff_at: string | null;
  supervisor_action: string | null;
  coaching_required_flag: boolean;
  compliance_flag: boolean;
  score_correction_required_flag: boolean;
  escalation_flag: boolean;
  coaching_topic: string | null;
  transcript_text: string | null;
  recording_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FlaggedReviewStats {
  pending: number;
  high_priority: number;
  coaching_scheduled: number;
  compliance_flags: number;
  signed_off_today: number;
  total: number;
}

export function useFlaggedReviews(options?: UsePollingOptions & { status?: string }) {
  const status = options?.status || "pending";
  return usePollingFetch<{ items: FlaggedReview[]; total: number; pending_count: number; high_priority_count: number }>(
    `/ops/flagged-reviews?status=${status}&limit=50`,
    options
  );
}

export function useFlaggedReviewStats(options?: UsePollingOptions) {
  return usePollingFetch<FlaggedReviewStats>("/ops/flagged-reviews/stats", options);
}

export async function signoffFlaggedReview(
  id: number,
  action: string,
  notes?: string,
  coachingTopic?: string,
) {
  const params = new URLSearchParams({ action });
  if (notes) params.set("notes", notes);
  if (coachingTopic) params.set("coaching_topic", coachingTopic);
  return apiFetch(`/ops/flagged-reviews/${id}/signoff?${params.toString()}`, {
    method: "POST",
  });
}

export async function getFlaggedReviewDetail(id: number): Promise<FlaggedReview | null> {
  const res = await apiFetch(`/ops/flagged-reviews/${id}`);
  if (res.ok) return res.json();
  return null;
}
