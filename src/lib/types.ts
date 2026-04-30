export type SuggestionType =
  | "assign_lead"
  | "schedule_callback"
  | "preserve_owner"
  | "review_attribution"
  | "supervisor_review"
  | "missed_call_callback"
  | "urgent_high_intent_lead"
  | "reassign_due_to_overload"
  | "poor_call_needs_supervisor_review"
  | "attribution_conflict_review"
  | "new_kb_draft_ready_for_approval"
  | "task_overdue"
  | "lead_missing_required_fields";

export type Priority = "critical" | "high" | "medium" | "low";

export type RepAvailability = "available" | "on_call" | "away" | "offline" | "busy";

export interface Suggestion {
  id: number;
  suggestion_id: string;
  type: SuggestionType;
  priority: Priority;
  title: string;
  summary: string;
  reasoning: string | null;
  related_call_id: string | null;
  related_lead_id: string | null;
  related_rep_id: string | null;
  recommended_action: string | null;
  recommended_owner: string | null;
  recommended_due: string | null;
  confidence: number;
  source_signals_json: any[] | null;
  status: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  completed_by: string | null;
  completed_at: string | null;
  completed_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SuggestionListResponse {
  items: Suggestion[];
  total: number;
  page: number;
  per_page: number;
}

export interface RepWorkload {
  id: number;
  rep_id: string;
  rep_name: string | null;
  calls_today: number;
  open_leads: number;
  overdue_callbacks: number;
  avg_speed_to_first_contact_min: number;
  active_tasks: number;
  qa_average: number;
  availability_score: number;
  availability_status: string;
  workload_score: number;
  overloaded: boolean;
  snapshot_at: string | null;
}

export interface TodayMetrics {
  inboundToday: number;
  missedToday: number;
  callbackBacklog: number;
  leadsAwaitingFirstContact: number;
  attributionConflicts: number;
  poorCallsNeedingReview: number;
}

export interface AttentionItem {
  count: number;
  label: string;
  type: "critical" | "warning" | "info";
}

export interface OpsMetricsSnapshot {
  id: number;
  period_start: string;
  period_end: string;
  period_label: string | null;
  inbound_calls: number;
  missed_calls: number;
  answered_calls: number;
  avg_answer_time_sec: number;
  avg_callback_delay_min: number;
  leads_awaiting_first_contact: number;
  overdue_follow_ups: number;
  conversion_by_source_json: Record<string, any> | null;
  conversion_by_rep_json: Record<string, any> | null;
  total_suggestions_generated: number;
  suggestions_completed: number;
  suggestions_dismissed: number;
  snapshot_at: string | null;
}

export function getSuggestionTypeLabel(type: SuggestionType): string {
  const labels: Record<string, string> = {
    assign_lead: "Assign Lead",
    schedule_callback: "Schedule Callback",
    preserve_owner: "Preserve Owner",
    review_attribution: "Attribution Review",
    supervisor_review: "Supervisor Review",
    missed_call_callback: "Missed Call Callback",
    urgent_high_intent_lead: "Urgent High-Intent Lead",
    reassign_due_to_overload: "Reassign (Overload)",
    poor_call_needs_supervisor_review: "Supervisor Review",
    attribution_conflict_review: "Attribution Conflict",
    new_kb_draft_ready_for_approval: "KB Draft Approval",
    task_overdue: "Task Overdue",
    lead_missing_required_fields: "Missing Fields",
  };
  return labels[type] ?? type;
}

export function getPriorityOrder(p: Priority): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[p];
}

export function metricsFromSnapshot(snapshot: OpsMetricsSnapshot): TodayMetrics {
  return {
    inboundToday: snapshot.inbound_calls,
    missedToday: snapshot.missed_calls,
    callbackBacklog: snapshot.overdue_follow_ups,
    leadsAwaitingFirstContact: snapshot.leads_awaiting_first_contact,
    attributionConflicts: 0,
    poorCallsNeedingReview: 0,
  };
}

export function attentionItemsFromMetrics(metrics: TodayMetrics): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (metrics.missedToday > 0)
    items.push({ count: metrics.missedToday, label: "missed calls need callbacks", type: "critical" });
  if (metrics.attributionConflicts > 0)
    items.push({ count: metrics.attributionConflicts, label: "attribution conflicts to resolve", type: "warning" });
  if (metrics.poorCallsNeedingReview > 0)
    items.push({ count: metrics.poorCallsNeedingReview, label: "calls flagged for quality review", type: "warning" });
  if (metrics.leadsAwaitingFirstContact > 5)
    items.push({ count: metrics.leadsAwaitingFirstContact, label: "leads awaiting first contact", type: "info" });
  if (metrics.callbackBacklog > 5)
    items.push({ count: metrics.callbackBacklog, label: "callbacks in the backlog", type: "info" });
  return items;
}
