# Open Questions — Phase 1A

**Status:** awaiting Amber's resolutions. Every question below must be answered in `CONFIRMED.md` before Phase 1B begins.

Numbering is stable — `METRIC_DEFINITIONS.md` references questions by number. Resolved questions are moved (not deleted) to `CONFIRMED.md` with the answer attached.

Each question lists: the ambiguity, where it surfaced, and (where useful) a recommended default if you want the safe path.

---

## ~~#1 — Exact Zoho stage names for Referred Out variants~~ — RESOLVED

Moved to `CONFIRMED.md` #1 and #2. The original brief's three "Referred Out variants" mapped to one closed-won (`Closed - Referred Out Unattached`, Commercial-Cash only) plus one active stage (`Referred Out - Coming Back`, three pipelines). The third name in the brief does not exist.

---

## ~~#2 — DUI pipeline current status~~ — RESOLVED

Moved to `CONFIRMED.md` #6. Active. Reported separately from top-line.

---

## ~~#3 — `VOB Submitted` field name per pipeline~~ — RESOLVED

Moved to `CONFIRMED.md` #4. There is no `VOB Submitted` field — VOB is stage-driven. Question retired.

---

## ~~#4 — Insurance type enum values~~ — RESOLVED

Moved to `CONFIRMED.md` #8 and #9. Six values: AHCCCS, Commercial Insurance, Cash, Medicare, No Insurance, Out of State Medicaid. "Cash" replaces brief's "Private Pay"; Medicare/No Insurance/Out of State Medicaid form the new Other Payer Lead bucket.

---

## ~~#5 — Star rating field name~~ — RESOLVED

Moved to `CONFIRMED.md` #10. Field is `Lead Score Rating` (a single picklist column). Star count is parsed from leading ⭐ characters in the label via `leadScoreRatingToStarCount`.

---

## ~~#6 — BD Rep and Admissions Rep profile names~~ — RESOLVED

Moved to `CONFIRMED.md` #15 + #16. Four profiles in production: `TREATMENT Standard`, `Administrator`, `Call Center AHCCCS` (all → Admissions Rep), `Business Development` (→ BD Rep).

---

## ~~#7 — Zoho Analytics OAuth credentials~~ — RESOLVED

Moved to `CONFIRMED.md` #18. Existing Zoho CRM secrets in Supabase reused for CRM-side sync. For Analytics, Amber re-authorizes the existing Self Client with combined `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoAnalytics.data.READ,ZohoAnalytics.metadata.READ` scope; the new refresh token replaces `ZOHO_REFRESH_TOKEN`.

---

## ~~#8 — DUI dimension for reporting~~ — RESOLVED

Moved to `CONFIRMED.md` #3. DUI and DV both reported separately from top-line; not folded into Commercial or AHCCCS.

---

## ~~#9 — Lead overlap rule~~ — RESOLVED

Moved to `CONFIRMED.md` #24. Insurance-wins precedence: when insurance_type is set, it's authoritative; star rating is the fallback only when insurance is null.

---

## ~~#10 — Pipeline × Source Category orthogonality~~ — RESOLVED

Moved to `CONFIRMED.md` #25. Orthogonal across per-dimension charts; distinct in headline totals. Same deal counts once in "Total Admits this month" even if it shows up under both Commercial and BD breakdowns.

---

## ~~#11 — Level of Care enum values~~ — RESOLVED

Moved to `CONFIRMED.md` #11. 13 Cornerstone-specific values: BHRF, Detox, PHP, IOP5, IOP3, VIOP Adult, VIOP Adolescent, OP, VOP, VOP Adult, VOP Adolescent, DUI, DV.

---

## ~~#12 — Sales Cycle: `Closing_Date` exact field name~~ — RESOLVED

