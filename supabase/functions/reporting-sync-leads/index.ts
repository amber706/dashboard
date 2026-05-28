// reporting-sync-leads — Phase 1B sync edge function.
//
// Pulls leads from the Zoho Analytics report `Leads (Zoho CRM)`:
//   - Workspace ID: 2573883000000036001
//   - View ID:      2573883000000035215
//
// This is the canonical lead source — the live Zoho CRM Leads module loses
// rows on conversion, so we read the Analytics snapshot which preserves
// pre-conversion state.
//
// Uses Zoho Analytics V2 **bulk export** (async job → poll → download).
// The synchronous /data endpoint can't handle the ~60k row volume + returns
// API_MALFORMED_URL for our request shape; the bulk endpoint is the
// documented path for large views.

import {
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  leadScoreRatingToStarCount,
  loadMappings,
  startSyncRun,
  supa,
  upsertRaw,
  ZOHO_ANALYTICS_API_DOMAIN,
} from "./_shared/reporting-sync.ts";

const WORKSPACE_ID = Deno.env.get("ZOHO_ANALYTICS_WORKSPACE_ID") ?? "2573883000000036001";
const VIEW_ID = Deno.env.get("ZOHO_ANALYTICS_LEADS_VIEW_ID") ?? "2573883000000035215";
const ORG_ID = Deno.env.get("ZOHO_ANALYTICS_ORG_ID");

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

// ── Zoho Analytics V2 bulk export ─────────────────────────────────────────
// Three-step flow:
//   1. POST  /bulk/.../data        → creates an export job, returns jobId.
//   2. GET   /bulk/.../exportjobs/{jobId} → poll until status = "JOB COMPLETED".
//   3. GET   /bulk/.../exportjobs/{jobId}/data → downloads the result.

interface BulkJobResponse {
  status?: string;
  summary?: string;
  data?: {
    jobId?: string;
    status?: string; // "JOB IN PROGRESS" / "JOB COMPLETED" / "JOB FAILURE"
    downloadUrl?: string;
  };
}

const analyticsHeaders = (token: string): Record<string, string> => ({
  Authorization: `Zoho-oauthtoken ${token}`,
  "ZANALYTICS-ORGID": ORG_ID!,
  Accept: "application/json",
});

function bulkUrl(...parts: string[]): string {
  return `${ZOHO_ANALYTICS_API_DOMAIN}/restapi/v2/bulk/workspaces/${WORKSPACE_ID}/views/${VIEW_ID}/${parts.join("/")}`;
}

async function createExportJob(token: string): Promise<string> {
  const config = encodeURIComponent(JSON.stringify({ responseFormat: "json" }));
  const res = await fetch(`${bulkUrl("data")}?CONFIG=${config}`, {
    method: "POST",
    headers: analyticsHeaders(token),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`bulk create-job (${res.status}): ${text.slice(0, 400)}`);
  const j = JSON.parse(text) as BulkJobResponse;
  const jobId = j.data?.jobId;
  if (!jobId) throw new Error(`bulk create-job returned no jobId: ${text.slice(0, 400)}`);
  return jobId;
}

async function pollExportJob(token: string, jobId: string): Promise<void> {
  const POLL_MS = 3000;
  const MAX_POLLS = 60; // 60 × 3s = 3 minutes
  for (let i = 0; i < MAX_POLLS; i++) {
    const res = await fetch(bulkUrl("exportjobs", jobId), { headers: analyticsHeaders(token) });
    const text = await res.text();
    if (!res.ok) throw new Error(`bulk poll (${res.status}): ${text.slice(0, 400)}`);
    const j = JSON.parse(text) as BulkJobResponse;
    const status = j.data?.status ?? "";
    if (status === "JOB COMPLETED") return;
    if (status === "JOB FAILURE") throw new Error(`bulk job failed: ${text.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`bulk job did not complete in ${(POLL_MS * MAX_POLLS) / 1000}s`);
}

async function downloadExportJob(token: string, jobId: string): Promise<AnalyticsLeadRow[]> {
  const res = await fetch(bulkUrl("exportjobs", jobId, "data"), { headers: analyticsHeaders(token) });
  const text = await res.text();
  if (!res.ok) throw new Error(`bulk download (${res.status}): ${text.slice(0, 400)}`);
  // Response may be a JSON object or JSON array depending on Zoho's mood —
  // tolerate both shapes.
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as AnalyticsLeadRow[];
  if (Array.isArray(parsed?.data)) return parsed.data as AnalyticsLeadRow[];
  if (Array.isArray(parsed?.data?.rows)) return parsed.data.rows as AnalyticsLeadRow[];
  throw new Error(`bulk download returned unrecognized shape: ${text.slice(0, 200)}`);
}

async function fetchAnalyticsView(token: string): Promise<AnalyticsLeadRow[]> {
  if (!ORG_ID) throw new Error("ZOHO_ANALYTICS_ORG_ID env var not set");
  const jobId = await createExportJob(token);
  await pollExportJob(token, jobId);
  return await downloadExportJob(token, jobId);
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
        owner_user_id: null,
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
