-- ───────────────────────────────────────────────────────────────────────────
-- Migration 151 — Op-metric builder RPC (Phase 1B chunk 3)
--
-- Rebuilds the six op_* daily rollup tables over a trailing window of
-- `p_days_back` days (default 14). Idempotent: DELETEs the window first,
-- then INSERTs fresh rows from reporting.leads / deals / meetings / calls.
--
-- All counts are Phoenix-local dates. The window is
--   [today - p_days_back, today]
-- inclusive on both ends — closed upper bound matters because meeting
-- `occurred_at` can sit in the future (scheduled events).
--
-- The predicates here mirror src/lib/metrics/definitions.ts. When changing
-- one, change the other. The verifier in chunk 4 cross-checks the two.
--
-- Notes about Postgres-specific quirks encoded:
--   - `NULL::pipeline` (and similar casts) are required because Postgres
--     can't infer the target enum type from a bare NULL inside an INSERT.
--   - `DATE - DATE = INTEGER` (days). Don't EXTRACT(EPOCH FROM …) — that's
--     for intervals, not date subtraction.
--   - The ON CONFLICT clauses use `WHERE TRUE` to satisfy the partial-index
--     matching rule for unique indexes built with NULLS NOT DISTINCT.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_build_op_metrics(p_days_back INTEGER DEFAULT 14)
RETURNS TABLE (
  table_name      TEXT,
  rows_written    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
DECLARE
  v_today  DATE := (NOW() AT TIME ZONE 'America/Phoenix')::DATE;
  v_cutoff DATE := v_today - p_days_back;
  v_count  INTEGER;
BEGIN
  -- ── op_lead_funnel_daily ───────────────────────────────────────────────
  DELETE FROM reporting.op_lead_funnel_daily WHERE date >= v_cutoff;

  -- leads_count from reporting.leads (pipeline IS NULL — leads have no pipeline)
  INSERT INTO reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care, leads_count)
  SELECT
    (l.created_at AT TIME ZONE 'America/Phoenix')::DATE,
    l.owner_user_id,
    l.source_category,
    NULL::pipeline,
    l.level_of_care_requested,
    COUNT(*)
  FROM reporting.leads l
  WHERE (l.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, level_of_care) WHERE TRUE
  DO UPDATE SET leads_count = EXCLUDED.leads_count, built_at = NOW();

  -- mqls_count from reporting.deals (deal exists = MQL per METRIC_DEFINITIONS §4)
  INSERT INTO reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care, mqls_count)
  SELECT
    (d.created_at AT TIME ZONE 'America/Phoenix')::DATE,
    d.owner_user_id,
    d.source_category,
    d.pipeline,
    d.level_of_care_requested,
    COUNT(*)
  FROM reporting.deals d
  WHERE (d.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, level_of_care) WHERE TRUE
  DO UPDATE SET mqls_count = EXCLUDED.mqls_count, built_at = NOW();

  -- vobs_count — vob_submitted_date NOT NULL (strict signal).
  -- Deals with vob_submitted=true but no date are not attributable to a
  -- specific Phoenix day in Phase 1B; documented in METRIC_DEFINITIONS §5.
  INSERT INTO reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care, vobs_count)
  SELECT
    d.vob_submitted_date,
    d.owner_user_id,
    d.source_category,
    d.pipeline,
    d.level_of_care_requested,
    COUNT(*)
  FROM reporting.deals d
  WHERE d.vob_submitted_date BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, level_of_care) WHERE TRUE
  DO UPDATE SET vobs_count = EXCLUDED.vobs_count, built_at = NOW();

  -- admits_count — COALESCE(admit_date, closing_date) per CONFIRMED.md #34.
  -- Admit predicate: admit_date IS NOT NULL OR stage_category = 'closed_won_admitted'.
  -- LOC source: admitted_level_of_care (CONFIRMED.md #21).
  INSERT INTO reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care, admits_count)
  SELECT
    COALESCE(d.admit_date, d.closing_date),
    d.owner_user_id,
    d.source_category,
    d.pipeline,
    d.admitted_level_of_care,
    COUNT(*)
  FROM reporting.deals d
  WHERE (d.admit_date IS NOT NULL OR d.stage_category = 'closed_won_admitted')
    AND COALESCE(d.admit_date, d.closing_date) BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, level_of_care) WHERE TRUE
  DO UPDATE SET admits_count = EXCLUDED.admits_count, built_at = NOW();

  -- closed_lost_count — closing_date.
  INSERT INTO reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care, closed_lost_count)
  SELECT
    d.closing_date,
    d.owner_user_id,
    d.source_category,
    d.pipeline,
    d.level_of_care_requested,
    COUNT(*)
  FROM reporting.deals d
  WHERE d.stage_category = 'closed_lost'
    AND d.closing_date BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, level_of_care) WHERE TRUE
  DO UPDATE SET closed_lost_count = EXCLUDED.closed_lost_count, built_at = NOW();

  -- referred_out_count — closing_date for closed_won_referred_out_unattached.
  INSERT INTO reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care, referred_out_count)
  SELECT
    d.closing_date,
    d.owner_user_id,
    d.source_category,
    d.pipeline,
    d.level_of_care_requested,
    COUNT(*)
  FROM reporting.deals d
  WHERE d.stage_category = 'closed_won_referred_out_unattached'
    AND d.closing_date BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, level_of_care) WHERE TRUE
  DO UPDATE SET referred_out_count = EXCLUDED.referred_out_count, built_at = NOW();

  SELECT COUNT(*) INTO v_count FROM reporting.op_lead_funnel_daily WHERE date >= v_cutoff;
  table_name := 'op_lead_funnel_daily'; rows_written := v_count; RETURN NEXT;

  -- ── op_rep_activity_daily ─────────────────────────────────────────────
  DELETE FROM reporting.op_rep_activity_daily WHERE date >= v_cutoff;

  WITH calls_agg AS (
    SELECT
      (c.occurred_at AT TIME ZONE 'America/Phoenix')::DATE AS date,
      c.owner_user_id,
      COUNT(*) FILTER (WHERE c.direction = 'inbound')                       AS inbound_calls,
      COUNT(*) FILTER (WHERE c.direction = 'outbound')                      AS outbound_calls,
      COUNT(*) FILTER (WHERE c.missed = TRUE)                               AS missed_calls,
      COUNT(*) FILTER (WHERE c.duration_sec IS NOT NULL AND c.duration_sec >= 120) AS calls_over_2min
    FROM reporting.calls c
    WHERE (c.occurred_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN v_cutoff AND v_today
    GROUP BY 1, 2
  ),
  meetings_agg AS (
    SELECT
      m.date,
      m.host_user_id AS owner_user_id,
      SUM(m.mt_count) AS meetings_count,
      jsonb_object_agg(m.meeting_type, m.mt_count) AS meetings_by_type
    FROM (
      SELECT
        (occurred_at AT TIME ZONE 'America/Phoenix')::DATE AS date,
        host_user_id,
        meeting_type,
        COUNT(*) AS mt_count
      FROM reporting.meetings
      WHERE (occurred_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN v_cutoff AND v_today
      GROUP BY 1, 2, 3
    ) m
    GROUP BY 1, 2
  ),
  combined AS (
    SELECT date, owner_user_id FROM calls_agg
    UNION
    SELECT date, owner_user_id FROM meetings_agg
  )
  INSERT INTO reporting.op_rep_activity_daily (
    date, owner_user_id,
    inbound_calls, outbound_calls, missed_calls, calls_over_2min,
    meetings_count, meetings_by_type
  )
  SELECT
    cmb.date, cmb.owner_user_id,
    COALESCE(c.inbound_calls, 0),
    COALESCE(c.outbound_calls, 0),
    COALESCE(c.missed_calls, 0),
    COALESCE(c.calls_over_2min, 0),
    COALESCE(m.meetings_count, 0),
    COALESCE(m.meetings_by_type, '{}'::jsonb)
  FROM combined cmb
  LEFT JOIN calls_agg    c ON c.date = cmb.date AND c.owner_user_id IS NOT DISTINCT FROM cmb.owner_user_id
  LEFT JOIN meetings_agg m ON m.date = cmb.date AND m.owner_user_id IS NOT DISTINCT FROM cmb.owner_user_id;

  SELECT COUNT(*) INTO v_count FROM reporting.op_rep_activity_daily WHERE date >= v_cutoff;
  table_name := 'op_rep_activity_daily'; rows_written := v_count; RETURN NEXT;

  -- ── op_conversion_rates_daily ─────────────────────────────────────────
  -- Trailing 30-day rates per scope. Scopes computed: overall + per pipeline.
  DELETE FROM reporting.op_conversion_rates_daily WHERE date >= v_cutoff;

  WITH dates AS (
    SELECT generate_series(v_cutoff, v_today, '1 day'::interval)::DATE AS d
  ),
  scope_rows AS (
    SELECT d.d AS date, '{}'::jsonb AS scope_dimensions, NULL::pipeline AS pipeline_filter
    FROM dates d
    UNION ALL
    SELECT d.d, jsonb_build_object('pipeline', p::text), p::pipeline
    FROM dates d
    CROSS JOIN (VALUES ('commercial_cash'), ('ahcccs'), ('zocdoc'), ('dui_cash'), ('dv_cash')) AS pipelines(p)
  ),
  with_counts AS (
    SELECT
      sr.date,
      sr.scope_dimensions,
      (
        SELECT COUNT(*) FROM reporting.leads l
        WHERE (l.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN sr.date - 29 AND sr.date
      ) AS leads_n,
      (
        SELECT COUNT(*) FROM reporting.deals d
        WHERE (d.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN sr.date - 29 AND sr.date
          AND (sr.pipeline_filter IS NULL OR d.pipeline = sr.pipeline_filter)
      ) AS mqls_n,
      (
        SELECT COUNT(*) FROM reporting.deals d
        WHERE d.vob_submitted_date IS NOT NULL
          AND d.vob_submitted_date BETWEEN sr.date - 29 AND sr.date
          AND (sr.pipeline_filter IS NULL OR d.pipeline = sr.pipeline_filter)
      ) AS vobs_n,
      (
        SELECT COUNT(*) FROM reporting.deals d
        WHERE (d.admit_date IS NOT NULL OR d.stage_category = 'closed_won_admitted')
          AND COALESCE(d.admit_date, d.closing_date) BETWEEN sr.date - 29 AND sr.date
          AND (sr.pipeline_filter IS NULL OR d.pipeline = sr.pipeline_filter)
      ) AS admits_n
    FROM scope_rows sr
  )
  INSERT INTO reporting.op_conversion_rates_daily (
    date, scope_dimensions,
    lead_to_mql, mql_to_vob, vob_to_admit, mql_to_admit,
    numerator_admits, numerator_vobs, numerator_mqls, numerator_leads
  )
  SELECT
    date, scope_dimensions,
    CASE WHEN leads_n  > 0 THEN ROUND(mqls_n::NUMERIC   / leads_n,  4) END,
    CASE WHEN mqls_n   > 0 THEN ROUND(vobs_n::NUMERIC   / mqls_n,   4) END,
    CASE WHEN vobs_n   > 0 THEN ROUND(admits_n::NUMERIC / vobs_n,   4) END,
    CASE WHEN mqls_n   > 0 THEN ROUND(admits_n::NUMERIC / mqls_n,   4) END,
    admits_n, vobs_n, mqls_n, leads_n
  FROM with_counts;

  SELECT COUNT(*) INTO v_count FROM reporting.op_conversion_rates_daily WHERE date >= v_cutoff;
  table_name := 'op_conversion_rates_daily'; rows_written := v_count; RETURN NEXT;

  -- ── op_sales_cycle_daily ──────────────────────────────────────────────
  -- closing_date - lead.created_at for top-line admit deals.
  -- Orphans (no matching lead via source_lead_id) excluded.
  DELETE FROM reporting.op_sales_cycle_daily WHERE date >= v_cutoff;

  INSERT INTO reporting.op_sales_cycle_daily (
    date, source_category, level_of_care_admitted,
    avg_days, p50_days, p90_days, sample_size
  )
  SELECT
    COALESCE(d.admit_date, d.closing_date) AS date,
    d.source_category,
    d.admitted_level_of_care,
    ROUND(AVG(d.closing_date - (l.created_at AT TIME ZONE 'America/Phoenix')::DATE)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (d.closing_date - (l.created_at AT TIME ZONE 'America/Phoenix')::DATE))::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (d.closing_date - (l.created_at AT TIME ZONE 'America/Phoenix')::DATE))::NUMERIC, 2),
    COUNT(*)
  FROM reporting.deals d
  JOIN reporting.leads l ON l.source_lead_id = d.source_lead_id
  WHERE (d.admit_date IS NOT NULL OR d.stage_category = 'closed_won_admitted')
    AND d.pipeline IN ('commercial_cash', 'ahcccs', 'zocdoc')
    AND COALESCE(d.admit_date, d.closing_date) BETWEEN v_cutoff AND v_today
    AND d.closing_date IS NOT NULL
  GROUP BY 1, 2, 3;

  SELECT COUNT(*) INTO v_count FROM reporting.op_sales_cycle_daily WHERE date >= v_cutoff;
  table_name := 'op_sales_cycle_daily'; rows_written := v_count; RETURN NEXT;

  -- ── op_placement_cycle_daily ──────────────────────────────────────────
  DELETE FROM reporting.op_placement_cycle_daily WHERE date >= v_cutoff;

  INSERT INTO reporting.op_placement_cycle_daily (
    date, source_category, refer_out_type,
    avg_days, p50_days, p90_days, sample_size
  )
  SELECT
    d.closing_date,
    d.source_category,
    d.refer_out_type,
    ROUND(AVG(d.closing_date - (l.created_at AT TIME ZONE 'America/Phoenix')::DATE)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (d.closing_date - (l.created_at AT TIME ZONE 'America/Phoenix')::DATE))::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (d.closing_date - (l.created_at AT TIME ZONE 'America/Phoenix')::DATE))::NUMERIC, 2),
    COUNT(*)
  FROM reporting.deals d
  JOIN reporting.leads l ON l.source_lead_id = d.source_lead_id
  WHERE d.stage_category = 'closed_won_referred_out_unattached'
    AND d.closing_date BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3;

  SELECT COUNT(*) INTO v_count FROM reporting.op_placement_cycle_daily WHERE date >= v_cutoff;
  table_name := 'op_placement_cycle_daily'; rows_written := v_count; RETURN NEXT;

  -- ── op_referrals_daily ────────────────────────────────────────────────
  DELETE FROM reporting.op_referrals_daily WHERE date >= v_cutoff;

  -- referral_in_count from reporting.leads (CONFIRMED.md #27)
  INSERT INTO reporting.op_referrals_daily (
    date, owner_user_id, source_category, pipeline, refer_out_type, referral_in_count
  )
  SELECT
    (l.created_at AT TIME ZONE 'America/Phoenix')::DATE,
    l.owner_user_id,
    l.source_category,
    NULL::pipeline,
    NULL::TEXT,
    COUNT(*)
  FROM reporting.leads l
  WHERE (l.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN v_cutoff AND v_today
    AND (
      l.source_category = 'business_development'
      OR (l.bd_rep_inbound IS NOT NULL AND TRIM(l.bd_rep_inbound) NOT IN ('', '-None-', 'None'))
    )
  GROUP BY 1, 2, 3
  ON CONFLICT (date, owner_user_id, source_category, pipeline, refer_out_type) WHERE TRUE
  DO UPDATE SET referral_in_count = EXCLUDED.referral_in_count, built_at = NOW();

  -- referred_out_closed_count from reporting.deals
  INSERT INTO reporting.op_referrals_daily (
    date, owner_user_id, source_category, pipeline, refer_out_type, referred_out_closed_count
  )
  SELECT
    d.closing_date,
    d.owner_user_id,
    d.source_category,
    d.pipeline,
    d.refer_out_type,
    COUNT(*)
  FROM reporting.deals d
  WHERE d.stage_category = 'closed_won_referred_out_unattached'
    AND d.closing_date BETWEEN v_cutoff AND v_today
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (date, owner_user_id, source_category, pipeline, refer_out_type) WHERE TRUE
  DO UPDATE SET referred_out_closed_count = EXCLUDED.referred_out_closed_count, built_at = NOW();

  SELECT COUNT(*) INTO v_count FROM reporting.op_referrals_daily WHERE date >= v_cutoff;
  table_name := 'op_referrals_daily'; rows_written := v_count; RETURN NEXT;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_build_op_metrics(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_build_op_metrics(INTEGER) TO service_role;
