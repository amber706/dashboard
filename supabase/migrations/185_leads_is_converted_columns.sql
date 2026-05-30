-- ─────────────────────────────────────────────────────────────────
-- Migration 185 — Add is_converted + converted_at + converted_deal_id
-- to reporting.leads, plus backfill from raw_payload.
--
-- The Zoho Analytics leads report now exposes "Is Converted" (Yes/No),
-- "Converted Date Time", and "Converted Deal" fields. Recent leads
-- syncs (~1,127 rows out of 49k) captured these in raw_payload; this
-- migration backfills the typed columns from those raw rows.
--
-- Older rows (pre-Analytics-update) will show is_converted IS NULL
-- until the leads sync is re-run with a backdated watermark, OR until
-- those individual leads get re-synced on their next Modified_Time
-- update in Zoho.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE reporting.leads
  ADD COLUMN IF NOT EXISTS is_converted      BOOLEAN,
  ADD COLUMN IF NOT EXISTS converted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_deal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_is_converted
  ON reporting.leads (is_converted)
  WHERE is_converted IS NOT NULL;

UPDATE reporting.leads l
SET is_converted = CASE r.raw_payload->>'Is Converted'
                     WHEN 'Yes' THEN TRUE
                     WHEN 'No'  THEN FALSE
                     ELSE NULL
                   END,
    converted_at = CASE
                     WHEN r.raw_payload->>'Converted Date Time' IS NULL
                       OR r.raw_payload->>'Converted Date Time' = '' THEN NULL
                     ELSE (r.raw_payload->>'Converted Date Time')::TIMESTAMPTZ
                   END,
    converted_deal_id = NULLIF(r.raw_payload->>'Converted Deal','')
FROM reporting.raw_zoho_analytics_leads r
WHERE r.source_id = l.source_lead_id
  AND r.raw_payload ? 'Is Converted'
  AND l.is_converted IS DISTINCT FROM CASE r.raw_payload->>'Is Converted'
                                        WHEN 'Yes' THEN TRUE
                                        WHEN 'No'  THEN FALSE
                                        ELSE NULL
                                      END;

CREATE OR REPLACE FUNCTION public.reporting_upsert_leads(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT (r->>'source_lead_id')::TEXT AS source_lead_id,
           NULLIF(r->>'owner_user_id','')::UUID AS owner_user_id,
           NULLIF(r->>'source_category','')::reporting.source_category AS source_category,
           NULLIF(r->>'level_of_care_requested','')::reporting.level_of_care AS level_of_care_requested,
           NULLIF(r->>'insurance_type','')::reporting.insurance_type AS insurance_type,
           NULLIF(r->>'lead_score_rating','') AS lead_score_rating,
           NULLIF(r->>'star_rating','')::SMALLINT AS star_rating,
           NULLIF(r->>'bd_rep_inbound','') AS bd_rep_inbound,
           (r->>'created_at')::TIMESTAMPTZ AS created_at,
           NULLIF(r->>'is_converted','')::BOOLEAN AS is_converted,
           NULLIF(r->>'converted_at','')::TIMESTAMPTZ AS converted_at,
           NULLIF(r->>'converted_deal_id','') AS converted_deal_id
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.leads (
    source_lead_id, owner_user_id, source_category, level_of_care_requested,
    insurance_type, lead_score_rating, star_rating, bd_rep_inbound, created_at,
    is_converted, converted_at, converted_deal_id
  )
  SELECT
    source_lead_id, owner_user_id, source_category, level_of_care_requested,
    insurance_type, lead_score_rating, star_rating, bd_rep_inbound, created_at,
    is_converted, converted_at, converted_deal_id
  FROM input
  ON CONFLICT (source_lead_id) DO UPDATE SET
    owner_user_id           = EXCLUDED.owner_user_id,
    source_category         = EXCLUDED.source_category,
    level_of_care_requested = EXCLUDED.level_of_care_requested,
    insurance_type          = EXCLUDED.insurance_type,
    lead_score_rating       = EXCLUDED.lead_score_rating,
    star_rating             = EXCLUDED.star_rating,
    bd_rep_inbound          = EXCLUDED.bd_rep_inbound,
    created_at              = EXCLUDED.created_at,
    -- Preserve existing converted-* values when incoming row doesn't carry
    -- them (older sync runs predate the Analytics column additions).
    is_converted            = COALESCE(EXCLUDED.is_converted, reporting.leads.is_converted),
    converted_at            = COALESCE(EXCLUDED.converted_at, reporting.leads.converted_at),
    converted_deal_id       = COALESCE(EXCLUDED.converted_deal_id, reporting.leads.converted_deal_id),
    updated_at              = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;
