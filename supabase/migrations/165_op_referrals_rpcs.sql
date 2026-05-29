-- ───────────────────────────────────────────────────────────────────────────
-- Migration 165 — Referrals RPCs (Phase 1C)
--
-- Two RPCs powering /analytics/op-referrals:
--   - reporting_op_referrals_daily: daily series split by source_category
--     (BD vs Digital vs ZocDoc/other) + the closed referred-out count.
--   - reporting_op_referred_out_breakdown: refer_out_type × pipeline
--     rollup across the window (Phase 1 CONFIRMED.md #37 — six categories
--     of Detox/Residential/Psych × Attached/Unattached).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_referrals_daily(
  p_start DATE,
  p_end   DATE
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
  IF NOT reporting.is_manager_or_admin() THEN
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
    GROUP BY d.date
    ORDER BY d.date;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_referred_out_breakdown(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  refer_out_type             TEXT,
  pipeline                   pipeline,
  count                      INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT reporting.is_manager_or_admin() THEN
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
    GROUP BY d.refer_out_type, d.pipeline
    ORDER BY COALESCE(SUM(d.referred_out_closed_count), 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_referrals_daily(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_referred_out_breakdown(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_referrals_daily(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_referred_out_breakdown(DATE, DATE) TO authenticated, service_role;
