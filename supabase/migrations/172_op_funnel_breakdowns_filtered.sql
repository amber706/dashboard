-- ───────────────────────────────────────────────────────────────────────────
-- Migration 172 — Filtered variants of the three breakdown RPCs (Phase 1C)
--
-- Same pattern as migration 171: distinct *_filtered names (vs overloading
-- the originals) so call sites are unambiguous, default-NULL arrays disable
-- each filter, AND composition across the three dimensions.
--
-- Used by useOpFunnelByPipeline / useOpFunnelBySource / useOpFunnelByLoc
-- when the FilterBar has any selection active.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_pipeline_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  pipeline              pipeline,
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
      d.pipeline,
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
    GROUP BY d.pipeline
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.pipeline NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_source_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL
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
      AND (p_pipelines         IS NULL OR d.pipeline::TEXT       = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR d.source_category::TEXT = ANY(p_source_categories))
      AND (p_locs              IS NULL OR d.level_of_care::TEXT  = ANY(p_locs))
    GROUP BY d.source_category
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.source_category NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_loc_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL
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
      AND (p_pipelines         IS NULL OR d.pipeline::TEXT       = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR d.source_category::TEXT = ANY(p_source_categories))
      AND (p_locs              IS NULL OR d.level_of_care::TEXT  = ANY(p_locs))
    GROUP BY d.level_of_care
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.level_of_care NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_pipeline_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_source_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_funnel_by_loc_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_pipeline_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_source_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_funnel_by_loc_filtered(DATE, DATE, TEXT[], TEXT[], TEXT[]) TO authenticated, service_role;
