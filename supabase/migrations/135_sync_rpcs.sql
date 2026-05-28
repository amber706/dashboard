-- ───────────────────────────────────────────────────────────────────────────
-- Migration 135 — Sync RPC layer (Phase 1B chunk 2 support)
--
-- The supabase-js client can only target schemas that are in PostgREST's
-- exposed `db-schemas` list — `reporting` isn't there. Rather than mutate
-- Supabase platform config, we expose a thin RPC layer in `public` that
-- internally writes to `reporting.*`. Edge functions call these via
-- `supa().rpc(...)` and never touch the schema directly.
--
-- Functions are SECURITY DEFINER + search_path-pinned. They only run when
-- invoked with service_role JWT (granted explicitly via REVOKE/GRANT below).
-- ───────────────────────────────────────────────────────────────────────────

-- ── sync_runs lifecycle ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_start_sync_run(
  p_function_name      TEXT,
  p_source             TEXT,
  p_watermark_override TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (id UUID, started_at TIMESTAMPTZ, watermark_used TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE
  v_watermark TIMESTAMPTZ;
BEGIN
  v_watermark := p_watermark_override;
  IF v_watermark IS NULL THEN
    SELECT (sr.finished_at - INTERVAL '10 minutes') INTO v_watermark
    FROM reporting.sync_runs sr
    WHERE sr.function_name = p_function_name AND sr.status = 'success'
    ORDER BY sr.finished_at DESC
    LIMIT 1;
  END IF;

  RETURN QUERY
  INSERT INTO reporting.sync_runs (function_name, source, status, watermark_used)
  VALUES (p_function_name, p_source, 'running', v_watermark)
  RETURNING sync_runs.id, sync_runs.started_at, sync_runs.watermark_used;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_finish_sync_run(
  p_id             UUID,
  p_status         TEXT,
  p_rows_processed INTEGER,
  p_rows_failed    INTEGER DEFAULT 0,
  p_error          TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
BEGIN
  UPDATE reporting.sync_runs
  SET finished_at    = NOW(),
      status         = p_status,
      rows_processed = p_rows_processed,
      rows_failed    = COALESCE(p_rows_failed, 0),
      error_message  = p_error
  WHERE id = p_id;
END;
$$;

-- ── Raw mirror upserts (one RPC per table) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_raw_zoho_crm_users(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_id')::TEXT                              AS source_id,
      NULLIF(r->>'source_modified_at','')::TIMESTAMPTZ     AS source_modified_at,
      r->'raw_payload'                                     AS raw_payload
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.raw_zoho_crm_users (source_id, source_modified_at, raw_payload)
  SELECT source_id, source_modified_at, raw_payload FROM input
  ON CONFLICT (source_id) DO UPDATE SET
    source_modified_at = EXCLUDED.source_modified_at,
    raw_payload        = EXCLUDED.raw_payload,
    ingested_at        = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_upsert_raw_zoho_crm_deals(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_id')::TEXT                              AS source_id,
      NULLIF(r->>'source_modified_at','')::TIMESTAMPTZ     AS source_modified_at,
      r->'raw_payload'                                     AS raw_payload
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.raw_zoho_crm_deals (source_id, source_modified_at, raw_payload)
  SELECT source_id, source_modified_at, raw_payload FROM input
  ON CONFLICT (source_id) DO UPDATE SET
    source_modified_at = EXCLUDED.source_modified_at,
    raw_payload        = EXCLUDED.raw_payload,
    ingested_at        = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_upsert_raw_zoho_analytics_leads(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_id')::TEXT                              AS source_id,
      NULLIF(r->>'source_modified_at','')::TIMESTAMPTZ     AS source_modified_at,
      r->'raw_payload'                                     AS raw_payload
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.raw_zoho_analytics_leads (source_id, source_modified_at, raw_payload)
  SELECT source_id, source_modified_at, raw_payload FROM input
  ON CONFLICT (source_id) DO UPDATE SET
    source_modified_at = EXCLUDED.source_modified_at,
    raw_payload        = EXCLUDED.raw_payload,
    ingested_at        = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_upsert_raw_zoho_crm_meetings(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_id')::TEXT                              AS source_id,
      NULLIF(r->>'source_modified_at','')::TIMESTAMPTZ     AS source_modified_at,
      r->'raw_payload'                                     AS raw_payload
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.raw_zoho_crm_meetings (source_id, source_modified_at, raw_payload)
  SELECT source_id, source_modified_at, raw_payload FROM input
  ON CONFLICT (source_id) DO UPDATE SET
    source_modified_at = EXCLUDED.source_modified_at,
    raw_payload        = EXCLUDED.raw_payload,
    ingested_at        = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_upsert_raw_ctm_calls(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      (r->>'source_id')::TEXT                              AS source_id,
      NULLIF(r->>'source_modified_at','')::TIMESTAMPTZ     AS source_modified_at,
      r->'raw_payload'                                     AS raw_payload
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.raw_ctm_calls (source_id, source_modified_at, raw_payload)
  SELECT source_id, source_modified_at, raw_payload FROM input
  ON CONFLICT (source_id) DO UPDATE SET
    source_modified_at = EXCLUDED.source_modified_at,
    raw_payload        = EXCLUDED.raw_payload,
    ingested_at        = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── user_identity upsert ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_user_identity(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT
      r->>'zoho_user_id'                AS zoho_user_id,
      r->>'full_name'                   AS full_name,
      NULLIF(r->>'email','')            AS email,
      NULLIF(r->>'profile_name','')     AS profile_name,
      (r->>'role_derived')::rep_role    AS role_derived,
      COALESCE((r->>'active')::BOOLEAN, TRUE) AS active
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.user_identity (
    zoho_user_id, full_name, email, profile_name, role_derived, active, updated_at
  )
  SELECT zoho_user_id, full_name, email, profile_name, role_derived, active, NOW()
  FROM input
  ON CONFLICT (zoho_user_id) DO UPDATE SET
    full_name    = EXCLUDED.full_name,
    email        = EXCLUDED.email,
    profile_name = EXCLUDED.profile_name,
    role_derived = EXCLUDED.role_derived,
    active       = EXCLUDED.active,
    updated_at   = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Mapping read (single round trip from edge function) ────────────────────

CREATE OR REPLACE FUNCTION public.reporting_load_mappings()
RETURNS TABLE (
  kind       TEXT,
  raw_value  TEXT,
  normalized TEXT
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
  SELECT 'stage',           raw_value, normalized_value::text FROM reporting.stage_mapping
  UNION ALL
  SELECT 'pipeline',        raw_value, normalized_value::text FROM reporting.pipeline_mapping
  UNION ALL
  SELECT 'loc',             raw_value, normalized_value::text FROM reporting.loc_mapping
  UNION ALL
  SELECT 'source_category', raw_value, normalized_value::text FROM reporting.source_category_mapping;
$$;

-- ── Sync failure logger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_log_sync_failure(
  p_sync_run_id  UUID,
  p_source       TEXT,
  p_failure_type TEXT,
  p_source_id    TEXT  DEFAULT NULL,
  p_raw_value    TEXT  DEFAULT NULL,
  p_raw_payload  JSONB DEFAULT NULL,
  p_error        TEXT  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
BEGIN
  INSERT INTO reporting.sync_failures (
    sync_run_id, source, source_id, failure_type, raw_value, raw_payload, error_message
  )
  VALUES (
    p_sync_run_id, p_source, p_source_id, p_failure_type, p_raw_value, p_raw_payload, p_error
  );
END;
$$;

-- ── Permissions: service_role only ────────────────────────────────────────
-- Revoke from public/anon/authenticated; grant only to service_role so the
-- only callers are the sync edge functions.

DO $$
DECLARE fn TEXT;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'reporting_start_sync_run(text,text,timestamptz)',
    'reporting_finish_sync_run(uuid,text,integer,integer,text)',
    'reporting_upsert_raw_zoho_crm_users(jsonb)',
    'reporting_upsert_raw_zoho_crm_deals(jsonb)',
    'reporting_upsert_raw_zoho_analytics_leads(jsonb)',
    'reporting_upsert_raw_zoho_crm_meetings(jsonb)',
    'reporting_upsert_raw_ctm_calls(jsonb)',
    'reporting_upsert_user_identity(jsonb)',
    'reporting_load_mappings()',
    'reporting_log_sync_failure(uuid,text,text,text,text,jsonb,text)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END$$;
