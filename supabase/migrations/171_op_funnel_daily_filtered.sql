-- ───────────────────────────────────────────────────────────────────────────
-- Migration 171 — Filtered funnel RPC (Phase 1C FilterBar)
--
-- Sister function to reporting_op_funnel_daily that accepts optional
-- Pipeline / Source Category / LOC arrays. NULL arrays disable each
-- filter; filters compose AND.
--
-- Distinct name (vs an overload of reporting_op_funnel_daily) so callers
-- are unambiguous and existing useOpFunnel hooks keep working without
-- changes. The TS hook routes between the two based on whether any
-- filters are active.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_daily_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  date                  DATE,
  leads_count           INTEGER,
  mqls_count            INTEGER,
  vobs_count            INTEGER,
  admits_count          INTEGER,
  closed_lost_count     INTEGER,
  referred_out_count    INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      d.date,
      COALESCE(SUM(d.leads_count), 0)::INT,
      COALESCE(SUM(d.mqls_count), 0)::INT,
      COALESCE(SUM(d.vobs_count), 0)::INT,
      COALESCE(SUM(d.admits_count), 0)::INT,
      COALESCE(SUM(d.closed_lost_count), 0)::INT,
      COALESCE(SUM(d.referred_out_count), 0)::INT
    FROM reporting.op_lead_funnel_daily d
    WHERE d.date BETWEEN p_start AND p_end
      AND (p_pipelines         IS NULL OR d.pipeline::TEXT       = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR d.source_category::TEXT = ANY(p_source_categories))
      AND (p_locs              IS NULL OR d.level_of_care::TEXT  = ANY(p_locs))
    GROUP BY d.date
    ORDER BY d.date;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_daily_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_daily_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) TO authenticated, service_role;
