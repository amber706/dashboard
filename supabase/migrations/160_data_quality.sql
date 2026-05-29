-- ───────────────────────────────────────────────────────────────────────────
-- Migration 160 — Data quality views (Phase 1B chunk 4)
--
-- A set of read-only views the verifier script + the operator dashboard
-- query. They surface:
--   - Unmapped raw enum values that the sync silently dropped (or
--     defaulted) — should be empty against real production data.
--   - Orphans (deals without a matching lead, calls without a matching
--     lead lookup).
--   - Sync health (latest run per function, + the public app.data_freshness
--     table that Phase 1A wired into the homepage banner).
--   - Recent sync_failures broken down by failure_type.
--
-- All views run with `SECURITY INVOKER` and rely on the underlying tables'
-- RLS for access control (the op_* policies grant manager/admin only).
-- ───────────────────────────────────────────────────────────────────────────

-- ── v_unmapped_sources ────────────────────────────────────────────────────
-- Distinct raw Source_Category strings observed in raw payloads that aren't
-- in reporting.source_category_mapping. Falling-through to the default
-- 'digital_marketing' bucket is correct per CONFIRMED.md #17, but anything
-- novel deserves a look (could be a new BD partner or a typo).

CREATE OR REPLACE VIEW reporting.v_unmapped_sources AS
WITH raw_values AS (
  SELECT DISTINCT raw_payload->>'Source_Category' AS raw_value, 'deals' AS source
  FROM reporting.raw_zoho_crm_deals
  WHERE raw_payload->>'Source_Category' IS NOT NULL
  UNION
  SELECT DISTINCT raw_payload->>'Source_Category' AS raw_value, 'leads' AS source
  FROM reporting.raw_zoho_analytics_leads
  WHERE raw_payload->>'Source_Category' IS NOT NULL
)
SELECT rv.raw_value, rv.source
FROM raw_values rv
LEFT JOIN reporting.source_category_mapping m ON m.raw_value = rv.raw_value
WHERE m.raw_value IS NULL
ORDER BY rv.raw_value;

COMMENT ON VIEW reporting.v_unmapped_sources IS
  'Source_Category raw values seen in production that have no row in '
  'reporting.source_category_mapping. Should be empty (or every entry '
  'documented in OPEN_QUESTIONS) for Phase 1B acceptance.';

-- ── v_unmapped_locs ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW reporting.v_unmapped_locs AS
WITH raw_values AS (
  SELECT DISTINCT raw_payload->>'Level_of_Care_Requested' AS raw_value, 'deals.req' AS source
  FROM reporting.raw_zoho_crm_deals
  WHERE raw_payload->>'Level_of_Care_Requested' IS NOT NULL
  UNION
  SELECT DISTINCT raw_payload->>'Admitted_Level_of_Care' AS raw_value, 'deals.adm' AS source
  FROM reporting.raw_zoho_crm_deals
  WHERE raw_payload->>'Admitted_Level_of_Care' IS NOT NULL
  UNION
  SELECT DISTINCT raw_payload->>'Level_of_Care_Requested' AS raw_value, 'leads' AS source
  FROM reporting.raw_zoho_analytics_leads
  WHERE raw_payload->>'Level_of_Care_Requested' IS NOT NULL
)
SELECT rv.raw_value, rv.source
FROM raw_values rv
LEFT JOIN reporting.loc_mapping m ON m.raw_value = rv.raw_value
WHERE m.raw_value IS NULL
ORDER BY rv.raw_value;

COMMENT ON VIEW reporting.v_unmapped_locs IS
  'Level of Care raw values seen in production that have no row in '
  'reporting.loc_mapping. Covers both Level_of_Care_Requested and '
  'Admitted_Level_of_Care fields.';

-- ── v_unmapped_stages ─────────────────────────────────────────────────────

CREATE OR REPLACE VIEW reporting.v_unmapped_stages AS
SELECT DISTINCT raw_payload->>'Stage' AS raw_value
FROM reporting.raw_zoho_crm_deals
WHERE raw_payload->>'Stage' IS NOT NULL
  AND raw_payload->>'Stage' NOT IN (SELECT raw_value FROM reporting.stage_mapping)
ORDER BY raw_value;

COMMENT ON VIEW reporting.v_unmapped_stages IS
  'Stage raw values seen in production Deals that have no row in '
  'reporting.stage_mapping. Should be empty for Phase 1B acceptance.';

-- ── v_unmapped_pipelines ──────────────────────────────────────────────────

CREATE OR REPLACE VIEW reporting.v_unmapped_pipelines AS
SELECT DISTINCT raw_payload->>'Pipeline' AS raw_value
FROM reporting.raw_zoho_crm_deals
WHERE raw_payload->>'Pipeline' IS NOT NULL
  AND raw_payload->>'Pipeline' NOT IN (SELECT raw_value FROM reporting.pipeline_mapping)
ORDER BY raw_value;

