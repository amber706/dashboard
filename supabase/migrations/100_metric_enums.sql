-- ───────────────────────────────────────────────────────────────────────────
-- Migration 100 — Reporting taxonomy enums
--
-- Postgres enum types matching `src/lib/metrics/definitions.ts`. Database is
-- the second line of defense against string drift: every downstream table
-- that references a pipeline / stage category / source category / level of
-- care / rep role uses one of these enums, so a typo never reaches storage.
--
-- This migration is idempotent. It is safe to run multiple times against the
-- same database — every `CREATE TYPE` is guarded with a DO-block existence
-- check. New enum values added in later migrations must use `ALTER TYPE ...
-- ADD VALUE IF NOT EXISTS` to stay idempotent.
--
-- Update procedure when adding a new enum value:
--   1. Update the const in `src/lib/metrics/definitions.ts`.
--   2. Update the matching Zod schema in `src/lib/metrics/schemas.ts`.
--   3. Update `docs/METRIC_DEFINITIONS.md`.
--   4. Add a new migration `1xx_metric_enums_add_<value>.sql` with the
--      `ALTER TYPE` statement — never edit this file in place.
--
-- See `docs/METRIC_DEFINITIONS.md` and `docs/OPEN_QUESTIONS.md` for the
-- semantic meaning of every value below.
-- ───────────────────────────────────────────────────────────────────────────

-- ── pipeline ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline') THEN
    CREATE TYPE pipeline AS ENUM (
      'commercial_cash',
      'ahcccs',
      'dui',
      'zocdoc'
    );
  END IF;
END$$;

-- ── stage_category ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stage_category') THEN
    CREATE TYPE stage_category AS ENUM (
      'in_progress',
      'mql',
      'vob_submitted',
      'closed_won',
      'closed_lost_referred_out',
      'closed_lost_other'
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

-- ── level_of_care ──────────────────────────────────────────────────────────
-- Draft set; full list pending OPEN_QUESTION #11.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'level_of_care') THEN
    CREATE TYPE level_of_care AS ENUM (
      'detox',
      'residential',
      'php',
      'iop',
      'op',
      'sober_living'
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
-- Surface label for source_category in the FilterBar.
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
-- Persisted on saved-view rows in later phases; here for completeness.
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

-- ── insurance_type ─────────────────────────────────────────────────────────
-- Raw values surfaced from Zoho Leads. Pending verbatim confirmation
-- (OPEN_QUESTION #4) — values here mirror the TS constants and may be
-- extended via a follow-up migration once Zoho's picklist is confirmed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'insurance_type') THEN
    CREATE TYPE insurance_type AS ENUM (
      'Commercial Insurance',
      'Private Pay',
      'AHCCCS'
    );
  END IF;
END$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Sanity checks: row each enum's distinct cardinality so a future migration
-- review can compare against METRIC_DEFINITIONS.md. Comment-only assertion;
-- this query is harmless if dropped.
--
--   SELECT typname, array_length(enum_range(NULL::pipeline), 1)         FROM pg_type WHERE typname = 'pipeline';
--   -- expected 4
--   SELECT typname, array_length(enum_range(NULL::stage_category), 1)   FROM pg_type WHERE typname = 'stage_category';
--   -- expected 6
--   SELECT typname, array_length(enum_range(NULL::source_category), 1)  FROM pg_type WHERE typname = 'source_category';
--   -- expected 3
--   SELECT typname, array_length(enum_range(NULL::level_of_care), 1)    FROM pg_type WHERE typname = 'level_of_care';
--   -- expected 6 (subject to OPEN_QUESTION #11)
--   SELECT typname, array_length(enum_range(NULL::rep_role), 1)         FROM pg_type WHERE typname = 'rep_role';
--   -- expected 3
-- ───────────────────────────────────────────────────────────────────────────
