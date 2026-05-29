-- ───────────────────────────────────────────────────────────────────────────
-- Migration 183 — Per-cell drill RPC for /analytics/op-rep-activity
--
-- Returns the deal-level rows underlying a single (rep, metric, window)
-- tuple in the "Funnel by specialist" table. Powers the click-cell-to-
-- fact-check workflow: click any number (108 MQLs, 30 Admits, etc.) and
-- see the contributing deals with Zoho deep-links.
--
-- Predicates mirror the op_lead_funnel_daily build:
--   - mqls        — deal created in window (Phoenix-local date)
--   - vobs        — vob_submitted_date in window
--   - admits      — admit_date set OR stage_category IN (closed_won_admitted,
--                                                        closed_won_dui_completion),
--                   anchored on COALESCE(admit_date, closing_date)
--   - closed_lost — stage_category = closed_lost, anchored on closing_date
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_rep_funnel_drill(
  p_user_id UUID,
  p_metric  TEXT,
  p_start   DATE,
  p_end     DATE
)
RETURNS TABLE(
  source_deal_id TEXT,
  deal_name      TEXT,
  stage_raw      TEXT,
  date_key       DATE
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  IF p_metric NOT IN ('mqls','vobs','admits','closed_lost') THEN
    RAISE EXCEPTION 'invalid metric: %, expected one of mqls/vobs/admits/closed_lost', p_metric;
  END IF;

  RETURN QUERY
    SELECT
      d.source_deal_id::TEXT,
      COALESCE(r.raw_payload->>'Deal_Name', '(no name)')::TEXT AS deal_name,
      d.stage_raw::TEXT,
      CASE p_metric
        WHEN 'mqls'        THEN (d.created_at AT TIME ZONE 'America/Phoenix')::DATE
        WHEN 'vobs'        THEN d.vob_submitted_date
        WHEN 'admits'      THEN COALESCE(d.admit_date, d.closing_date)
        WHEN 'closed_lost' THEN d.closing_date
      END AS date_key
    FROM reporting.deals d
    LEFT JOIN reporting.raw_zoho_crm_deals r ON r.source_id = d.source_deal_id
    WHERE d.owner_user_id = p_user_id
      AND (
        (p_metric = 'mqls'
          AND (d.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end)
        OR (p_metric = 'vobs'
          AND d.vob_submitted_date BETWEEN p_start AND p_end)
        OR (p_metric = 'admits'
          AND (d.admit_date IS NOT NULL
               OR d.stage_category IN ('closed_won_admitted','closed_won_dui_completion'))
          AND COALESCE(d.admit_date, d.closing_date) BETWEEN p_start AND p_end)
        OR (p_metric = 'closed_lost'
          AND d.stage_category = 'closed_lost'
          AND d.closing_date BETWEEN p_start AND p_end)
      )
    ORDER BY date_key DESC NULLS LAST, deal_name;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_rep_funnel_drill(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_rep_funnel_drill(UUID, TEXT, DATE, DATE) TO authenticated, service_role;