Confirmed via Zoho `getFields` on Deals — `Closing_Date` is the standard field. Used for non-admit closings; for admits, the `Admit_Date` custom field is canonical (see `CONFIRMED.md` #20).

---

## ~~#13 — Lead `Created Time` semantics~~ — RESOLVED

Moved to `CONFIRMED.md` #31. `Created_Time` represents the intake moment (form submission, call answered, walk-in). Used directly in Sales Cycle math.

---

## ~~#14 — Field for the "Closing Date" of an Admit~~ — RESOLVED

Moved to `CONFIRMED.md` #20. Custom `Admit_Date` field is canonical; deals without it are excluded from headline Admit KPI and surfaced in data-quality view.

---

## ~~#15 — Referral In source-side definition~~ — RESOLVED

Moved to `CONFIRMED.md` #27. Referral In = `Source_Category = Business Development` OR `BD_Rep` field is set on the Lead.

---

## ~~#16 — Referral Out destination field~~ — RETIRED

The original "Referral Out" primitive is replaced by **Placement** (`closed_won_referred_out_unattached`). If a destination account name needs to be tracked on a Placement deal, that becomes a separate question — but the metric itself no longer depends on it. Re-open if Placement reporting needs the destination account.

---

## ~~#17 — Source Category full picklist~~ — RESOLVED

Moved to `CONFIRMED.md` #17. 13 picklist values pulled via Zoho API. Catch-all rule (everything except BD/ZocDoc → Digital Marketing) confirmed as the intended classification.

---

## #18 — Test record exclusion rule (DEFERRED to Phase 1B)

**Status:** Amber explicitly deferred this to Phase 1B sample-data triage. We sample raw production data during the first sync, identify the test rows by inspection, and write the exclusion rule based on what's actually there. Until then, no test-exclusion filter is applied.

**Risk:** raw counts in Phase 1B include test data until this is closed.

---

## ~~#19 — Exact Zoho pipeline string names~~ — RESOLVED

Moved to `CONFIRMED.md` #5. Five pipelines locked.

---

## ~~#20 — VOB Submitted timestamp~~ — RESOLVED

Moved to `CONFIRMED.md` #19. The `VOB_Submitted_Date` custom field provides the date attribution directly; no stage-history capture needed.

---

## ~~#21 — Orphan deals in Sales Cycle math~~ — RESOLVED

Moved to `CONFIRMED.md` #28. Fall back to Deal `Created_Time` as the start point.

---

## ~~#22 — Top-line MQL inclusion~~ — RESOLVED

Moved to `CONFIRMED.md` #26. Same restriction as Admit — top-line MQL = Commercial-Cash + AHCCCS + ZocDoc only.

---

## ~~#23 — Stage history snapshotting in Phase 1B~~ — RESOLVED

Moved to `CONFIRMED.md` #19. The `VOB_Submitted` boolean + `VOB_Submitted_Date` custom fields provide direct date attribution; stage-history capture is no longer needed.

---

## ~~#24 — DUI Completion granularity~~ — RESOLVED

Moved to `CONFIRMED.md` #30. Roll up to one DUI Completion KPI by default; drill-down available via a derived `dui_completion_subtype` field.

---

## ~~#25 — Does DUI carry Level of Care?~~ — RESOLVED

Moved to `CONFIRMED.md` #21. Both `Level_of_Care_Requested` and `Admitted_Level_of_Care` exist as Deal fields. `Admitted_Level_of_Care` is a 9-value subset of the Lead picklist; DUI deals have `DUI` as the LOC. The brief's stage-dependent LOC rule is correct.

---

## ~~#25 (original) — Does DUI carry Level of Care? (NEW)~~

**Where:** `METRIC_DEFINITIONS.md` §13.
**Question:** The DUI - Cash pipeline doesn't have an Admit stage. Do DUI deals carry an LOC field, or is "level of care" simply not a dimension for DUI?

If LOC doesn't apply to DUI: the LOC filter on a top-line dashboard implicitly excludes DUI deals, which is fine because DUI is non-top-line anyway. The LOC enum (`OPEN_QUESTION #11`) stays scoped to treatment-pipeline LOCs.

---

## ~~#27 — Lead Score Rating: full 4-star and 5-star label strings~~ — RESOLVED

Pulled via Zoho `getFields`. Full labels:
- 0: `Unable To Score/Never Made Contact`
- 1: `⭐ Junk/Spam`
- 2: `⭐⭐ HR/Client Care/Family/Care Coordination(Not Making a Referral)`
- 3: `⭐⭐⭐ Seeking Treatment: Medicaid`
- 4: `⭐⭐⭐⭐ Seeking Treatment: Commercial, Not Ready to Make a Decision`
- 5: `⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, Ready to Make a Decision`

(Stored actual_value text differs — it's clinical descriptors. See doc §16 for both.)

---

## ~~#29 — Insurance_Policy_Type as separate dimension~~ — RESOLVED

Moved to `CONFIRMED.md` #32. Deferred to Phase 2 as a separate Network filter. Phase 1 ships without it.

---

## #30 — `Insurance_Type` value "PPO" → stored "Unknown" (NEW)

**Where:** discovered via Zoho `getFields`.
**Question:** the `Insurance_Type` picklist has a display value `PPO` whose **actual stored value is `Unknown`**. This is either a Zoho rename gone wrong or a deliberate workaround. Either way, leads with the value will hit our sync as the literal string `Unknown`, which is not in the canonical enum.

**How to resolve:** check Zoho CRM Setup → Customization → Leads → Insurance Type field; either fix the actual_value to `PPO` or confirm `Unknown` is intentional. If intentional, decide whether `Unknown` should be a separate insurance type (e.g., for unverified payer leads).

---

## ~~#28 — `Treatment or Court Services` field semantics~~ — RESOLVED

Moved to `CONFIRMED.md` #22. API name = `DUI_or_Treatment`, picklist values = `Treatment`, `DUI`, `Domestic Violence`, `N/A or Other`. Canonical pipeline router on the Deals side.

---

## ~~#28 (original) — `Treatment or Court Services` field semantics (NEW)~~

**Where:** observed in Zoho Lead detail.
**Question:** Cornerstone Leads have a `Treatment or Court Services` field (under Service Information). What does this distinguish? Is it:
- A simple "is this a treatment lead vs court-mandated lead" boolean?
- A picklist that's a more granular alternative to inferring program from LOC?
- A vestigial field no longer in active use?

If this field is authoritative for treatment-vs-court routing, it might be a better gate for `isTreatmentLead` than checking LOC ∉ {DUI, DV}.

**How to resolve:** check the field's picklist values and how reliably it's populated in production.

---

## ~~#26 — Placement cycle metric~~ — RESOLVED

Moved to `CONFIRMED.md` #29. Phase 1B adds `op_placement_cycle_daily` alongside `op_sales_cycle_daily`.

---

## Document changelog

- **2026-05-27 (rev 1)** — Initial draft alongside METRIC_DEFINITIONS.md rev 1. 21 open questions raised.
- **2026-05-27 (rev 2)** — Revised alongside METRIC_DEFINITIONS.md rev 2. Resolved (moved to CONFIRMED.md): #1, #2, #3, #8, #19. Retired (no longer applicable): #16. Transformed: #20 (the underlying assumption changed). Partially resolved: #7 (IDs locked, OAuth still pending). Added: #22, #23, #24, #25, #26.
- **2026-05-27 (rev 3)** — Revised alongside METRIC_DEFINITIONS.md rev 3 + Lead detail screenshots. Resolved (moved to CONFIRMED.md): #4, #5, #11. Partially resolved: #17 (field name confirmed; full picklist still pending). Added: #27 (full 4/5-star labels), #28 (Treatment or Court Services field).
- **2026-05-27 (rev 4)** — Live Zoho API queries (getFields + getUsers). Resolved: #6, #17 (full picklist). Added: #29 (Insurance_Policy_Type dimension), #30 (PPO/Unknown anomaly).
- **2026-05-27 (rev 5)** — Zoho Deals `getFields` + Supabase Edge Function inspection. Resolved: #7 (OAuth path locked), #14 (Admit_Date strict), #20 (VOB_Submitted_Date provides timestamp), #23 (no stage-history needed), #25 (both LOC fields exist), #28 (DUI_or_Treatment field confirmed). Revises CONFIRMED.md #4 — VOB now uses both boolean field and stage.
- **2026-05-27 (rev 6)** — Batch closeout. Resolved: #9, #10, #12, #13, #15, #21, #22, #24, #26, #27, #29. Only two questions remain open by design: #18 (test record exclusion, deferred to Phase 1B sample-data triage) and #30 (PPO=Unknown anomaly, awaits Zoho cleanup).
- **2026-05-27 (rev 7)** — VOB priority chain refined; closed_lost removed from backup set (CONFIRMED.md #33).
- **2026-05-27 (rev 8)** — Admit priority chain mirrors VOB. Source Category confirmed as Zoho Global Picklist. Closed Lost reason capture added per pipeline. "Placement" renamed to "Referred Out Closed" under new "Refer Outs" parent category. New OPEN_QUESTIONS: #34 (4 hidden Source Category values — Call Center / Option 1 / Option 2 — Phase 1B sync logs whether any production data carries them), #35 (DV pipeline has no dedicated closed-lost reason field — confirm if needed).

---

## #34 — Hidden Source Category values: Call Center / Option 1 / Option 2 (NEW)

**Where:** Zoho `Source_Category` global picklist returns 13 values via API; the Deal UI dropdown shows only 9.

**Question:** the 4 hidden values are:
- `-None-` (default empty state — fine to leave hidden)
- `Call Center`
- `Option 1`
- `Option 2`

Are Call Center / Option 1 / Option 2 active values in any pipeline, deprecated debris, or placeholders someone forgot to delete?

**How to resolve:** Phase 1B's first sync logs production rows carrying any of these values. If counts are non-zero, decide whether to keep them or clean up the picklist in Zoho.

---

## #35 — DV closed-lost reason field (NEW)

**Where:** `METRIC_DEFINITIONS.md` §10.
**Question:** Treatment closed-lost has `Lost_Reasoning` (45 values); DUI has `Close_Reasoning_DUI` (6 values). DV - Cash pipeline has no dedicated closed-lost reason field.

Should we:
- (a) Add a custom `Close_Reasoning_DV` field to the Zoho DV pipeline layout,
- (b) Fall back to the Zoho system `Reason_For_Loss__s` field for DV closed-lost,
- (c) Not track DV closed-lost reasons at all (low volume?)

**Recommended default:** (b) for Phase 1; revisit if DV volume grows.

---

## #36 — Pipeline null on legacy Deals (NEW)

**Where:** `reporting-sync-deals` smoke test (2026-05-28, run `06652bea-3458-47ba-8378-91be7ad33257`).
**Observed:** 1,058 of 29,493 Deals (3.6%) have `Pipeline = null` in Zoho's COQL response and are rejected with `schema_mismatch`. Distribution by Created year: 2022 = 1,032, 2023 = 22, 2024 = 3, 2025 = 1.

The 2022 rows are pre-Pipeline-field legacy. The 26 post-2022 rows are all OOP screening/class stages (`Closed - Sold Screening`, `Closed - Sold Classes`, `Closed - Sold Screening & Class`) where Zoho appears not to populate Pipeline even on current records.

**Decision needed:**
- (a) Backfill Pipeline in Zoho for legacy rows (one-time mass update)
- (b) Treat `Pipeline = null` as `oop_screening_class` when Stage matches an OOP class stage; drop the rest as pre-Pipeline legacy
- (c) Accept the partial — these 1,058 deals predate Phase 1B's reporting window (trailing 14 days) and won't affect op_metrics

**Recommended default:** (c) for Phase 1B chunk 2 sign-off. Revisit if any historical-period drill-down needs them.
