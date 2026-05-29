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
// Uses Zoho Analytics V2 **bulk export** (async job → poll → CSV download).
// CSV (not JSON) so we can stream-parse rather than load 60k rows into
// memory at once and hit WORKER_RESOURCE_LIMIT.
//
// `?diagnose=1` skips the sync and returns the workspaces-list probe —
// useful for verifying auth + org id without committing to a full export.

import {
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  leadScoreRatingToStarCount,
  loadMappings,
  startSyncRun,
  supa,
  ZOHO_ANALYTICS_API_DOMAIN,
} from "./_shared/reporting-sync.ts";

const WORKSPACE_ID = Deno.env.get("ZOHO_ANALYTICS_WORKSPACE_ID") ?? "2573883000000036001";
const VIEW_ID = Deno.env.get("ZOHO_ANALYTICS_LEADS_VIEW_ID") ?? "2573883000000035215";
const ORG_ID = Deno.env.get("ZOHO_ANALYTICS_ORG_ID");

// Postgres insurance_type enum values (migration 100). Anything outside this
// set — "Unknown", "PPO", etc. — gets nulled out at normalize time so the
// upsert RPC doesn't blow up. OPEN_QUESTIONS #30 tracks the unmapped values
// we observe.
const INSURANCE_TYPE_ENUM: ReadonlySet<string> = new Set([
  "AHCCCS",
  "Private Insurance",
  "Cash Pay",
  "Medicare",
  "No Insurance",
  "Out of State Medicaid",
]);

type Row = Record<string, string>;

interface BulkJobResponse {
  status?: string;
  summary?: string;
  data?: {
    jobId?: string;
    jobStatus?: string;
    downloadUrl?: string;
  };
}

const analyticsHeaders = (token: string): Record<string, string> => ({
  Authorization: `Zoho-oauthtoken ${token}`,
  "ZANALYTICS-ORGID": ORG_ID!,
  Accept: "*/*",
});

function createExportUrl(): string {
  return `${ZOHO_ANALYTICS_API_DOMAIN}/restapi/v2/bulk/workspaces/${WORKSPACE_ID}/views/${VIEW_ID}/data`;
}
function exportJobUrl(jobId: string, suffix?: "data"): string {
  return `${ZOHO_ANALYTICS_API_DOMAIN}/restapi/v2/bulk/workspaces/${WORKSPACE_ID}/exportjobs/${jobId}${suffix ? "/" + suffix : ""}`;
}

async function createExportJob(token: string): Promise<string> {
  // CSV format streams cleanly. GET with CONFIG URL-encoded in the query
  // string is what Zoho V2 bulk-export actually wants.
  const configJson = JSON.stringify({ responseFormat: "csv" });
  const url = `${createExportUrl()}?CONFIG=${encodeURIComponent(configJson)}`;
  const res = await fetch(url, { method: "GET", headers: analyticsHeaders(token) });
  const text = await res.text();
  if (!res.ok) throw new Error(`bulk create-job (${res.status}): ${text.slice(0, 400)}`);
  const j = JSON.parse(text) as BulkJobResponse;
  const jobId = j.data?.jobId;
  if (!jobId) throw new Error(`bulk create-job returned no jobId: ${text.slice(0, 400)}`);
  return jobId;
}

