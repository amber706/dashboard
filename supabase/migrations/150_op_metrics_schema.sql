-- ───────────────────────────────────────────────────────────────────────────
-- Migration 150 — Cached operational metric tables (Phase 1B chunk 3)
--
-- Six daily rollup tables that the builder repopulates every morning.
-- All counts are Phoenix-local dates. Dimensions are nullable to express
-- "unattributed" buckets; NULLS NOT DISTINCT on the unique indexes makes
-- the rows addressable by an upsert.
--
-- Date column semantics differ per metric (Created_Time, VOB_Submitted_Date,
-- Admit_Date, Closing_Date, etc.) — see comments inline + the builder in
-- migration 151.
--
-- RLS shape: only manager/admin profiles read these tables. Rep-scoped
-- dashboards aggregate from the underlying mirrors (which carry their own
-- RLS); the op_* cache is the executive view.
-- ───────────────────────────────────────────────────────────────────────────

-- ── op_lead_funnel_daily ──────────────────────────────────────────────────
-- One row per (date, owner_user_id, source_category, pipeline, level_of_care).
-- Each metric column is counted on the date appropriate to that metric:
--   leads_count          → lead.created_at (Phoenix date)
--   mqls_count           → deal.created_at (Phoenix date)
--   vobs_count           → deal.vob_submitted_date (NULL deals excluded — see
--                          §5 of METRIC_DEFINITIONS.md, the boolean-only case
--                          without a date is a known Phase 1B gap)
--   admits_count         → COALESCE(deal.admit_date, deal.closing_date)
--   closed_lost_count    → deal.closing_date
--   referred_out_count   → deal.closing_date (closed_won_referred_out_unattached)
-- Pipeline is NULL for lead-stage rows; set for deal-stage rows.

