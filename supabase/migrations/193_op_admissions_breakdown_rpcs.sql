-- ───────────────────────────────────────────────────────────────────────────
-- Migration 193 — Admissions-page breakdown RPCs (Phase 2A task #58)
--
-- Adds the two RPCs the Phase 2A `admissions.*` resolver registry needs but
-- doesn't yet have:
--
--   1. reporting_op_funnel_by_rep_by_loc(_filtered)
--      Powers admissions.{mqls,vobs,admits}_by_rep_by_loc. Pivots
--      op_lead_funnel_daily on (owner_user_id × level_of_care) and returns
--      one row per cell with MQL/VOB/Admit/Closed-Lost counts. Single RPC
--      serves all three matrix metrics — the resolver picks the column.
--
--   2. reporting_op_closed_lost_by_reason(_filtered)
--      Powers admissions.closed_lost_by_reason. Reads directly from
--      reporting.deals (closed_lost_reason isn't keyed on
--      op_lead_funnel_daily). The Phase 2 brief permits drill-down /
--      reason-style queries against normalized mirrors with RLS enforced.
--
-- admissions.closed_lost_by_rep is intentionally NOT a new RPC — it's a
-- thin resolver-side wrapper over the existing reporting_op_rep_funnel,
-- which already returns closed_lost_count per rep.
--
-- Both new RPCs:
--   - SECURITY DEFINER, search_path pinned
--   - manager/admin gate via reporting.is_manager_or_admin()
--   - filter args mirror migration 175 (pipelines, source_categories, locs,
--     owner_user_ids)
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. funnel_by_rep_by_loc (unfiltered) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_rep_by_loc(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  owner_user_id     UUID,
  full_name         TEXT,
  level_of_care     level_of_care,
  mqls_count        INTEGER,
  vobs_count        INTEGER,
  admits_count      INTEGER,
  closed_lost_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      f.owner_user_id,
      ui.full_name,
      f.level_of_care,
      COALESCE(SUM(f.mqls_count), 0)::INT,
      COALESCE(SUM(f.vobs_count), 0)::INT,
      COALESCE(SUM(f.admits_count), 0)::INT,
      COALESCE(SUM(f.closed_lost_count), 0)::INT
    FROM reporting.op_lead_funnel_daily f
    LEFT JOIN reporting.user_identity ui ON ui.id = f.owner_user_id
    WHERE f.date BETWEEN p_start AND p_end
    GROUP BY f.owner_user_id, ui.full_name, f.level_of_care
    ORDER BY ui.full_name NULLS LAST, f.level_of_care NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_rep_by_loc(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_rep_by_loc(DATE, DATE) TO authenticated, service_role;

-- ── 1b. funnel_by_rep_by_loc (filtered) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_rep_by_loc_filtered(
  p_start             DATE,
  p_end               DATE,
  p_pipelines         pipeline[]           DEFAULT NULL,
  p_source_categories source_category[]    DEFAULT NULL,
  p_locs              level_of_care[]      DEFAULT NULL,
  p_owner_user_ids    UUID[]               DEFAULT NULL
)
RETURNS TABLE (
  owner_user_id     UUID,
  full_name         TEXT,
  level_of_care     level_of_care,
  mqls_count        INTEGER,
  vobs_count        INTEGER,
  admits_count      INTEGER,
  closed_lost_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      f.owner_user_id,
      ui.full_name,
      f.level_of_care,
      COALESCE(SUM(f.mqls_count), 0)::INT,
      COALESCE(SUM(f.vobs_count), 0)::INT,
      COALESCE(SUM(f.admits_count), 0)::INT,
      COALESCE(SUM(f.closed_lost_count), 0)::INT
    FROM reporting.op_lead_funnel_daily f
    LEFT JOIN reporting.user_identity ui ON ui.id = f.owner_user_id
    WHERE f.date BETWEEN p_start AND p_end
      AND (p_pipelines         IS NULL OR f.pipeline         = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR f.source_category  = ANY(p_source_categories))
      AND (p_locs              IS NULL OR f.level_of_care    = ANY(p_locs))
      AND (p_owner_user_ids    IS NULL OR f.owner_user_id    = ANY(p_owner_user_ids))
    GROUP BY f.owner_user_id, ui.full_name, f.level_of_care
    ORDER BY ui.full_name NULLS LAST, f.level_of_care NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_rep_by_loc_filtered(DATE, DATE, pipeline[], source_category[], level_of_care[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_rep_by_loc_filtered(DATE, DATE, pipeline[], source_category[], level_of_care[], UUID[]) TO authenticated, service_role;

-- ── 2. closed_lost_by_reason (unfiltered) ─────────────────────────────────
-- closed_lost_reason isn't pivoted into op_lead_funnel_daily — the brief
-- says it's a drill-down-style read that goes through the normalized mirror.
-- We attribute by closing_date so the time window matches the existing
-- closed_lost_count metric (CONFIRMED.md #36).

CREATE OR REPLACE FUNCTION public.reporting_op_closed_lost_by_reason(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  closed_lost_reason TEXT,
  count              INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(d.closed_lost_reason, '(none)')::TEXT,
      COUNT(*)::INT
    FROM reporting.deals d
    WHERE d.stage_category = 'closed_lost'
      AND d.closing_date BETWEEN p_start AND p_end
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_closed_lost_by_reason(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_closed_lost_by_reason(DATE, DATE) TO authenticated, service_role;

-- ── 2b. closed_lost_by_reason (filtered) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_closed_lost_by_reason_filtered(
  p_start             DATE,
  p_end               DATE,
  p_pipelines         pipeline[]           DEFAULT NULL,
  p_source_categories source_category[]    DEFAULT NULL,
  p_locs              level_of_care[]      DEFAULT NULL,
  p_owner_user_ids    UUID[]               DEFAULT NULL
)
RETURNS TABLE (
  closed_lost_reason TEXT,
  count              INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(d.closed_lost_reason, '(none)')::TEXT,
      COUNT(*)::INT
    FROM reporting.deals d
    WHERE d.stage_category = 'closed_lost'
      AND d.closing_date BETWEEN p_start AND p_end
      -- LOC filter applies to the requested LOC on the deal — matches the
      -- semantics of MQL/VOB by-LOC views.
      AND (p_pipelines         IS NULL OR d.pipeline                = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR d.source_category          = ANY(p_source_categories))
      AND (p_locs              IS NULL OR d.level_of_care_requested  = ANY(p_locs))
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id            = ANY(p_owner_user_ids))
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_closed_lost_by_reason_filtered(DATE, DATE, pipeline[], source_category[], level_of_care[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_closed_lost_by_reason_filtered(DATE, DATE, pipeline[], source_category[], level_of_care[], UUID[]) TO authenticated, service_role;
