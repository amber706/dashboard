-- Fix reporting_upsert_leads: the enum casts were schema-qualified as
-- `reporting.<enum>`, but source_category / level_of_care / insurance_type all
-- live in `public` (and reporting.leads' columns are typed against those).
-- Introduced in 185_leads_is_converted_columns.sql; every reporting-sync-leads
-- run has failed with `type "reporting.source_category" does not exist` since
-- 2026-05-29, so reporting.leads stopped updating and op_lead_funnel_daily
-- reported leads_count = 0 from June 2026 onward.
--
-- Body is otherwise byte-identical to 185.

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
           NULLIF(r->>'source_category','')::public.source_category AS source_category,
           NULLIF(r->>'level_of_care_requested','')::public.level_of_care AS level_of_care_requested,
           NULLIF(r->>'insurance_type','')::public.insurance_type AS insurance_type,
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
    -- Preserve existing converted-* values when incoming row doesn't have
    -- them (older sync runs don't carry these fields). Once the sync is
    -- updated to always pass them, this COALESCE becomes a no-op.
    is_converted            = COALESCE(EXCLUDED.is_converted, reporting.leads.is_converted),
    converted_at            = COALESCE(EXCLUDED.converted_at, reporting.leads.converted_at),
    converted_deal_id       = COALESCE(EXCLUDED.converted_deal_id, reporting.leads.converted_deal_id),
    updated_at              = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;
