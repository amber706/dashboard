-- ───────────────────────────────────────────────────────────────────────────
-- Migration 169 — Per-rep funnel attribution RPC (Phase 1C)
--
-- Closes the loop on /analytics/op-rep-activity: pairs the activity table
-- (calls + meetings the specialist generated) with the outcomes (MQLs /
-- VOBs / Admits attributable to that specialist via owner_user_id).
-- Unattributed (owner=NULL) rows are excluded — they're surfaced in the
-- separate "Unattributed calls" banner on the page.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_rep_funnel(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  owner_user_id      UUID,
  full_name          TEXT,
  role_derived       TEXT,
  mqls_count         INTEGER,
  vobs_count         INTEGER,
  admits_count       INTEGER,
  closed_lost_count  INTEGER,
  mql_to_admit       NUMERIC(6,4)
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    WITH per_rep AS (
      SELECT
        f.owner_user_id,
        SUM(f.mqls_count)::INT          AS mqls_count,
        SUM(f.vobs_count)::INT          AS vobs_count,
        SUM(f.admits_count)::INT        AS admits_count,
        SUM(f.closed_lost_count)::INT   AS closed_lost_count
      FROM reporting.op_lead_funnel_daily f
      WHERE f.date BETWEEN p_start AND p_end
      GROUP BY f.owner_user_id
    )
    SELECT
      p.owner_user_id,
      ui.full_name,
      ui.role_derived::TEXT,
      p.mqls_count,
      p.vobs_count,
      p.admits_count,
      p.closed_lost_count,
      CASE WHEN p.mqls_count > 0 THEN ROUND(p.admits_count::NUMERIC / p.mqls_count, 4) END
    FROM per_rep p
    LEFT JOIN reporting.user_identity ui ON ui.id = p.owner_user_id
    WHERE p.owner_user_id IS NOT NULL
    ORDER BY p.admits_count DESC NULLS LAST, p.mqls_count DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_rep_funnel(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_rep_funnel(DATE, DATE) TO authenticated, service_role;
