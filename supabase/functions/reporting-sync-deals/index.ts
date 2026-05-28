// reporting-sync-deals — Phase 1B sync edge function.
//
// Pulls Zoho CRM Deals via COQL incrementally, normalizes per Phase 1A
// taxonomy, and writes to reporting.raw_zoho_crm_deals + reporting.deals.
//
// Normalization highlights (per docs/METRIC_DEFINITIONS.md + CONFIRMED.md):
//   - Pipeline raw → normalized via reporting.pipeline_mapping
//   - Stage raw → stage_category via reporting.stage_mapping
//   - LOC raw → level_of_care via reporting.loc_mapping
//   - Source Category raw → source_category via mapping
//   - VOB priority chain: VOB_Submitted boolean + VOB_Submitted_Date,
//     stage backup excludes closed_lost
//   - Admit priority chain: admit_date OR stage = closed_won_admitted
//   - Closed Lost reason: pulled per-pipeline from Lost_Reasoning /
//     Close_Reasoning_DUI / Reason_For_Loss__s
//   - Refer Out Type: pulled from Refer_Out_Type custom field

import {
  coqlKeysetByModifiedTime,
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  loadMappings,
  loadOwnerMap,
  logSyncFailure,
  startSyncRun,
  supa,
  upsertRaw,
  type Mappings,
  type SyncRunHandle,
} from "./_shared/reporting-sync.ts";

// Lead_Created_Time on Deal is Zoho's conversion-time snapshot of the
// originating Lead's Created_Time. We carry it through to power sales- and
// placement-cycle math without a Deal → Lead join (resolves OPEN_QUESTIONS
// #37 — there is no Lead-Id lookup field on Deals).
const DEAL_FIELDS = [
  "id", "Stage", "Pipeline", "Owner", "Created_Time", "Modified_Time",
  "Closing_Date", "Admit_Date", "Lead_Created_Time", "Source_Category",
  "Insurance_Type", "Level_of_Care_Requested", "Admitted_Level_of_Care",
  "DUI_or_Treatment",
  "VOB_Submitted", "VOB_Submitted_Date", "VOB_Submitted_By",
  "Lost_Reasoning", "Close_Reasoning_DUI", "Reason_For_Loss__s",
  "Refer_Out_Type",
].join(", ");

interface ZohoDeal {
  id: string;
  Stage?: string;
  Pipeline?: string;
  Owner?: { id: string; name?: string };
  Created_Time?: string;
  Modified_Time?: string;
  Closing_Date?: string;
  Admit_Date?: string;
  Lead_Created_Time?: string;
  Source_Category?: string;
  Insurance_Type?: string;
  Level_of_Care_Requested?: string;
  Admitted_Level_of_Care?: string;
  DUI_or_Treatment?: string;
  VOB_Submitted?: boolean | string;
  VOB_Submitted_Date?: string;
  VOB_Submitted_By?: string;
  Lost_Reasoning?: string;
  Close_Reasoning_DUI?: string;
  Reason_For_Loss__s?: string;
  Refer_Out_Type?: string;
}

// Deals can exceed COQL's 10k OFFSET cap on a full backfill (~20k rows),
// so keyset paginate on Modified_Time via coqlKeysetByModifiedTime.

function pickClosedLostReason(d: ZohoDeal, pipeline: string | null): string | null {
  if (pipeline === "dui_cash") return d.Close_Reasoning_DUI ?? d.Reason_For_Loss__s ?? null;
  return d.Lost_Reasoning ?? d.Reason_For_Loss__s ?? null;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === "True";
}

function resolveOwnerId(ownerZohoId: string | null, ownerMap: Map<string, string>): string | null {
  if (!ownerZohoId) return null;
  return ownerMap.get(ownerZohoId) ?? null;
}

interface NormalizedDeal {
  source_deal_id: string;
  source_lead_id: string | null;
  owner_user_id: string | null;
  pipeline: string;
  stage_raw: string;
  stage_category: string;
  vob_submitted: boolean;
  vob_submitted_date: string | null;
  level_of_care_requested: string | null;
  admitted_level_of_care: string | null;
  source_category: string;
  created_at: string;
  closing_date: string | null;
  admit_date: string | null;
  lead_created_time: string | null;
  closed_lost_reason: string | null;
  refer_out_type: string | null;
}

