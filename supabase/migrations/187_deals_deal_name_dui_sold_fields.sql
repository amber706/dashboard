-- ─────────────────────────────────────────────────────────────────
-- Migration 187 — Add Deal_Name + DUI screening/course sold fields
-- to reporting.deals, update upsert RPC accordingly.
--
-- New fields (sourced from Zoho CRM Deals module):
--   - deal_name             (Deal_Name)           — shows in drill modal
--   - screening_sold        (Screening_Sold bool) — DUI screening sale flag
--   - course_sold           (Course_Sold bool)    — DUI course sale flag
--   - screening_closed_date (Screening_Closed_Date) — date the screening sold
--
-- Each DUI deal can produce TWO admit events (screening + course), counted
-- separately by the build logic. Sync edge function v15 captures these
-- fields via COQL; this migration adds the schema + upsert wiring.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE reporting.deals
  ADD COLUMN IF NOT EXISTS deal_name             TEXT,
  ADD COLUMN IF NOT EXISTS screening_sold        BOOLEAN,
  ADD COLUMN IF NOT EXISTS course_sold           BOOLEAN,
  ADD COLUMN IF NOT EXISTS screening_closed_date DATE;

CREATE OR REPLACE FUNCTION public.reporting_upsert_deals(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_deal_id')::TEXT                           AS source_deal_id,
      NULLIF(r->>'source_lead_id','')                        AS source_lead_id,
      NULLIF(r->>'owner_user_id','')::UUID                   AS owner_user_id,
      (r->>'pipeline')::pipeline                             AS pipeline,
      (r->>'stage_raw')::TEXT                                AS stage_raw,
      (r->>'stage_category')::stage_category                 AS stage_category,
      COALESCE((r->>'vob_submitted')::BOOLEAN, FALSE)        AS vob_submitted,
      NULLIF(r->>'vob_submitted_date','')::DATE              AS vob_submitted_date,
      NULLIF(r->>'level_of_care_requested','')::level_of_care AS level_of_care_requested,
      NULLIF(r->>'admitted_level_of_care','')::level_of_care  AS admitted_level_of_care,
      (r->>'source_category')::source_category               AS source_category,
      (r->>'created_at')::TIMESTAMPTZ                        AS created_at,
      NULLIF(r->>'closing_date','')::DATE                    AS closing_date,
      NULLIF(r->>'admit_date','')::DATE                      AS admit_date,
      NULLIF(r->>'lead_created_time','')::DATE               AS lead_created_time,
      NULLIF(r->>'closed_lost_reason','')                    AS closed_lost_reason,
      NULLIF(r->>'refer_out_type','')                        AS refer_out_type,
      NULLIF(r->>'deal_name','')                             AS deal_name,
      NULLIF(r->>'screening_sold','')::BOOLEAN               AS screening_sold,
      NULLIF(r->>'course_sold','')::BOOLEAN                  AS course_sold,
      NULLIF(r->>'screening_closed_date','')::DATE           AS screening_closed_date
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.deals (
    source_deal_id, source_lead_id, owner_user_id, pipeline, stage_raw, stage_category,
    vob_submitted, vob_submitted_date, level_of_care_requested, admitted_level_of_care,
    source_category, created_at, closing_date, admit_date, lead_created_time,
    closed_lost_reason, refer_out_type, deal_name, screening_sold, course_sold,
    screening_closed_date, updated_at
  )
  SELECT source_deal_id, source_lead_id, owner_user_id, pipeline, stage_raw, stage_category,
         vob_submitted, vob_submitted_date, level_of_care_requested, admitted_level_of_care,
         source_category, created_at, closing_date, admit_date, lead_created_time,
         closed_lost_reason, refer_out_type, deal_name, screening_sold, course_sold,
         screening_closed_date, NOW()
  FROM input
  ON CONFLICT (source_deal_id) DO UPDATE SET
    source_lead_id          = EXCLUDED.source_lead_id,
    owner_user_id           = EXCLUDED.owner_user_id,
    pipeline                = EXCLUDED.pipeline,
    stage_raw               = EXCLUDED.stage_raw,
    stage_category          = EXCLUDED.stage_category,
    vob_submitted           = EXCLUDED.vob_submitted,
    vob_submitted_date      = EXCLUDED.vob_submitted_date,
    level_of_care_requested = EXCLUDED.level_of_care_requested,
    admitted_level_of_care  = EXCLUDED.admitted_level_of_care,
    source_category         = EXCLUDED.source_category,
    created_at              = EXCLUDED.created_at,
    closing_date            = EXCLUDED.closing_date,
    admit_date              = EXCLUDED.admit_date,
    lead_created_time       = EXCLUDED.lead_created_time,
    closed_lost_reason      = EXCLUDED.closed_lost_reason,
    refer_out_type          = EXCLUDED.refer_out_type,
    deal_name               = COALESCE(EXCLUDED.deal_name,             reporting.deals.deal_name),
    screening_sold          = COALESCE(EXCLUDED.screening_sold,        reporting.deals.screening_sold),
    course_sold             = COALESCE(EXCLUDED.course_sold,           reporting.deals.course_sold),
    screening_closed_date   = COALESCE(EXCLUDED.screening_closed_date, reporting.deals.screening_closed_date),
    updated_at              = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
