-- ───────────────────────────────────────────────────────────────────────────
-- Migration 168 — Funnel by Level of Care RPC (Phase 1C)
--
-- Completes the dimensional trio (pipeline / source / LOC) on op-funnel.
-- LOC rows sourced from level_of_care_requested on leads + deals (lead-side
-- rows have pipeline NULL; admits use admitted_level_of_care per
-- CONFIRMED.md #21).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_loc(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  level_of_care         level_of_care,
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
      d.level_of_care,
      COALESCE(SUM(d.leads_count), 0)::INT,
      COALESCE(SUM(d.mqls_count), 0)::INT,
      COALESCE(SUM(d.vobs_count), 0)::INT,
      COALESCE(SUM(d.admits_count), 0)::INT,
      COALESCE(SUM(d.closed_lost_count), 0)::INT,
      COALESCE(SUM(d.referred_out_count), 0)::INT
    FROM reporting.op_lead_funnel_daily d
    WHERE d.date BETWEEN p_start AND p_end
    GROUP BY d.level_of_care
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.level_of_care NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_loc(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_loc(DATE, DATE) TO authenticated, service_role;
