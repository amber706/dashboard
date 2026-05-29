-- ───────────────────────────────────────────────────────────────────────────
-- Migration 170 — Data quality wrappers (Phase 1C)
--
-- Three manager/admin-gated RPCs that wrap the migration-160 views for the
-- /analytics/op-data-quality UI:
--   - reporting_op_data_quality_summary: counts per category (unmapped_*,
--     orphan_*, sync_failures_recent) for the KPI tiles.
--   - reporting_op_sync_health: one row per sync function from
--     v_sync_health, for the per-function health table.
--   - reporting_op_sync_failures_recent: unresolved failures from
--     v_sync_failures_recent (last 7 days, bucketed by source +
--     failure_type), for the triage table.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_data_quality_summary()
RETURNS TABLE (
  category   TEXT,
  count      INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT 'unmapped_sources',     COUNT(*)::INT FROM reporting.v_unmapped_sources
    UNION ALL
    SELECT 'unmapped_locs',        COUNT(*)::INT FROM reporting.v_unmapped_locs
    UNION ALL
    SELECT 'unmapped_stages',      COUNT(*)::INT FROM reporting.v_unmapped_stages
    UNION ALL
    SELECT 'unmapped_pipelines',   COUNT(*)::INT FROM reporting.v_unmapped_pipelines
    UNION ALL
    SELECT 'orphan_deals',         COUNT(*)::INT FROM reporting.v_orphan_deals
    UNION ALL
    SELECT 'orphan_calls',         COUNT(*)::INT FROM reporting.v_orphan_calls
    UNION ALL
    SELECT 'sync_failures_recent', COALESCE(SUM(n), 0)::INT FROM reporting.v_sync_failures_recent;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_sync_health()
RETURNS TABLE (
  function_name              TEXT,
  last_started_at            TIMESTAMPTZ,
  last_finished_at           TIMESTAMPTZ,
  last_status                TEXT,
  last_rows_processed        INTEGER,
  last_rows_failed           INTEGER,
  last_error_message         TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT v.function_name,
           v.last_started_at,
           v.last_finished_at,
           v.last_status,
           v.last_rows_processed,
           v.last_rows_failed,
           v.last_error_message
    FROM reporting.v_sync_health v
    ORDER BY v.function_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_sync_failures_recent()
RETURNS TABLE (
  source             TEXT,
  failure_type       TEXT,
  n                  BIGINT,
  last_occurred_at   TIMESTAMPTZ,
  sample_raw_value   TEXT,
  sample_error       TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT v.source, v.failure_type, v.n, v.last_occurred_at, v.sample_raw_value, v.sample_error
    FROM reporting.v_sync_failures_recent v
    ORDER BY v.n DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_data_quality_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_sync_health() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_sync_failures_recent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_data_quality_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_sync_health() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_sync_failures_recent() TO authenticated, service_role;
