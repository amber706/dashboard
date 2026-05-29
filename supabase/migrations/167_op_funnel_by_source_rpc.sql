-- ───────────────────────────────────────────────────────────────────────────
-- Migration 167 — Funnel by Source Category RPC (Phase 1C)
--
-- Marketing-channel attribution: Digital / BD / ZocDoc rollups across the
-- date window. Mirrors reporting_op_funnel_by_pipeline (migration 163)
-- but groups on source_category instead.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_source(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  source_category       source_category,
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
      d.source_category,
      COALESCE(SUM(d.leads_count), 0)::INT,
      COALESCE(SUM(d.mqls_count), 0)::INT,
      COALESCE(SUM(d.vobs_count), 0)::INT,
      COALESCE(SUM(d.admits_count), 0)::INT,
      COALESCE(SUM(d.closed_lost_count), 0)::INT,
      COALESCE(SUM(d.referred_out_count), 0)::INT
    FROM reporting.op_lead_funnel_daily d
    WHERE d.date BETWEEN p_start AND p_end
    GROUP BY d.source_category
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.source_category NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_source(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_source(DATE, DATE) TO authenticated, service_role;