async function pollExportJob(token: string, jobId: string): Promise<void> {
  const POLL_MS = 3000;
  const MAX_POLLS = 60;
  for (let i = 0; i < MAX_POLLS; i++) {
    const res = await fetch(exportJobUrl(jobId), { headers: analyticsHeaders(token) });
    const text = await res.text();
    if (!res.ok) throw new Error(`bulk poll (${res.status}): ${text.slice(0, 400)}`);
    const j = JSON.parse(text) as BulkJobResponse;
    const status = j.data?.jobStatus ?? "";
    if (status === "JOB COMPLETED") return;
    if (status === "JOB FAILED" || status === "JOB FAILURE") {
      throw new Error(`bulk job failed: ${text.slice(0, 400)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`bulk job did not complete in ${(POLL_MS * MAX_POLLS) / 1000}s`);
}

// ── Streaming CSV parser ──────────────────────────────────────────────────
// Yields one parsed row at a time. Handles quoted fields with embedded
// commas and newlines (the only RFC-4180 features Zoho Analytics actually
// emits). No external dependency.

async function* streamCsv(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Row, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let headers: string[] | null = null;

  // Parse one CSV record from the buffer. Returns the row + the number of
  // bytes consumed, or null if the buffer doesn't yet contain a complete
  // record.
  function tryParseRecord(): { fields: string[]; consumed: number } | null {
    const fields: string[] = [];
    let i = 0;
    let cur = "";
    let inQuotes = false;
    while (i < buf.length) {
      const ch = buf[i];
      if (inQuotes) {
        if (ch === '"') {
          if (buf[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { fields.push(cur); cur = ""; i++; continue; }
      if (ch === '\n' || ch === '\r') {
        fields.push(cur);
        // consume CRLF as a single terminator
        if (ch === '\r' && buf[i + 1] === '\n') i += 2; else i += 1;
        return { fields, consumed: i };
      }
      cur += ch; i++;
    }
    return null; // record not yet complete
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (true) {
      const rec = tryParseRecord();
      if (!rec) break;
      const { fields, consumed } = rec;
      buf = buf.slice(consumed);
      if (!headers) { headers = fields; continue; }
      const row: Row = {};
      for (let i = 0; i < headers.length; i++) row[headers[i]] = fields[i] ?? "";
      yield row;
    }
  }

  // Handle a final record with no trailing newline.
  buf += decoder.decode(); // flush any remaining buffered bytes
  if (buf.length > 0 && headers) {
    const rec = tryParseRecord();
    if (rec) {
      const row: Row = {};
      for (let i = 0; i < headers.length; i++) row[headers[i]] = rec.fields[i] ?? "";
      yield row;
    }
  }
}

async function diagnoseAnalytics(token: string): Promise<string> {
  const wsRes = await fetch(`${ZOHO_ANALYTICS_API_DOMAIN}/restapi/v2/workspaces`, {
    headers: analyticsHeaders(token),
  });
  const wsText = await wsRes.text();
  return `workspaces probe — status=${wsRes.status} body=${wsText.slice(0, 600)}`;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ ok: false, error: "method not allowed" }, 405);

  const url = new URL(req.url);
  if (url.searchParams.get("diagnose") === "1") {
    const token = await getZohoToken();
    const probe = await diagnoseAnalytics(token);
    return jsonResponse({ ok: true, probe });
  }

  const run = await startSyncRun("reporting-sync-leads", "zoho_analytics.leads");

  try {
    if (!ORG_ID) throw new Error("ZOHO_ANALYTICS_ORG_ID env var not set");

    const token = await getZohoToken();
    const mappings = await loadMappings();

    const jobId = await createExportJob(token);
    await pollExportJob(token, jobId);

    const downloadRes = await fetch(exportJobUrl(jobId, "data"), { headers: analyticsHeaders(token) });
    if (!downloadRes.ok || !downloadRes.body) {
      throw new Error(`bulk download (${downloadRes.status}): ${(await downloadRes.text()).slice(0, 400)}`);
    }

    // Stream rows through batched normalized upserts. We deliberately skip
    // the raw_zoho_analytics_leads mirror — persisting 60k+ rows of JSONB
    // in addition to streaming the CSV breaches the edge runtime's 256MB
    // cap (v8 / v9 / v10 all OOM'd at 16-49k rows even with slim payloads).
    // The unmapped-source / unmapped-loc views read from raw_zoho_crm_deals
    // which still covers the same enums — we lose lead-side coverage but
    // gain a working end-to-end leads pipeline.
    const BATCH = 200;
    let normBuf: Array<{
      source_lead_id: string;
      owner_user_id: null;
      source_category: string;
      level_of_care_requested: string | null;
      insurance_type: string | null;
      lead_score_rating: string | null;
      star_rating: number;
      bd_rep_inbound: string | null;
      created_at: string;
    }> = [];
    let totalPulled = 0;
    let totalUpserted = 0;
    let failed = 0;

    async function flush() {
      if (normBuf.length === 0) return;
      const { data, error } = await supa().rpc("reporting_upsert_leads", { p_rows: normBuf });
      if (error) throw new Error(`reporting_upsert_leads failed: ${error.message}`);
      totalUpserted += Number(data ?? normBuf.length);
      normBuf = [];
    }

    for await (const r of streamCsv(downloadRes.body)) {
      totalPulled++;
      const sourceId = (r["Id"] ?? r["Lead Id"] ?? "").trim();
      if (!sourceId) { failed++; continue; }

      const sourceCategoryRaw = (r["Source_Category"] ?? r["Source Category"] ?? "").trim() || null;
      const locRaw = (r["Level_of_Care_Requested"] ?? r["Level of Care Requested"] ?? "").trim() || null;
      const insuranceRaw = (r["Insurance_Type"] ?? r["Insurance Type"] ?? "").trim() || null;
      const insurance = insuranceRaw && INSURANCE_TYPE_ENUM.has(insuranceRaw) ? insuranceRaw : null;
      const scoreRating = (r["Lead_Score_Rating"] ?? r["Lead Score Rating"] ?? "").trim() || null;
      const bdRep = (r["BD_Rep"] ?? r["BD Rep"] ?? "").trim() || null;
      const createdAt = (r["Created_Time"] ?? r["Created Time"] ?? "").trim() || new Date().toISOString();

      const source_category = sourceCategoryRaw
        ? (mappings.sourceCategory.get(sourceCategoryRaw) ?? "digital_marketing")
        : "digital_marketing";
      const loc = locRaw ? mappings.loc.get(locRaw) ?? null : null;

      normBuf.push({
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

      if (normBuf.length >= BATCH) await flush();
    }
    await flush();

    await finishSyncRun(run, {
      status: failed > 0 ? "partial" : "success",
      rowsProcessed: totalUpserted,
      rowsFailed: failed,
    });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      leads_pulled: totalPulled,
      leads_upserted: totalUpserted,
      leads_failed: failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
