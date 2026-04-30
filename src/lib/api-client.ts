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

// Route table: incoming `/ops/...` path -> handler that returns a fake Response.
// Add an entry here as each endpoint is ported to Supabase. Anything not
// matched falls through to a 501 stub.
async function routeApiPath(
  path: string,
  _options: RequestInit,
): Promise<Response | null> {
  // Strip query string for matching; individual handlers parse it themselves.
  const [pathOnly] = path.split("?");
  switch (pathOnly) {
    case "/ops/rep-workload":
    case "/ops/workload":
      return getRepWorkload();
    case "/ops/overview":
      return jsonResponse({
        inbound_calls_today: 0,
        missed_today: 0,
        callback_backlog: 0,
        leads_awaiting_first_contact: 0,
        attribution_conflicts: 0,
        qa_review_queue: 0,
        flagged_review_queue: 0,
      });
    default:
      return null;
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
