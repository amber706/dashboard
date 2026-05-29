-- ───────────────────────────────────────────────────────────────────────────
-- Migration 164 — Per-rep activity RPC (Phase 1C)
--
-- Powers /analytics/op-rep-activity. Sums op_rep_activity_daily across the
-- date window, joins user_identity for display name + role, and merges the
-- daily meetings_by_type JSONB into a single window total per rep.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_rep_activity(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  owner_user_id      UUID,
  full_name          TEXT,
  role_derived       TEXT,
  inbound_calls      INTEGER,
  outbound_calls     INTEGER,
  missed_calls       INTEGER,
  calls_over_2min    INTEGER,
  meetings_count     INTEGER,
  meetings_by_type   JSONB,
  active_days        INTEGER
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
      a.owner_user_id,
      ui.full_name,
      ui.role_derived::TEXT,
      COALESCE(SUM(a.inbound_calls), 0)::INT,
      COALESCE(SUM(a.outbound_calls), 0)::INT,
      COALESCE(SUM(a.missed_calls), 0)::INT,
      COALESCE(SUM(a.calls_over_2min), 0)::INT,
      COALESCE(SUM(a.meetings_count), 0)::INT,
      (
        SELECT jsonb_object_agg(k, v)
        FROM (
          SELECT k, SUM((v_str)::INT)::INT AS v
          FROM (
            SELECT (jsonb_each_text(a2.meetings_by_type)).key AS k,
                   (jsonb_each_text(a2.meetings_by_type)).value AS v_str
            FROM reporting.op_rep_activity_daily a2
            WHERE a2.date BETWEEN p_start AND p_end
              AND a2.owner_user_id IS NOT DISTINCT FROM a.owner_user_id
          ) per_row
          GROUP BY k
        ) merged
      ) AS meetings_by_type_merged,
      COUNT(DISTINCT a.date)::INT AS active_days
    FROM reporting.op_rep_activity_daily a
    LEFT JOIN reporting.user_identity ui ON ui.id = a.owner_user_id
    WHERE a.date BETWEEN p_start AND p_end
    GROUP BY a.owner_user_id, ui.full_name, ui.role_derived
    ORDER BY COALESCE(SUM(a.inbound_calls + a.outbound_calls), 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_rep_activity(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_rep_activity(DATE, DATE) TO authenticated, service_role;
