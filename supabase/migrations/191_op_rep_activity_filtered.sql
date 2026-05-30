-- ───────────────────────────────────────────────────────────────────────────
-- Migration 191 — Filtered variant of reporting_op_rep_activity
--
-- Op Overview's Rep Activity card (and the upstream /analytics/op-rep-activity
-- detail page) needs to honor the FilterBar's `reps` selection. Until now the
-- only RPC was `reporting_op_rep_activity(p_start, p_end)` — the Op Overview
-- page surfaced a disclaimer explaining that the card did NOT honor the
-- filters above it. This migration ships the matching filtered RPC so we can
-- drop that disclaimer.
--
-- Scope of dimensions:
--   - `p_owner_user_ids UUID[]` — the only dim that's meaningful here. Limits
--     the result set to the selected reps.
--   - Pipeline / source_category / level_of_care are intentionally NOT applied.
--     `op_rep_activity_daily` is built from `reporting.calls` +
--     `reporting.meetings`, neither of which carries pipeline/source/LOC. A
--     proper "rep activity within pipeline X" view would require joining
--     calls↔leads↔deals through lead_id, which is out of scope for Phase 1C
--     (and arguably out of scope for the metric itself — call-center activity
--     is owner-scoped, not pipeline-scoped).
--
-- Mirrors the SECURITY DEFINER + manager-gate pattern used by the other op_*
-- RPCs (migrations 164, 173, 175).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_rep_activity_filtered(
  p_start            DATE,
  p_end              DATE,
  p_owner_user_ids   UUID[] DEFAULT NULL
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
              AND (p_owner_user_ids IS NULL OR a2.owner_user_id = ANY(p_owner_user_ids))
          ) per_row
          GROUP BY k
        ) merged
      ) AS meetings_by_type_merged,
      COUNT(DISTINCT a.date)::INT AS active_days
    FROM reporting.op_rep_activity_daily a
    LEFT JOIN reporting.user_identity ui ON ui.id = a.owner_user_id
    WHERE a.date BETWEEN p_start AND p_end
      AND (p_owner_user_ids IS NULL OR a.owner_user_id = ANY(p_owner_user_ids))
    GROUP BY a.owner_user_id, ui.full_name, ui.role_derived
    ORDER BY COALESCE(SUM(a.inbound_calls + a.outbound_calls), 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_rep_activity_filtered(DATE, DATE, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_rep_activity_filtered(DATE, DATE, UUID[]) TO authenticated, service_role;
