-- ─────────────────────────────────────────────────────────────────
-- Migration 186 — reporting_op_leads_conversion_split RPC
--
-- Returns converted / not-converted / unknown counts for leads in
-- the window (by Phoenix-local created_at). Powers the "Converted
-- leads" table on /analytics/op-payer-mix.
--
-- "Unknown" = rows where is_converted IS NULL because the lead was
-- synced before the Zoho Analytics report exposed the "Is Converted"
-- column. A re-sync clears it (until then, it's a known data gap).
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_leads_conversion_split(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE(
  total_leads     INTEGER,
  converted       INTEGER,
  not_converted   INTEGER,
  unknown         INTEGER,
  conversion_rate NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    WITH base AS (
      SELECT l.is_converted
      FROM reporting.leads l
      WHERE (l.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end
    )
    SELECT
      COUNT(*)::INT,
      COUNT(*) FILTER (WHERE is_converted = TRUE)::INT,
      COUNT(*) FILTER (WHERE is_converted = FALSE)::INT,
      COUNT(*) FILTER (WHERE is_converted IS NULL)::INT,
      CASE
        WHEN COUNT(*) FILTER (WHERE is_converted IS NOT NULL) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE is_converted = TRUE)::NUMERIC
            / NULLIF(COUNT(*) FILTER (WHERE is_converted IS NOT NULL), 0),
            4
          )
        ELSE NULL
      END
    FROM base;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_leads_conversion_split(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_leads_conversion_split(DATE, DATE) TO authenticated, service_role;
