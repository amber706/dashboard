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
  coqlKeysetByModifiedTime,
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  loadOwnerMap,
  startSyncRun,
  supa,
  upsertRaw,
} from "./_shared/reporting-sync.ts";

// Events module uses polymorphic What_Id (Accounts/Deals/etc.) rather than
// a direct Account field. account_name is sourced from What_Id.name when the
// linked entity is an Account; otherwise null.
//
// Meeting type semantics in this org: Subject is named `Event_Title`; the
// canonical type field is `Meeting_Type_s` (multiselect picklist with values
// Drop / Event / In - Service / Standard Meeting / Tour).
const EVENT_FIELDS = [
  "id", "Event_Title", "Meeting_Type_s", "Owner", "Start_DateTime",
  "Created_Time", "Modified_Time", "What_Id", "Who_Id",
].join(", ");

interface ZohoEvent {
  id: string;
  Event_Title?: string;
  Meeting_Type_s?: string | string[];
  Owner?: { id: string; name?: string };
  Start_DateTime?: string;
  Created_Time?: string;
  Modified_Time?: string;
  What_Id?: { id?: string; name?: string };
  Who_Id?: { id?: string; name?: string };
}

// Normalizes the Meeting_Type_s multiselect (`Tour;Event` → first listed) +
// Event_Title fallback into our 5 canonical values.
function normalizeMeetingType(
  meetingTypes: string | string[] | undefined,
  title: string | undefined,
): string {
  const raw = Array.isArray(meetingTypes)
    ? meetingTypes
    : (meetingTypes ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const first = (raw[0] ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();

  if (first.includes("in - service") || first.includes("in-service") || t.includes("in-service") || t.includes("in service")) return "In-Service";
  if (first.includes("drop") || t.includes("drop-off") || t.includes("drop off")) return "Drop";
  if (first.includes("tour") || t.includes("tour")) return "Tour";
  if (first === "event" || first === "standard meeting" || t.includes("event")) return "Event";
  return "Other";
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ ok: false, error: "method not allowed" }, 405);

  const run = await startSyncRun("reporting-sync-meetings", "zoho_crm.meetings");

  try {
    const token = await getZohoToken();
    const ownerMap = await loadOwnerMap();

    const res = await coqlKeysetByModifiedTime<ZohoEvent>(
      token,
      "Events",
      EVENT_FIELDS,
      run.watermarkUsed,
    );
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
      const host_user_id = ownerZohoId ? (ownerMap.get(ownerZohoId) ?? null) : null;
      normalized.push({
        source_meeting_id: e.id,
        host_user_id,
        meeting_type: normalizeMeetingType(e.Meeting_Type_s, e.Event_Title),
        lead_id: null, // Who_Id → leads.id resolution deferred to a follow-up
        account_name: typeof e.What_Id === "object" ? e.What_Id?.name ?? null : null,
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

    return jsonResponse({
      ok: true,
      run_id: run.id,
      meetings_pulled: res.rows.length,
      meetings_upserted: upserted,
      truncated: res.truncated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
