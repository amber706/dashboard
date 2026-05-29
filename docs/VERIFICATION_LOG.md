# Phase 1B Verification Log

Hand-spot-checks of cached `op_*` numbers against Zoho's source-of-truth UI. Per the Phase 1B acceptance gate (METRIC_DEFINITIONS.md), five numbers across the funnel need a human signoff before Phase 1B closes and Phase 1C unblocks.

## Method

For each row below:
1. Run the query in the "**SQL**" column against the prod Supabase (paste into the Supabase dashboard's SQL editor).
2. Open Zoho in another tab and follow the "**Zoho check**" steps to count the same population.
3. Record both numbers + the verifier (initials + date) in the "**Verified**" column.
4. If they disagree by more than 1%, file an OPEN_QUESTION entry rather than fudging the row.

The cached values below are from the 2026-05-28 23:58 UTC `reporting_build_op_metrics` run. Re-run the queries before checking — `built_at` advances daily at 09:00 UTC.

## Verification rows

### 1. Top-line MQLs on 2026-05-27

- **Cached value:** 28
- **SQL:**
  ```sql
  SELECT SUM(mqls_count) FROM reporting.op_lead_funnel_daily
  WHERE date = '2026-05-27' AND pipeline IN ('commercial_cash','ahcccs','zocdoc');
  ```
- **Zoho check:** Zoho CRM → Deals module, filter: `Created_Time` between 2026-05-27 00:00 and 23:59 (Phoenix), Pipeline ∈ {Commercial-Cash, AHCCCS, ZocDoc}. Count the rows.
- **Verified:**

### 2. All-pipeline VOBs on 2026-05-27

- **Cached value:** 37
- **SQL:**
  ```sql
  SELECT SUM(vobs_count) FROM reporting.op_lead_funnel_daily WHERE date = '2026-05-27';
  ```
- **Zoho check:** Zoho CRM → Deals module, filter: `VOB_Submitted_Date` = 2026-05-27. Count the rows. (Deals with `VOB_Submitted = true` but no date are intentionally excluded — METRIC_DEFINITIONS.md §5.)
- **Verified:**

### 3. Top-line Admits on 2026-05-27

- **Cached value:** 9
- **SQL:**
  ```sql
  SELECT SUM(admits_count) FROM reporting.op_lead_funnel_daily
  WHERE date = '2026-05-27' AND pipeline IN ('commercial_cash','ahcccs','zocdoc');
  ```
- **Zoho check:** Zoho CRM → Deals module, filter: `Admit_Date` = 2026-05-27 OR (`Closing_Date` = 2026-05-27 AND `Stage` = Closed - Admitted), Pipeline ∈ {Commercial-Cash, AHCCCS, ZocDoc}. Count the rows.
- **Verified:**

### 4. All-pipeline Closed-Lost on 2026-05-27

- **Cached value:** 32
- **SQL:**
  ```sql
  SELECT SUM(closed_lost_count) FROM reporting.op_lead_funnel_daily WHERE date = '2026-05-27';
  ```
- **Zoho check:** Zoho CRM → Deals module, filter: `Closing_Date` = 2026-05-27 AND Stage starts with "Closed - Lost" (any pipeline variant). Count the rows.
- **Verified:**

### 5. AHCCCS Leads, week ending 2026-05-28

- **Cached value:** 248
- **SQL:**
  ```sql
  SELECT SUM(leads_count) FROM reporting.op_lead_funnel_daily
  WHERE date BETWEEN '2026-05-22' AND '2026-05-28'
    AND source_category IS NOT NULL;
  ```
  (Note: this is *all* leads in the window; the precise AHCCCS-only slice requires reading `reporting.leads` directly since `op_lead_funnel_daily` doesn't carry insurance/star dims. Use the query in the next bullet if you want exact AHCCCS.)
  ```sql
  -- AHCCCS-only:
  SELECT COUNT(*) FROM reporting.leads
  WHERE created_at >= '2026-05-22' AND created_at < '2026-05-29'
    AND level_of_care_requested NOT IN ('DUI','DV')
    AND (
      insurance_type = 'AHCCCS'
      OR (insurance_type IS NULL AND star_rating = 3)
    );
  ```
- **Zoho check:** Zoho Analytics → Leads (Zoho CRM) view, filter: `Created_Time` between 2026-05-22 and 2026-05-28 inclusive, Level of Care ∉ {DUI, DV}, and Insurance_Type = AHCCCS OR (Insurance_Type empty AND Lead Score Rating starts with three ⭐).
- **Verified:**

---

## Sign-off

Phase 1B is closed when:
- [ ] All 5 rows above show a `Verified` value with cached-vs-Zoho within 1%.
- [ ] OPEN_QUESTIONS #37 resolved (Zoho workflow for `Lead_Created_Time`).
- [ ] No new entries appear in `v_unmapped_sources` / `_locs` / `_stages` / `_pipelines` after the next cron cycle.

Once all three lights are green, Phase 1C is unblocked.
