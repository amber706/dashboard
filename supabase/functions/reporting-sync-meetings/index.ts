// reporting-sync-meetings — Phase 1B sync edge function.
//
// Pulls Zoho CRM Events module incrementally via COQL and upserts:
//   1. reporting.raw_zoho_crm_meetings  (raw payload)
//   2. reporting.meetings               (normalized)
//
// meeting_type is derived from Event.Activity_Type or Event.Subject —
// see normalizeMeetingType() for the heuristic. Allowed values:
// Event / In-Service / Drop / Tour / Other.

import {
  coqlAll,
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  startSyncRun,
  supa,
  upsertRaw,
} from "./_shared/reporting-sync.ts";

const EVENT_FIELDS = [
  "id", "Subject", "Activity_Type", "Owner", "Start_DateTime",
  "Created_Time", "Modified_Time", "Account", "Who_Id",
].join(", ");

interface ZohoEvent {
  id: string;
  Subject?: string;
  Activity_Type?: string;
  Owner?: { id: string; name?: string };
  Start_DateTime?: string;
  Created_Time?: string;
  Modified_Time?: string;
  Account?: { id?: string; name?: string };
  Who_Id?: { id?: string; name?: string };
}

function buildEventQuery(modifiedSince: Date | null) {
  const since = modifiedSince ?? new Date(0);
  return (offset: number) =>
    `SELECT ${EVENT_FIELDS} FROM Events WHERE Modified_Time >= '${since.toISOString()}' ORDER BY Modified_Time ASC LIMIT 200 OFFSET ${offset}`;
}

function normalizeMeetingType(activity: string | undefined, subject: string | undefined): string {
  const a = (activity ?? "").toLowerCase();
  const s = (subject ?? "").toLowerCase();
  if (a.includes("in-service") || s.includes("in-service") || s.includes("in service")) return "In-Service";
  if (a.includes("drop") || s.includes("drop-off") || s.includes("drop off")) return "Drop";
  if (a.includes("tour") || s.includes("tour")) return "Tour";
  if (a === "event" || s.includes("event")) return "Event";
  return "Other";
}

async function resolveOwnerId(ownerZohoId: string | null): Promise<string | null> {
  if (!ownerZohoId) return null;
  const { data, error } = await supa().rpc("reporting_resolve_owner_id", { p_zoho_user_id: ownerZohoId });
  if (error) return null;
  return (data as string | null) ?? null;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ ok: false, error: "method not allowed" }, 405);

  const run = await startSyncRun("reporting-sync-meetings", "zoho_crm.meetings");

  try {
    const token = await getZohoToken();
    const res = await coqlAll<ZohoEvent>(token, buildEventQuery(run.watermarkUsed));
    if (res.error) throw new Error(`COQL failed: ${res.error}`);

    const rawRows = res.rows.map((e) => ({
      source_id: e.id,
      source_modified_at: e.Modified_Time ?? null,
      raw_payload: e,
    }));
    await upsertRaw("raw_zoho_crm_meetings", rawRows);

    const normalized = [];
    for (const e of res.rows) {
      const ownerZohoId = typeof e.Owner === "object" ? e.Owner?.id ?? null : null;
      const host_user_id = await resolveOwnerId(ownerZohoId);
      normalized.push({
        source_meeting_id: e.id,
        host_user_id,
        meeting_type: normalizeMeetingType(e.Activity_Type, e.Subject),
        lead_id: null, // Who_Id → leads.id resolution deferred to a follow-up
        account_name: typeof e.Account === "object" ? e.Account?.name ?? null : null,
        occurred_at: e.Start_DateTime ?? e.Created_Time ?? new Date().toISOString(),
      });
    }

    let upserted = 0;
    if (normalized.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < normalized.length; i += CHUNK) {
        const slice = normalized.slice(i, i + CHUNK);
        const { data, error } = await supa().rpc("reporting_upsert_meetings", { p_rows: slice });
        if (error) throw new Error(`reporting_upsert_meetings failed: ${error.message}`);
        upserted += Number(data ?? slice.length);
      }
    }

    await finishSyncRun(run, { status: "success", rowsProcessed: upserted });

    return jsonResponse({ ok: true, run_id: run.id, meetings_pulled: res.rows.length, meetings_upserted: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
