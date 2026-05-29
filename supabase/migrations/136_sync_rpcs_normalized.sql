-- ───────────────────────────────────────────────────────────────────────────
-- Migration 136 — Normalized-side sync RPCs (Phase 1B chunk 2 cont'd)
--
-- One upsert RPC per normalized table. Edge functions resolve raw → normalized
-- values in memory (via the mapping cache loaded once per run), then ship a
-- JSONB array of already-typed rows to these RPCs.
--
-- All SECURITY DEFINER + search_path-pinned. EXECUTE granted only to
-- service_role.
-- ───────────────────────────────────────────────────────────────────────────

-- ── reporting_upsert_leads ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_leads(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_lead_id')::TEXT                          AS source_lead_id,
      NULLIF(r->>'owner_user_id','')::UUID                  AS owner_user_id,
      (r->>'source_category')::source_category              AS source_category,
      NULLIF(r->>'level_of_care_requested','')::level_of_care AS level_of_care_requested,
      NULLIF(r->>'insurance_type','')::insurance_type       AS insurance_type,
      NULLIF(r->>'lead_score_rating','')                    AS lead_score_rating,
      NULLIF(r->>'star_rating','')::SMALLINT                AS star_rating,
      NULLIF(r->>'bd_rep_inbound','')                       AS bd_rep_inbound,
      (r->>'created_at')::TIMESTAMPTZ                       AS created_at
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.leads (
    source_lead_id, owner_user_id, source_category, level_of_care_requested,
    insurance_type, lead_score_rating, star_rating, bd_rep_inbound, created_at, updated_at
  )
  SELECT source_lead_id, owner_user_id, source_category, level_of_care_requested,
         insurance_type, lead_score_rating, star_rating, bd_rep_inbound, created_at, NOW()
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
    updated_at              = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── reporting_upsert_deals ────────────────────────────────────────────────

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
      NULLIF(r->>'closed_lost_reason','')                    AS closed_lost_reason,
      NULLIF(r->>'refer_out_type','')                        AS refer_out_type
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.deals (
    source_deal_id, source_lead_id, owner_user_id, pipeline, stage_raw, stage_category,
    vob_submitted, vob_submitted_date, level_of_care_requested, admitted_level_of_care,
    source_category, created_at, closing_date, admit_date, closed_lost_reason,
    refer_out_type, updated_at
  )
  SELECT source_deal_id, source_lead_id, owner_user_id, pipeline, stage_raw, stage_category,
         vob_submitted, vob_submitted_date, level_of_care_requested, admitted_level_of_care,
         source_category, created_at, closing_date, admit_date, closed_lost_reason,
         refer_out_type, NOW()
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
    closed_lost_reason      = EXCLUDED.closed_lost_reason,
    refer_out_type          = EXCLUDED.refer_out_type,
    updated_at              = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── reporting_upsert_meetings ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_meetings(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_meeting_id')::TEXT       AS source_meeting_id,
      NULLIF(r->>'host_user_id','')::UUID   AS host_user_id,
      (r->>'meeting_type')::TEXT            AS meeting_type,
      NULLIF(r->>'lead_id','')::UUID        AS lead_id,
      NULLIF(r->>'account_name','')         AS account_name,
      (r->>'occurred_at')::TIMESTAMPTZ      AS occurred_at
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.meetings (
    source_meeting_id, host_user_id, meeting_type, lead_id, account_name, occurred_at
  )
  SELECT source_meeting_id, host_user_id, meeting_type, lead_id, account_name, occurred_at FROM input
  ON CONFLICT (source_meeting_id) DO UPDATE SET
    host_user_id  = EXCLUDED.host_user_id,
    meeting_type  = EXCLUDED.meeting_type,
    lead_id       = EXCLUDED.lead_id,
    account_name  = EXCLUDED.account_name,
    occurred_at   = EXCLUDED.occurred_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── reporting_upsert_calls ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_calls(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_call_id')::TEXT                AS source_call_id,
      NULLIF(r->>'owner_user_id','')::UUID        AS owner_user_id,
      NULLIF(r->>'lead_id','')::UUID              AS lead_id,
      (r->>'direction')::TEXT                     AS direction,
      NULLIF(r->>'duration_sec','')::INTEGER      AS duration_sec,
      (r->>'occurred_at')::TIMESTAMPTZ            AS occurred_at,
      COALESCE((r->>'missed')::BOOLEAN, FALSE)    AS missed
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.calls (
    source_call_id, owner_user_id, lead_id, direction, duration_sec, occurred_at, missed
  )
  SELECT source_call_id, owner_user_id, lead_id, direction, duration_sec, occurred_at, missed FROM input
  ON CONFLICT (source_call_id) DO UPDATE SET
    owner_user_id = EXCLUDED.owner_user_id,
    lead_id       = EXCLUDED.lead_id,
    direction     = EXCLUDED.direction,
    duration_sec  = EXCLUDED.duration_sec,
    occurred_at   = EXCLUDED.occurred_at,
    missed        = EXCLUDED.missed;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Resolve owner email → user_identity.id helper ─────────────────────────
-- Used by sync functions to map Zoho Owner.id to our user_identity.id.

CREATE OR REPLACE FUNCTION public.reporting_resolve_owner_id(p_zoho_user_id TEXT)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = reporting, public
AS $$
  SELECT id FROM reporting.user_identity WHERE zoho_user_id = p_zoho_user_id LIMIT 1;
$$;

-- ── Permissions ───────────────────────────────────────────────────────────

DO $$
DECLARE fn TEXT;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'reporting_upsert_leads(jsonb)',
    'reporting_upsert_deals(jsonb)',
    'reporting_upsert_meetings(jsonb)',
    'reporting_upsert_calls(jsonb)',
    'reporting_resolve_owner_id(text)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END$$;
