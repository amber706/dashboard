-- ─────────────────────────────────────────────────────────────────
-- Migration 189 — Drill RPC returns separate rows for DUI screening
-- and course events + event_label column.
--
-- Each DUI deal can now appear twice in the "admits" drill if both
-- Screening_Sold and Course_Sold are true — once with event_label =
-- "Screening sold" on Screening_Closed_Date, once with "Course sold"
-- on Closing_Date. Non-DUI admits get event_label = "Admit".
--
-- MQL / VOB / Closed Lost drills unchanged (one row per deal,
-- event_label = NULL).
-- ─────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.reporting_op_rep_funnel_drill(UUID, TEXT, DATE, DATE);

CREATE FUNCTION public.reporting_op_rep_funnel_drill(
  p_user_id UUID,
  p_metric  TEXT,
  p_start   DATE,
  p_end     DATE
)
RETURNS TABLE(
  source_deal_id TEXT,
  deal_name      TEXT,
  stage_raw      TEXT,
  date_key       DATE,
  event_label    TEXT
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
    SELECT d.source_deal_id::TEXT,
           COALESCE(d.deal_name, r.raw_payload->>'Deal_Name', '(no name)')::TEXT,
           d.stage_raw::TEXT,
           CASE p_metric
             WHEN 'mqls'        THEN (d.created_at AT TIME ZONE 'America/Phoenix')::DATE
             WHEN 'vobs'        THEN d.vob_submitted_date
             WHEN 'closed_lost' THEN d.closing_date
           END,
           NULL::TEXT
    FROM reporting.deals d
    LEFT JOIN reporting.raw_zoho_crm_deals r ON r.source_id = d.source_deal_id
    WHERE d.owner_user_id = p_user_id
      AND (
        (p_metric = 'mqls' AND (d.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end)
        OR (p_metric = 'vobs' AND d.vob_submitted_date BETWEEN p_start AND p_end)
        OR (p_metric = 'closed_lost' AND d.stage_category = 'closed_lost' AND d.closing_date BETWEEN p_start AND p_end)
      )
    UNION ALL
    SELECT d.source_deal_id::TEXT,
           COALESCE(d.deal_name, r.raw_payload->>'Deal_Name', '(no name)')::TEXT,
           d.stage_raw::TEXT,
           COALESCE(d.admit_date, d.closing_date),
           'Admit'::TEXT
    FROM reporting.deals d
    LEFT JOIN reporting.raw_zoho_crm_deals r ON r.source_id = d.source_deal_id
    WHERE p_metric = 'admits'
      AND d.owner_user_id = p_user_id
      AND d.pipeline IS DISTINCT FROM 'dui_cash'
      AND (d.admit_date IS NOT NULL OR d.stage_category = 'closed_won_admitted')
      AND COALESCE(d.admit_date, d.closing_date) BETWEEN p_start AND p_end
    UNION ALL
    SELECT d.source_deal_id::TEXT,
           COALESCE(d.deal_name, r.raw_payload->>'Deal_Name', '(no name)')::TEXT,
           d.stage_raw::TEXT,
           d.screening_closed_date,
           'Screening sold'::TEXT
    FROM reporting.deals d
    LEFT JOIN reporting.raw_zoho_crm_deals r ON r.source_id = d.source_deal_id
    WHERE p_metric = 'admits'
      AND d.owner_user_id = p_user_id
      AND d.pipeline = 'dui_cash'
      AND d.screening_sold = TRUE
      AND d.screening_closed_date BETWEEN p_start AND p_end
    UNION ALL
    SELECT d.source_deal_id::TEXT,
           COALESCE(d.deal_name, r.raw_payload->>'Deal_Name', '(no name)')::TEXT,
           d.stage_raw::TEXT,
           d.closing_date,
           'Course sold'::TEXT
    FROM reporting.deals d
    LEFT JOIN reporting.raw_zoho_crm_deals r ON r.source_id = d.source_deal_id
    WHERE p_metric = 'admits'
      AND d.owner_user_id = p_user_id
      AND d.pipeline = 'dui_cash'
      AND d.course_sold = TRUE
      AND d.closing_date BETWEEN p_start AND p_end
    ORDER BY 4 DESC NULLS LAST, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_rep_funnel_drill(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_rep_funnel_drill(UUID, TEXT, DATE, DATE) TO authenticated, service_role;
