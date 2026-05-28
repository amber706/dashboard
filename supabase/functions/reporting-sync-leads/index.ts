// reporting-sync-leads — Phase 1B sync edge function.
//
// Pulls leads from the Zoho Analytics report `Leads (Zoho CRM)`:
//   - Workspace ID: 2573883000000036001
//   - View ID:      2573883000000035215
//
// This is the canonical lead source — the live Zoho CRM Leads module loses
// rows on conversion, so we read the Analytics snapshot which preserves
// pre-conversion state. Auth uses the same Zoho OAuth token (scope widened
// in CONFIRMED.md #18).
//
// Status: scaffold deployed; Analytics API request format needs production
// verification. Trigger manually first, then schedule via cron.

import {
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  leadScoreRatingToStarCount,
  loadMappings,
  logSyncFailure,
  startSyncRun,
  supa,
  upsertRaw,
  ZOHO_ANALYTICS_API_DOMAIN,
} from "./_shared/reporting-sync.ts";

const WORKSPACE_ID = Deno.env.get("ZOHO_ANALYTICS_WORKSPACE_ID") ?? "2573883000000036001";
const VIEW_ID = Deno.env.get("ZOHO_ANALYTICS_LEADS_VIEW_ID") ?? "2573883000000035215";
const ORG_ID = Deno.env.get("ZOHO_ANALYTICS_ORG_ID"); // required by the Analytics API

interface AnalyticsLeadRow {
  Id?: string;
  "Lead Id"?: string;
  Created_Time?: string;
  Modified_Time?: string;
  "Interaction Owner"?: string;
  Source_Category?: string;
  Level_of_Care_Requested?: string;
  Insurance_Type?: string;
  Lead_Score_Rating?: string;
  BD_Rep?: string;
  [k: string]: unknown;
}

async function fetchAnalyticsView(token: string): Promise<AnalyticsLeadRow[]> {
  if (!ORG_ID) {
    throw new Error("ZOHO_ANALYTICS_ORG_ID env var not set");
  }
  // Zoho Analytics V2 export API
  const url = `${ZOHO_ANALYTICS_API_DOMAIN}/restapi/v2/workspaces/${WORKSPACE_ID}/views/${VIEW_ID}/data`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "ZANALYTICS-ORGID": ORG_ID,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Analytics fetch failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  const j = await res.json();
  // Response shape varies — try common shapes
  return (j.data ?? j.rows ?? j) as AnalyticsLeadRow[];
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ ok: false, error: "method not allowed" }, 405);

  const run = await startSyncRun("reporting-sync-leads", "zoho_analytics.leads");

  try {
    const token = await getZohoToken();
    const mappings = await loadMappings();
    const rows = await fetchAnalyticsView(token);

    const rawRows = rows.map((r) => {
      const sourceId = (r.Id ?? r["Lead Id"] ?? "") as string;
      return {
        source_id: sourceId,
        source_modified_at: (r.Modified_Time ?? null) as string | null,
        raw_payload: r,
      };
    }).filter((r) => r.source_id.length > 0);

    await upsertRaw("raw_zoho_analytics_leads", rawRows);

    const normalized = [];
    let failed = 0;
    for (const r of rows) {
      const sourceId = (r.Id ?? r["Lead Id"]) as string | undefined;
      if (!sourceId) { failed++; continue; }
      const sourceCategoryRaw = (r.Source_Category as string | undefined) ?? null;
      const locRaw = (r.Level_of_Care_Requested as string | undefined) ?? null;
      const insurance = (r.Insurance_Type as string | undefined) ?? null;
      const scoreRating = (r.Lead_Score_Rating as string | undefined) ?? null;
      const bdRep = (r.BD_Rep as string | undefined) ?? null;
      const createdAt = (r.Created_Time as string | undefined) ?? new Date().toISOString();

      const source_category = sourceCategoryRaw
        ? (mappings.sourceCategory.get(sourceCategoryRaw) ?? "digital_marketing")
        : "digital_marketing";
      const loc = locRaw ? mappings.loc.get(locRaw) ?? null : null;

      normalized.push({
        source_lead_id: sourceId,
        owner_user_id: null, // owner resolution via Interaction Owner column TODO
        source_category,
        level_of_care_requested: loc,
        insurance_type: insurance,
        lead_score_rating: scoreRating,
        star_rating: leadScoreRatingToStarCount(scoreRating),
        bd_rep_inbound: bdRep,
        created_at: createdAt,
      });
    }

    let upserted = 0;
    if (normalized.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < normalized.length; i += CHUNK) {
        const slice = normalized.slice(i, i + CHUNK);
        const { data, error } = await supa().rpc("reporting_upsert_leads", { p_rows: slice });
        if (error) throw new Error(`reporting_upsert_leads failed: ${error.message}`);
        upserted += Number(data ?? slice.length);
      }
    }

    await finishSyncRun(run, {
      status: failed > 0 ? "partial" : "success",
      rowsProcessed: upserted,
      rowsFailed: failed,
    });

    return jsonResponse({ ok: true, run_id: run.id, leads_pulled: rows.length, leads_upserted: upserted, leads_failed: failed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
