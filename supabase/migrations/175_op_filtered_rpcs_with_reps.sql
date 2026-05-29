-- ───────────────────────────────────────────────────────────────────────────
-- Migration 175 — Thread p_owner_user_ids through every filtered op_* RPC
--
-- The Sales Rep dimension completes the FilterBar's §26 contract. Each
-- filtered RPC grows a new optional `p_owner_user_ids UUID[]` parameter;
-- NULL means "all reps" (preserves existing call signatures via parameter
-- defaults — postgres uses positional + defaults, so adding at the end is
-- backward compatible for all existing supabase-js call sites).
--
-- This file is the canonical post-migration definition; individual RPCs
-- were updated CREATE OR REPLACE in the same session via the MCP. Apply
-- this file to bring fresh environments up to the same state.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_daily_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
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
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id        = ANY(p_owner_user_ids))
    GROUP BY d.date
    ORDER BY d.date;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_pipeline_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
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
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id        = ANY(p_owner_user_ids))
    GROUP BY d.pipeline
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.pipeline NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_source_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
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
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id        = ANY(p_owner_user_ids))
    GROUP BY d.source_category
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.source_category NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_funnel_by_loc_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
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
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id        = ANY(p_owner_user_ids))
    GROUP BY d.level_of_care
    ORDER BY COALESCE(SUM(d.admits_count), 0) DESC NULLS LAST, d.level_of_care NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_referrals_daily_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
)
RETURNS TABLE (
  date                       DATE,
  bd_referrals_in            INTEGER,
  digital_referrals_in       INTEGER,
  other_referrals_in         INTEGER,
  referred_out_closed_count  INTEGER
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
      COALESCE(SUM(d.referral_in_count) FILTER (WHERE d.source_category = 'business_development'), 0)::INT,
      COALESCE(SUM(d.referral_in_count) FILTER (WHERE d.source_category = 'digital_marketing'), 0)::INT,
      COALESCE(SUM(d.referral_in_count) FILTER (WHERE d.source_category = 'zocdoc'), 0)::INT,
      COALESCE(SUM(d.referred_out_closed_count), 0)::INT
    FROM reporting.op_referrals_daily d
    WHERE d.date BETWEEN p_start AND p_end
      AND (p_pipelines         IS NULL OR d.pipeline::TEXT         = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR d.source_category::TEXT  = ANY(p_source_categories))
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id          = ANY(p_owner_user_ids))
    GROUP BY d.date
    ORDER BY d.date;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_referred_out_breakdown_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
)
RETURNS TABLE (
  refer_out_type             TEXT,
  pipeline                   pipeline,
  count                      INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      d.refer_out_type,
      d.pipeline,
      COALESCE(SUM(d.referred_out_closed_count), 0)::INT
    FROM reporting.op_referrals_daily d
    WHERE d.date BETWEEN p_start AND p_end
      AND d.referred_out_closed_count > 0
      AND (p_pipelines         IS NULL OR d.pipeline::TEXT         = ANY(p_pipelines))
      AND (p_source_categories IS NULL OR d.source_category::TEXT  = ANY(p_source_categories))
      AND (p_owner_user_ids    IS NULL OR d.owner_user_id          = ANY(p_owner_user_ids))
    GROUP BY d.refer_out_type, d.pipeline
    ORDER BY COALESCE(SUM(d.referred_out_closed_count), 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_payer_mix_filtered(
  p_start              DATE,
  p_end                DATE,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL,
  p_owner_user_ids     UUID[] DEFAULT NULL
)
RETURNS TABLE (
  bucket          TEXT,
  count           INTEGER,
  share           NUMERIC(6,4)
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    WITH classified AS (
      SELECT
        CASE
          WHEN l.level_of_care_requested = 'dui' THEN 'DUI'
          WHEN l.level_of_care_requested = 'dv'  THEN 'DV'
          WHEN l.level_of_care_requested IS NULL
            OR l.level_of_care_requested NOT IN ('dui','dv') THEN
            CASE
              WHEN l.insurance_type = 'AHCCCS' THEN 'AHCCCS Lead'
              WHEN l.insurance_type IN ('Private Insurance','Cash Pay') THEN 'Commercial Lead'
              WHEN l.insurance_type IN ('Medicare','No Insurance','Out of State Medicaid') THEN 'Other Payer Lead'
              WHEN l.insurance_type IS NULL AND l.star_rating = 3 THEN 'AHCCCS Lead'
              WHEN l.insurance_type IS NULL AND l.star_rating IN (4,5) THEN 'Commercial Lead'
              ELSE 'Unclassified'
            END
          ELSE 'Unclassified'
        END AS bucket
      FROM reporting.leads l
      WHERE (l.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end
        AND (p_source_categories IS NULL OR l.source_category::TEXT       = ANY(p_source_categories))
        AND (p_locs              IS NULL OR l.level_of_care_requested::TEXT = ANY(p_locs))
        AND (p_owner_user_ids    IS NULL OR l.owner_user_id                = ANY(p_owner_user_ids))
    ),
    totals AS (SELECT COUNT(*)::NUMERIC AS n FROM classified)
    SELECT
      c.bucket,
      COUNT(*)::INT,
      CASE WHEN (SELECT n FROM totals) > 0
           THEN ROUND(COUNT(*)::NUMERIC / (SELECT n FROM totals), 4)
           ELSE NULL END
    FROM classified c
    GROUP BY c.bucket
    ORDER BY COUNT(*) DESC;
END;
$$;
