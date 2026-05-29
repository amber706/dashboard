-- ───────────────────────────────────────────────────────────────────────────
-- Migration 161 — Verifier RPCs (Phase 1B chunk 4)
--
-- Two fixed RPCs the verifier script calls to compare cached op_* aggregates
-- against ground-truth queries over the normalized mirrors. Both are
-- service_role-only.
--
-- Why not a generic "run arbitrary SQL" RPC: arbitrary-SQL endpoints are
-- footguns — anything that holds the service-role key could pivot from
-- "read metrics" to "drop tables". These two fixed RPCs are the minimal
-- API the verifier needs.
-- ───────────────────────────────────────────────────────────────────────────

-- ── verifier_ground_truth_funnel ──────────────────────────────────────────
-- Recomputes the six funnel counts per Phoenix-local day from the
-- normalized mirrors using the SAME predicates the cached builder uses.
-- A drift between this and verifier_cached_funnel indicates the cache
-- diverged from the canonical predicate.

CREATE OR REPLACE FUNCTION public.verifier_ground_truth_funnel(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  date                  DATE,
  leads_count           INTEGER,
  mqls_count            INTEGER,
  vobs_count            INTEGER,
  admits_count          INTEGER,
  closed_lost_count     INTEGER,
  referred_out_count    INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
  WITH d AS (
    SELECT generate_series(p_start, p_end, '1 day'::interval)::DATE AS date
  ),
  mqls AS (
    SELECT (created_at AT TIME ZONE 'America/Phoenix')::DATE AS date, COUNT(*)::INT AS n
    FROM reporting.deals
    WHERE (created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end
    GROUP BY 1
  ),
  vobs AS (
    SELECT vob_submitted_date AS date, COUNT(*)::INT AS n
    FROM reporting.deals
    WHERE vob_submitted_date BETWEEN p_start AND p_end
    GROUP BY 1
  ),
  admits AS (
    SELECT COALESCE(admit_date, closing_date) AS date, COUNT(*)::INT AS n
    FROM reporting.deals
    WHERE (admit_date IS NOT NULL OR stage_category = 'closed_won_admitted')
      AND COALESCE(admit_date, closing_date) BETWEEN p_start AND p_end
    GROUP BY 1
  ),
  closed_lost_ AS (
    SELECT closing_date AS date, COUNT(*)::INT AS n
    FROM reporting.deals
    WHERE stage_category = 'closed_lost'
      AND closing_date BETWEEN p_start AND p_end
    GROUP BY 1
  ),
  referred_out_ AS (
    SELECT closing_date AS date, COUNT(*)::INT AS n
    FROM reporting.deals
    WHERE stage_category = 'closed_won_referred_out_unattached'
      AND closing_date BETWEEN p_start AND p_end
    GROUP BY 1
  ),
  leads_ AS (
    SELECT (created_at AT TIME ZONE 'America/Phoenix')::DATE AS date, COUNT(*)::INT AS n
    FROM reporting.leads
    WHERE (created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end
    GROUP BY 1
  )
  SELECT
    d.date,
    COALESCE(leads_.n, 0),
    COALESCE(mqls.n, 0),
    COALESCE(vobs.n, 0),
    COALESCE(admits.n, 0),
    COALESCE(closed_lost_.n, 0),
    COALESCE(referred_out_.n, 0)
  FROM d
  LEFT JOIN leads_       ON leads_.date       = d.date
  LEFT JOIN mqls         ON mqls.date         = d.date
  LEFT JOIN vobs         ON vobs.date         = d.date
  LEFT JOIN admits       ON admits.date       = d.date
  LEFT JOIN closed_lost_ ON closed_lost_.date = d.date
  LEFT JOIN referred_out_ ON referred_out_.date = d.date
  ORDER BY d.date;
$$;

-- ── verifier_cached_funnel ────────────────────────────────────────────────
-- Reads the cached op_lead_funnel_daily and sums to per-day totals across
-- all dimensions, for direct comparison with the ground-truth output.

CREATE OR REPLACE FUNCTION public.verifier_cached_funnel(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  date                  DATE,
  leads_count           INTEGER,
  mqls_count            INTEGER,
  vobs_count            INTEGER,
  admits_count          INTEGER,
  closed_lost_count     INTEGER,
  referred_out_count    INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
  SELECT
    date,
    COALESCE(SUM(leads_count), 0)::INT,
    COALESCE(SUM(mqls_count), 0)::INT,
    COALESCE(SUM(vobs_count), 0)::INT,
    COALESCE(SUM(admits_count), 0)::INT,
    COALESCE(SUM(closed_lost_count), 0)::INT,
    COALESCE(SUM(referred_out_count), 0)::INT
  FROM reporting.op_lead_funnel_daily
  WHERE date BETWEEN p_start AND p_end
  GROUP BY date
  ORDER BY date;
$$;

REVOKE ALL ON FUNCTION public.verifier_ground_truth_funnel(DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifier_cached_funnel(DATE, DATE)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_ground_truth_funnel(DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.verifier_cached_funnel(DATE, DATE)        TO service_role;
