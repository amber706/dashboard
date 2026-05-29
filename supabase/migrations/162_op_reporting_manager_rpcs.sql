-- ───────────────────────────────────────────────────────────────────────────
-- Migration 162 — Op reporting manager RPCs (Phase 1C entry point)
--
-- Wraps `reporting.op_lead_funnel_daily` for the manager/admin UI. The
-- verifier_* RPCs from migration 161 stay service_role only; this one is
-- the read path for the dashboard.
--
-- Per-pipeline and per-rep slicing will be additional RPCs as the
-- dashboard grows; this initial cut is the all-dimensions roll-up that
-- powers /analytics/op-funnel.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_daily(
  p_start DATE,
  p_end   DATE
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
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT reporting.is_manager_or_admin() THEN
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
    GROUP BY d.date
    ORDER BY d.date;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_daily(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_daily(DATE, DATE) TO authenticated, service_role;