async function normalizeDeal(
  d: ZohoDeal,
  mappings: Mappings,
  ownerMap: Map<string, string>,
  run: SyncRunHandle,
): Promise<NormalizedDeal | null> {
  const pipelineRaw = d.Pipeline ?? null;
  const stageRaw = d.Stage ?? null;
  const sourceCategoryRaw = d.Source_Category ?? null;

  if (!pipelineRaw || !stageRaw) {
    await logSyncFailure({
      runHandle: run,
      failureType: "schema_mismatch",
      sourceId: d.id,
      errorMessage: `Missing Pipeline (${pipelineRaw}) or Stage (${stageRaw})`,
    });
    return null;
  }

  const pipeline = mappings.pipeline.get(pipelineRaw);
  if (!pipeline) {
    await logSyncFailure({
      runHandle: run,
      failureType: "unmapped_pipeline",
      sourceId: d.id,
      rawValue: pipelineRaw,
    });
    return null;
  }

  const stage_category = mappings.stage.get(stageRaw);
  if (!stage_category) {
    await logSyncFailure({
      runHandle: run,
      failureType: "unmapped_stage",
      sourceId: d.id,
      rawValue: stageRaw,
    });
    return null;
  }

  const source_category = sourceCategoryRaw
    ? (mappings.sourceCategory.get(sourceCategoryRaw) ?? "digital_marketing")
    : "digital_marketing";

  const locReq = d.Level_of_Care_Requested ? mappings.loc.get(d.Level_of_Care_Requested) ?? null : null;
  const locAdm = d.Admitted_Level_of_Care ? mappings.loc.get(d.Admitted_Level_of_Care) ?? null : null;

  const ownerZohoId = typeof d.Owner === "object" ? d.Owner?.id : null;
  const owner_user_id = resolveOwnerId(ownerZohoId ?? null, ownerMap);

  return {
    source_deal_id: d.id,
    // source_lead_id has no direct field on Deals (OPEN_QUESTIONS #37 resolved
    // via lead_created_time below). Leave null until a Phase 1C Contact bridge
    // is wired up.
    source_lead_id: null,
    owner_user_id,
    pipeline,
    stage_raw: stageRaw,
    stage_category,
    vob_submitted: asBool(d.VOB_Submitted),
    vob_submitted_date: d.VOB_Submitted_Date ?? null,
    level_of_care_requested: locReq,
    admitted_level_of_care: locAdm,
    source_category,
    created_at: d.Created_Time ?? new Date().toISOString(),
    closing_date: d.Closing_Date ?? null,
    admit_date: d.Admit_Date ?? null,
    lead_created_time: d.Lead_Created_Time ?? null,
    closed_lost_reason: stage_category === "closed_lost" ? pickClosedLostReason(d, pipeline) : null,
    refer_out_type: d.Refer_Out_Type ?? null,
  };
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ ok: false, error: "method not allowed" }, 405);
  }

  const run = await startSyncRun("reporting-sync-deals", "zoho_crm.deals");

  try {
    const token = await getZohoToken();
    const mappings = await loadMappings();
    const ownerMap = await loadOwnerMap();

    const res = await coqlKeysetByModifiedTime<ZohoDeal>(
      token,
      "Deals",
      DEAL_FIELDS,
      run.watermarkUsed,
    );
    if (res.error) throw new Error(`COQL failed: ${res.error}`);

    const rawRows = res.rows.map((d) => ({
      source_id: d.id,
      source_modified_at: d.Modified_Time ?? null,
      raw_payload: d,
    }));
    await upsertRaw("raw_zoho_crm_deals", rawRows);

    const normalized: NormalizedDeal[] = [];
    let failed = 0;
    for (const d of res.rows) {
      const n = await normalizeDeal(d, mappings, ownerMap, run);
      if (n) normalized.push(n);
      else failed++;
    }

    let upserted = 0;
    if (normalized.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < normalized.length; i += CHUNK) {
        const slice = normalized.slice(i, i + CHUNK);
        const { data, error } = await supa().rpc("reporting_upsert_deals", { p_rows: slice });
        if (error) throw new Error(`reporting_upsert_deals failed: ${error.message}`);
        upserted += Number(data ?? slice.length);
      }
    }

    await finishSyncRun(run, {
      status: failed > 0 ? "partial" : "success",
      rowsProcessed: upserted,
      rowsFailed: failed,
    });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      deals_pulled: res.rows.length,
      deals_upserted: upserted,
      deals_failed: failed,
      truncated: res.truncated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
