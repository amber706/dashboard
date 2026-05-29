-- ───────────────────────────────────────────────────────────────────────────
-- Migration 176 — Sales + placement cycle RPCs (Phase 1C)
--
-- /analytics/op-sales-cycle reads these. The two cycle tables are built by
-- reporting_build_op_metrics from `deals.closing_date - deals.lead_created_time`
-- on top-line admits / closed-referred-out deals respectively. The third
-- function reports coverage of the Lead_Created_Time field across all deals
-- so the UI can show a clear "Zoho workflow not yet configured" banner
-- (OPEN_QUESTIONS #37).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_sales_cycle_daily(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  date                       DATE,
  source_category            source_category,
  level_of_care_admitted     level_of_care,
  avg_days                   NUMERIC(8,2),
  p50_days                   NUMERIC(8,2),
  p90_days                   NUMERIC(8,2),
  sample_size                INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT d.date, d.source_category, d.level_of_care_admitted,
           d.avg_days, d.p50_days, d.p90_days, d.sample_size
    FROM reporting.op_sales_cycle_daily d
    WHERE d.date BETWEEN p_start AND p_end
    ORDER BY d.date DESC, d.sample_size DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_placement_cycle_daily(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  date                       DATE,
  source_category            source_category,
  refer_out_type             TEXT,
  avg_days                   NUMERIC(8,2),
  p50_days                   NUMERIC(8,2),
  p90_days                   NUMERIC(8,2),
  sample_size                INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT d.date, d.source_category, d.refer_out_type,
           d.avg_days, d.p50_days, d.p90_days, d.sample_size
    FROM reporting.op_placement_cycle_daily d
    WHERE d.date BETWEEN p_start AND p_end
    ORDER BY d.date DESC, d.sample_size DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_lead_created_time_coverage()
RETURNS TABLE (
  total_deals             INTEGER,
  with_lead_created_time  INTEGER,
  coverage_share          NUMERIC(6,4)
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT
      COUNT(*)::INT,
      COUNT(*) FILTER (WHERE lead_created_time IS NOT NULL)::INT,
      CASE WHEN COUNT(*) > 0
           THEN ROUND(COUNT(*) FILTER (WHERE lead_created_time IS NOT NULL)::NUMERIC / COUNT(*), 4)
           ELSE NULL END
    FROM reporting.deals;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_sales_cycle_daily(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_placement_cycle_daily(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_lead_created_time_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_sales_cycle_daily(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_placement_cycle_daily(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reporting_op_lead_created_time_coverage() TO authenticated, service_role;