CREATE TABLE IF NOT EXISTS reporting.op_lead_funnel_daily (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  date                 DATE            NOT NULL,
  owner_user_id        UUID            REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  source_category      source_category,
  pipeline             pipeline,
  level_of_care        level_of_care,
  leads_count          INTEGER         NOT NULL DEFAULT 0,
  mqls_count           INTEGER         NOT NULL DEFAULT 0,
  vobs_count           INTEGER         NOT NULL DEFAULT 0,
  admits_count         INTEGER         NOT NULL DEFAULT 0,
  closed_lost_count    INTEGER         NOT NULL DEFAULT 0,
  referred_out_count   INTEGER         NOT NULL DEFAULT 0,
  built_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_lead_funnel_daily
  ON reporting.op_lead_funnel_daily (date, owner_user_id, source_category, pipeline, level_of_care)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_op_lead_funnel_daily_date
  ON reporting.op_lead_funnel_daily (date DESC);

COMMENT ON TABLE reporting.op_lead_funnel_daily IS
  'Pre-aggregated daily funnel counts. Each metric column is counted on the '
  'date appropriate to that metric (see column comments + migration 151). '
  'Rebuilt by reporting_build_op_metrics over a trailing 14-day window.';

-- ── op_rep_activity_daily ─────────────────────────────────────────────────
-- One row per (date, owner_user_id). meetings_by_type is a jsonb dict
-- keyed by meeting_type → integer count.

CREATE TABLE IF NOT EXISTS reporting.op_rep_activity_daily (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  date               DATE         NOT NULL,
  owner_user_id      UUID         REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  inbound_calls      INTEGER      NOT NULL DEFAULT 0,
  outbound_calls     INTEGER      NOT NULL DEFAULT 0,
  missed_calls       INTEGER      NOT NULL DEFAULT 0,
  calls_over_2min    INTEGER      NOT NULL DEFAULT 0,
  meetings_count     INTEGER      NOT NULL DEFAULT 0,
  meetings_by_type   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  built_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_rep_activity_daily
  ON reporting.op_rep_activity_daily (date, owner_user_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_op_rep_activity_daily_date
  ON reporting.op_rep_activity_daily (date DESC);

COMMENT ON TABLE reporting.op_rep_activity_daily IS
  'Per-rep daily call + meeting activity. Source: reporting.calls + '
  'reporting.meetings. calls_over_2min counts calls with duration_sec >= 120.';

-- ── op_conversion_rates_daily ─────────────────────────────────────────────
-- Trailing-30-day conversion ratios per scope. scope_dimensions is a jsonb
-- dict describing the slice (e.g., {"pipeline":"commercial_cash"} or
-- {"source_category":"business_development","pipeline":"ahcccs"} or {} for
-- overall). All ratios are NULL when the denominator is zero.

CREATE TABLE IF NOT EXISTS reporting.op_conversion_rates_daily (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  date               DATE         NOT NULL,
  scope_dimensions   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  lead_to_mql        NUMERIC(6,4),
  mql_to_vob         NUMERIC(6,4),
  vob_to_admit       NUMERIC(6,4),
  mql_to_admit       NUMERIC(6,4),
  numerator_admits   INTEGER      NOT NULL DEFAULT 0,
  numerator_vobs     INTEGER      NOT NULL DEFAULT 0,
  numerator_mqls     INTEGER      NOT NULL DEFAULT 0,
  numerator_leads    INTEGER      NOT NULL DEFAULT 0,
  built_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_conversion_rates_daily
  ON reporting.op_conversion_rates_daily (date, scope_dimensions);

CREATE INDEX IF NOT EXISTS idx_op_conversion_rates_daily_date
  ON reporting.op_conversion_rates_daily (date DESC);

COMMENT ON TABLE reporting.op_conversion_rates_daily IS
  'Trailing-30-day conversion rates per scope slice. Each row is "as of `date`, '
  'using the 30 days ending on `date`". Ratios are NULL when the denominator '
  'is zero. Raw numerators are persisted so downstream dashboards can apply '
  'their own smoothing.';

-- ── op_sales_cycle_daily ──────────────────────────────────────────────────
-- Sales cycle days for top-line Admits. closing_date - lead.created_at,
-- grouped by admit date + dimensions. p50 / p90 via percentile_cont.

CREATE TABLE IF NOT EXISTS reporting.op_sales_cycle_daily (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  date                        DATE            NOT NULL,
  source_category             source_category,
  level_of_care_admitted      level_of_care,
  avg_days                    NUMERIC(8,2),
  p50_days                    NUMERIC(8,2),
  p90_days                    NUMERIC(8,2),
  sample_size                 INTEGER         NOT NULL DEFAULT 0,
  built_at                    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_sales_cycle_daily
  ON reporting.op_sales_cycle_daily (date, source_category, level_of_care_admitted)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_op_sales_cycle_daily_date
  ON reporting.op_sales_cycle_daily (date DESC);

COMMENT ON TABLE reporting.op_sales_cycle_daily IS
  'Per-admit-date sales cycle stats (Top-line Admits only). cycle_days = '
  'closing_date - lead.created_at where lead is joined via source_lead_id. '
  'Orphan deals (no matching lead) are excluded (CONFIRMED.md #28 covers the '
  'orphan fallback for raw counts; cycle math requires a lead).';

-- ── op_placement_cycle_daily ──────────────────────────────────────────────
-- Same shape as sales cycle but for closed_won_referred_out_unattached deals.
-- CONFIRMED.md #29.

CREATE TABLE IF NOT EXISTS reporting.op_placement_cycle_daily (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  date                DATE            NOT NULL,
  source_category     source_category,
  refer_out_type      TEXT,
  avg_days            NUMERIC(8,2),
  p50_days            NUMERIC(8,2),
  p90_days            NUMERIC(8,2),
  sample_size         INTEGER         NOT NULL DEFAULT 0,
  built_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_placement_cycle_daily
  ON reporting.op_placement_cycle_daily (date, source_category, refer_out_type)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_op_placement_cycle_daily_date
  ON reporting.op_placement_cycle_daily (date DESC);

COMMENT ON TABLE reporting.op_placement_cycle_daily IS
  'Placement cycle (CONFIRMED.md #29). Same definition as sales cycle but '
  'scoped to closed_won_referred_out_unattached deals. refer_out_type carries '
  'the Refer_Out_Type Zoho picklist value for drill-down (Detox / Residential / '
  'Psych × Attached / Unattached).';

-- ── op_referrals_daily ────────────────────────────────────────────────────
-- Both directions of referrals in one table:
--   referral_in_count: Leads where source_category = business_development OR
--                      bd_rep_inbound is a real name (not -None-) — counted
--                      on lead.created_at.
--   referred_out_closed_count: Deals with stage_category =
--                              closed_won_referred_out_unattached — counted
--                              on closing_date.

CREATE TABLE IF NOT EXISTS reporting.op_referrals_daily (
  id                            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  date                          DATE            NOT NULL,
  owner_user_id                 UUID            REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  source_category               source_category,
  pipeline                      pipeline,
  refer_out_type                TEXT,
  referral_in_count             INTEGER         NOT NULL DEFAULT 0,
  referred_out_closed_count     INTEGER         NOT NULL DEFAULT 0,
  built_at                      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_referrals_daily
  ON reporting.op_referrals_daily (date, owner_user_id, source_category, pipeline, refer_out_type)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_op_referrals_daily_date
  ON reporting.op_referrals_daily (date DESC);

COMMENT ON TABLE reporting.op_referrals_daily IS
  'Both directions of referrals. referral_in_count from reporting.leads '
  '(CONFIRMED.md #27 — Source_Category=BD OR BD_Rep set). '
  'referred_out_closed_count from reporting.deals (stage_category = '
  'closed_won_referred_out_unattached, Commercial-Cash only).';

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Op metrics tables are executive views; only manager/admin profiles read.

ALTER TABLE reporting.op_lead_funnel_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.op_rep_activity_daily   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.op_conversion_rates_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.op_sales_cycle_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.op_placement_cycle_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.op_referrals_daily      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'op_lead_funnel_daily',
    'op_rep_activity_daily',
    'op_conversion_rates_daily',
    'op_sales_cycle_daily',
    'op_placement_cycle_daily',
    'op_referrals_daily'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS manager_admin_read ON reporting.%I', t);
    EXECUTE format(
      'CREATE POLICY manager_admin_read ON reporting.%I FOR SELECT USING (reporting.is_manager_or_admin())',
      t
    );
  END LOOP;
END$$;
