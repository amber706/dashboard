// Lightweight HIPAA audit-log client. Calls the log_audit() RPC on the
// server, which stamps in auth.uid() so the user identity can't be spoofed.
// Failures are swallowed — auditing should never break the user flow,
// and missing rows show up in /admin/audit if anyone notices.
//
// Usage:
//   useAuditView("lead", leadId);
//   useAuditView("call_session", callId, { with_transcript: true });
//   logAudit("export", "leads", null, { format: "csv", count: 412 });

import { useEffect } from "react";
import { supabase } from "./supabase";

export type AuditAction =
  | "view" | "edit" | "export" | "delete" | "search" | "approve" | "reject" | "resolve"
  // Namespaced actions (resource encoded in the prefix) logged via the 2-arg
  // logAudit(action, details) form — see the overload below.
  | "lead_document.upload" | "lead_document.download" | "lead_document.delete"
  | "intake.status"
  | "training_paths.create" | "training_paths.update"
  | "training_paths.publish_toggle" | "training_paths.assign";
export type AuditResource =
  | "lead" | "call_session" | "transcript" | "kb_document" | "kb_draft"
  | "training_assignment" | "training_session" | "audit_log"
  | "leads" | "calls" | "callbacks" | "outcomes" | "ai_bot_feedback"
  | "coaching_feed" | "specialist";

// Actions that encode their resource in the dotted prefix (e.g.
// "lead_document.upload"). These are logged with the (action, details) form;
// the resource_type sent to the RPC is derived from the prefix.
type NamespacedAction = Extract<AuditAction, `${string}.${string}`>;

// Overloads:
//   logAudit("view", "lead", leadId, { ... })          ← classic 4-arg form
//   logAudit("lead_document.upload", { lead_id, ... })  ← namespaced 2-arg form
export async function logAudit(
  action: NamespacedAction,
  details?: Record<string, unknown> | null,
): Promise<void>;
export async function logAudit(
  action: AuditAction,
  resource_type: AuditResource,
  resource_id?: string | null,
  details?: Record<string, unknown> | null,
): Promise<void>;
export async function logAudit(
  action: AuditAction,
  resourceOrDetails?: AuditResource | Record<string, unknown> | null,
  resource_id?: string | null,
  details?: Record<string, unknown> | null,
): Promise<void> {
  // Disambiguate the two forms: a string second arg is the classic
  // resource_type; anything else (object / null / omitted) is the namespaced
  // details form, where the resource_type is the action's dotted prefix.
  let p_resource_type: string | null;
  let p_resource_id: string | null;
  let p_details: Record<string, unknown> | null;
  if (typeof resourceOrDetails === "string") {
    p_resource_type = resourceOrDetails;
    p_resource_id = resource_id ?? null;
    p_details = details ?? null;
  } else {
    p_resource_type = action.includes(".") ? action.split(".")[0] : null;
    p_resource_id = null;
    p_details = resourceOrDetails ?? null;
  }
  try {
    await supabase.rpc("log_audit", {
      p_action: action,
      p_resource_type,
      p_resource_id,
      p_details,
    });
  } catch {
    // Intentionally swallowed.
  }
}

// Convenience hook: log a "view" event once per resource_id when a page
// mounts or the id changes. Skips when id is empty.
export function useAuditView(
  resource_type: AuditResource,
  resource_id: string | undefined | null,
  details?: Record<string, unknown> | null,
): void {
  useEffect(() => {
    if (!resource_id) return;
    logAudit("view", resource_type, resource_id, details);
    // Only refire when the id changes — details object identity churn
    // would otherwise log every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource_type, resource_id]);
}
