-- ───────────────────────────────────────────────────────────────────────────
-- Migration 100 — Reporting taxonomy enums
--
-- Postgres enum types matching `src/lib/metrics/definitions.ts`. Database is
-- the second line of defense against string drift: every downstream table
-- that references a pipeline / stage category / source category / level of
-- care / rep role uses one of these enums, so a typo never reaches storage.
--
-- This migration is idempotent. New enum values added in later migrations
-- must use `ALTER TYPE ... ADD VALUE IF NOT EXISTS` to stay idempotent.
--
-- Update procedure when adding a new enum value:
--   1. Update the const in `src/lib/metrics/definitions.ts`.
--   2. Update the matching Zod schema in `src/lib/metrics/schemas.ts`.
--   3. Update `docs/METRIC_DEFINITIONS.md`.
--   4. Add a new migration `1xx_metric_enums_add_<value>.sql` with the
--      `ALTER TYPE` statement — never edit this file in place.
--
-- See `docs/METRIC_DEFINITIONS.md` and `docs/CONFIRMED.md` for the semantic
-- meaning of every value below.
-- ───────────────────────────────────────────────────────────────────────────

-- ── pipeline (5 values; see CONFIRMED.md #5) ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline') THEN
    CREATE TYPE pipeline AS ENUM (
      'commercial_cash',
      'ahcccs',
      'zocdoc',
      'dui_cash',
      'dv_cash'
    );
  END IF;
END$$;

-- ── stage_category (9 values; see METRIC_DEFINITIONS.md §3) ────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stage_category') THEN
    CREATE TYPE stage_category AS ENUM (
      'in_progress',
      'vob_qualifying',
      'vob_approved',
      'pre_admit',
      'referred_out_coming_back',
      'closed_won_admitted',
      'closed_won_referred_out_unattached',
      'closed_won_dui_completion',
      'closed_lost'
    );
  END IF;
END$$;

-- ── source_category ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_category') THEN
    CREATE TYPE source_category AS ENUM (
      'digital_marketing',
      'business_development',
      'zocdoc'
    );
  END IF;
END$$;

-- ── level_of_care (Cornerstone Lead picklist; see CONFIRMED.md #11) ───────
-- DUI and DV appear here because they are valid LOC values at the Lead level.
-- Treatment leads are LOCs other than DUI/DV (see TREATMENT_LOC_VALUES in TS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'level_of_care') THEN
    CREATE TYPE level_of_care AS ENUM (
      'bhrf',
      'detox',
      'php',
      'iop5',
      'iop3',
      'viop_adult',
      'viop_adolescent',
      'op',
      'vop',
      'vop_adult',
      'vop_adolescent',
      'dui',
      'dv'
    );
  END IF;
END$$;

-- ── rep_role ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rep_role') THEN
    CREATE TYPE rep_role AS ENUM (
      'admissions_rep',
      'bd_rep',
      'other'
    );
  END IF;
END$$;

-- ── marketing_channel ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marketing_channel') THEN
    CREATE TYPE marketing_channel AS ENUM (
      'digital',
      'business_development',
      'zocdoc'
    );
  END IF;
END$$;

-- ── time_range_preset ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_range_preset') THEN
    CREATE TYPE time_range_preset AS ENUM (
      'today',
      'current_week',
      'previous_week',
      'this_month',
      'this_quarter',
      'last_month',
      'last_3_months',
      'last_6_months',
      'last_year',
      'custom'
    );
  END IF;
END$$;

-- ── insurance_type (Cornerstone Lead picklist; CONFIRMED.md #8 + #14) ──────
-- Stored actual values from Zoho API (display labels differ for two entries):
--   "Commercial Insurance" display → stored as "Private Insurance"
--   "Cash" display                 → stored as "Cash Pay"
-- Network types (EPO/HMO/POS/PPO) intentionally NOT in this enum even though
-- they also appear in the Zoho Insurance_Type picklist — they belong to the
-- separate Insurance_Policy_Type dimension we defer to Phase 2 (OPEN_QUESTION
-- #29).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'insurance_type') THEN
    CREATE TYPE insurance_type AS ENUM (
      'AHCCCS',
      'Private Insurance',
      'Cash Pay',
      'Medicare',
      'No Insurance',
      'Out of State Medicaid'
    );
  END IF;
END$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Sanity checks: row each enum's distinct cardinality so a future migration
-- review can compare against METRIC_DEFINITIONS.md. Comment-only assertion.
--
--   SELECT typname, array_length(enum_range(NULL::pipeline), 1);
--   -- expected 5
--   SELECT typname, array_length(enum_range(NULL::stage_category), 1);
--   -- expected 9
--   SELECT typname, array_length(enum_range(NULL::source_category), 1);
--   -- expected 3
--   SELECT typname, array_length(enum_range(NULL::level_of_care), 1);
--   -- expected 6 (subject to OPEN_QUESTION #11)
--   SELECT typname, array_length(enum_range(NULL::rep_role), 1);
--   -- expected 3
-- ───────────────────────────────────────────────────────────────────────────
