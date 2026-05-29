-- ───────────────────────────────────────────────────────────────────────────
-- Migration 178 — Cache freshness RPC (Phase 1C)
--
-- Returns the latest successful (or partial) reporting-build-op-metrics
-- run. Powers the CacheFreshnessBadge mounted on every Op Reporting page.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_cache_freshness()
RETURNS TABLE (
  last_built_at  TIMESTAMPTZ,
  rows_written   INTEGER,
  status         TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      sr.finished_at  AS last_built_at,
      sr.rows_processed AS rows_written,
      sr.status::TEXT
    FROM reporting.sync_runs sr
    WHERE sr.function_name = 'reporting-build-op-metrics'
      AND sr.status IN ('success', 'partial')
    ORDER BY sr.finished_at DESC NULLS LAST
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_cache_freshness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_cache_freshness() TO authenticated, service_role;
