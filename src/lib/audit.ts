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

export type AuditAction = "view" | "edit" | "export" | "delete" | "search" | "approve" | "reject" | "resolve";
export type AuditResource =
  | "lead" | "call_session" | "transcript" | "kb_document" | "kb_draft"
  | "training_assignment" | "training_session" | "audit_log"
  | "leads" | "calls" | "callbacks" | "outcomes" | "ai_bot_feedback"
  | "coaching_feed" | "specialist";

export async function logAudit(
  action: AuditAction,
  resource_type: AuditResource,
  resource_id?: string | null,
  details?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await supabase.rpc("log_audit", {
      p_action: action,
      p_resource_type: resource_type,
      p_resource_id: resource_id ?? null,
      p_details: details ?? null,
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
