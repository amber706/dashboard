-- ───────────────────────────────────────────────────────────────────────────
-- Migration 142 — Add lead_created_time to reporting.deals
--
-- Zoho stores `Lead_Created_Time` (date) directly on the Deal record at the
-- moment of Lead conversion. We use this for sales- and placement-cycle
-- math (CONFIRMED.md #28, #29) — closing_date - lead_created_time — without
-- needing a separate Deal → Lead join. Resolves OPEN_QUESTIONS #37: there
-- is no Lead-Id lookup field on Deals; the conversion timestamp is the
-- right primitive to carry on the Deal.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE reporting.deals
  ADD COLUMN IF NOT EXISTS lead_created_time DATE;

CREATE INDEX IF NOT EXISTS idx_deals_lead_created_time
  ON reporting.deals (lead_created_time)
  WHERE lead_created_time IS NOT NULL;

COMMENT ON COLUMN reporting.deals.lead_created_time IS
  'Date of the originating Lead''s Created_Time, copied to the Deal at '
  'conversion (Zoho Lead_Created_Time field). NULL for Deals that were '
  'created directly (no Lead conversion).';

-- ── Update reporting_upsert_deals to accept the new field ─────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_deals(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
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
      NULLIF(r->>'refer_out_type','')                        AS refer_out_type
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.deals (
    source_deal_id, source_lead_id, owner_user_id, pipeline, stage_raw, stage_category,
    vob_submitted, vob_submitted_date, level_of_care_requested, admitted_level_of_care,
    source_category, created_at, closing_date, admit_date, lead_created_time,
    closed_lost_reason, refer_out_type, updated_at
  )
  SELECT source_deal_id, source_lead_id, owner_user_id, pipeline, stage_raw, stage_category,
         vob_submitted, vob_submitted_date, level_of_care_requested, admitted_level_of_care,
         source_category, created_at, closing_date, admit_date, lead_created_time,
         closed_lost_reason, refer_out_type, NOW()
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
    updated_at              = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