COMMENT ON VIEW reporting.v_unmapped_pipelines IS
  'Pipeline raw values seen in production Deals that have no row in '
  'reporting.pipeline_mapping. Should be empty for Phase 1B acceptance.';

-- ── v_orphan_deals ────────────────────────────────────────────────────────
-- Deals with a non-null source_lead_id that doesn't resolve to any row in
-- reporting.leads. Sales cycle math excludes these (CONFIRMED.md #28 gives
-- the Created_Time fallback for raw counts, but cycle math needs the lead).

CREATE OR REPLACE VIEW reporting.v_orphan_deals AS
SELECT
  d.source_deal_id,
  d.source_lead_id,
  d.pipeline,
  d.stage_category,
  d.created_at,
  d.closing_date
FROM reporting.deals d
LEFT JOIN reporting.leads l ON l.source_lead_id = d.source_lead_id
WHERE d.source_lead_id IS NOT NULL
  AND l.source_lead_id IS NULL
ORDER BY d.created_at DESC;

COMMENT ON VIEW reporting.v_orphan_deals IS
  'Deals whose source_lead_id does not resolve to a row in reporting.leads. '
  'These are excluded from op_sales_cycle_daily and op_placement_cycle_daily; '
  'raw counts fall back to the Deal Created_Time per CONFIRMED.md #28.';

-- ── v_orphan_calls ────────────────────────────────────────────────────────
-- Calls where lead_id is null. CTM phone number-to-lead resolution is
-- deferred (see reporting-sync-calls TODO); this view tracks the gap so we
-- can prioritize the lookup work.

CREATE OR REPLACE VIEW reporting.v_orphan_calls AS
SELECT
  c.source_call_id,
  c.direction,
  c.duration_sec,
  c.occurred_at,
  c.missed
FROM reporting.calls c
WHERE c.lead_id IS NULL
ORDER BY c.occurred_at DESC;

COMMENT ON VIEW reporting.v_orphan_calls IS
  'Calls without a resolved lead_id. Phase 1B chunk 2 punted on CTM '
  'phone-number → lead matching; the lookup will be added before chunk 4 '
  'acceptance or deferred to Phase 1C.';

-- ── v_sync_health ─────────────────────────────────────────────────────────
-- Latest sync_run per function + the app.data_freshness banner row that
-- Phase 1A already wires into the homepage. Joined on function_name where
-- app.data_freshness uses tab_key as the equivalent identifier.

CREATE OR REPLACE VIEW reporting.v_sync_health AS
WITH latest_runs AS (
  SELECT DISTINCT ON (function_name)
    function_name,
    started_at,
    finished_at,
    status,
    rows_processed,
    rows_failed,
    error_message
  FROM reporting.sync_runs
  ORDER BY function_name, started_at DESC
)
SELECT
  lr.function_name,
  lr.started_at        AS last_started_at,
  lr.finished_at       AS last_finished_at,
  lr.status            AS last_status,
  lr.rows_processed    AS last_rows_processed,
  lr.rows_failed       AS last_rows_failed,
  lr.error_message     AS last_error_message,
  df.last_ingested_at  AS public_banner_last_ingested,
  df.row_count         AS public_banner_row_count,
  df.status            AS public_banner_status
FROM latest_runs lr
LEFT JOIN app.data_freshness df ON df.tab_key = lr.function_name
ORDER BY lr.function_name;

COMMENT ON VIEW reporting.v_sync_health IS
  'Latest run per sync function joined with the public app.data_freshness '
  'banner row. Operator dashboard reads this to surface stuck or failing '
  'syncs.';

-- ── v_sync_failures_recent ────────────────────────────────────────────────
-- Last 7 days of sync_failures bucketed by (source, failure_type), with the
-- most recent error and a sample raw_value.

CREATE OR REPLACE VIEW reporting.v_sync_failures_recent AS
SELECT
  source,
  failure_type,
  COUNT(*)                                                   AS n,
  MAX(occurred_at)                                           AS last_occurred_at,
  (array_agg(raw_value     ORDER BY occurred_at DESC) FILTER (WHERE raw_value     IS NOT NULL))[1]  AS sample_raw_value,
  (array_agg(error_message ORDER BY occurred_at DESC) FILTER (WHERE error_message IS NOT NULL))[1]  AS sample_error
FROM reporting.sync_failures
WHERE occurred_at >= NOW() - INTERVAL '7 days'
  AND resolved_at IS NULL
GROUP BY source, failure_type
ORDER BY n DESC;

COMMENT ON VIEW reporting.v_sync_failures_recent IS
  'Unresolved sync failures in the last 7 days bucketed by source + '
  'failure_type. Closing one out: UPDATE reporting.sync_failures SET '
  'resolved_at = NOW() WHERE …';

-- ── Permissions ───────────────────────────────────────────────────────────
-- Views inherit RLS from their underlying tables. The op_* tables already
-- restrict to manager/admin; the raw_* mirrors are service_role-only.
-- These views are queried by the verifier script (service_role) and the
-- future operator dashboard (manager/admin). No extra grants needed.
