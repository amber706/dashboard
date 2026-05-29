-- ───────────────────────────────────────────────────────────────────────────
-- Migration 173 — Filtered variants for referrals + payer-mix (Phase 1C)
--
-- Referrals honors pipeline + source filters (its cache has both columns);
-- LOC isn't a dimension on op_referrals_daily so the page surfaces a note
-- when a LOC filter is active.
--
-- Payer mix honors source + LOC filters (reads reporting.leads directly);
-- pipeline isn't a dimension on a Lead (only Deal-side), so the page
-- surfaces a note when a Pipeline filter is active.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_referrals_daily_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL
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
    GROUP BY d.date
    ORDER BY d.date;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_referred_out_breakdown_filtered(
  p_start              DATE,
  p_end                DATE,
  p_pipelines          TEXT[] DEFAULT NULL,
  p_source_categories  TEXT[] DEFAULT NULL
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
    GROUP BY d.refer_out_type, d.pipeline
    ORDER BY COALESCE(SUM(d.referred_out_closed_count), 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_payer_mix_filtered(
  p_start              DATE,
  p_end                DATE,
  p_source_categories  TEXT[] DEFAULT NULL,
  p_locs               TEXT[] DEFAULT NULL
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

REVOKE ALL ON FUNCTION public.reporting_op_referrals_daily_filtered(DATE, DATE, TEXT[], TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_referred_out_breakdown_filtered(DATE, DATE, TEXT[], TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_payer_mix_filtered(DATE, DATE, TEXT[], TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_referrals_daily_filtered(DATE, DATE, TEXT[], TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_referred_out_breakdown_filtered(DATE, DATE, TEXT[], TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_payer_mix_filtered(DATE, DATE, TEXT[], TEXT[]) TO authenticated, service_role;
