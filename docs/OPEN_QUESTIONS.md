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

## ~~#18 — Test record exclusion rule~~ — RESOLVED

Closed 2026-05-30 (Phase 1B data-quality pass). Test-row audit found essentially no test data in Cornerstone's Zoho: 2 names containing "test", 0 example.com / test.com / mailinator emails, 0 junk phones, and the `Dev Test` field turned out to be a mis-named conversion-tracking flag on real PPC leads. The bigger signal was `Lead Score Rating = ⭐ Junk/Spam` (1,675 leads, 1 conversion) — but those are real unqualified callers, not test data. No exclusion rule shipped; headline counts unchanged. Documented in CONFIRMED.md changelog rev 9. Revisit if a real test workflow ever emerges.

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

## ~~#30 — `Insurance_Type` value "PPO" → stored "Unknown"~~ — RESOLVED

Closed 2026-05-30 (Phase 1B data-quality pass). Moved to CONFIRMED.md #39. Bigger than just PPO/Unknown — Insurance_Type has four drift values in production (`Cash`, `Commercial Insurance`, `PPO`, `Unknown`) totaling 623 leads. Sync layer absorbs the mismatch via a drift map (`Cash → Cash Pay`, `Commercial Insurance → Private Insurance`, `PPO → Private Insurance`, `Unknown → null`); 406 historical rows backfilled. Zoho-side picklist cleanup deferred without deadline.

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
- **2026-05-29 (rev 9)** — BD undercount diagnosis on /analytics/op-funnel. Resolved #34 (Call Center stays Digital; Option 1/Option 2 are junk → removed from Zoho picklist). Alumni split into its own source category was added as a separate decision — see CONFIRMED.md #37.
- **2026-05-30 (rev 10)** — Phase 1B data-quality cleanup pass. Resolved #18 (no test data exists), #30 (Insurance_Type drift absorbed in sync layer + backfill), #35 (DV closed-lost reasons skipped), #36 (legacy DUI / null-pipeline accepted as un-normalized). See CONFIRMED.md #39-#41. Only OPEN_QUESTION #37 (Lead_Created_Time conversion workflow) remains pending — Amber's Zoho action.
- **2026-05-30 (rev 11)** — Resolved #37 in a different way than rev 10 expected. The Convert Mapping was already in place years ago; the source-of-truth field is `Original_Created_Time` on Deals (not `Lead_Created_Time`). Migration 142's plumbing was correct; only the Zoho field name read by reporting-sync-deals was wrong. Migration 192 + sync-function update fix it. See CONFIRMED.md #42.

---

## ~~#34 — Hidden Source Category values: Call Center / Option 1 / Option 2~~ — RESOLVED

Moved to `CONFIRMED.md` #38 (2026-05-29). Amber's call: `Call Center` stays mapped to `digital_marketing` (digital touchpoint); `Option 1` / `Option 2` are junk and are being removed from the Zoho global picklist. Same diagnostic surfaced that `Alumni` should not be folded into Digital — resolved separately as CONFIRMED.md #37.

---

## ~~#35 — DV closed-lost reason field~~ — RESOLVED

Closed 2026-05-30. Moved to CONFIRMED.md #40. Decision: skip — `reporting.deals.closed_lost_reason` stays null for DV closed-lost rows. Revisit if DV reporting scope expands.

---

## ~~#36 — Pipeline null on legacy Deals~~ — RESOLVED

Closed 2026-05-30. Moved to CONFIRMED.md #41. Decision: accept the partial. Broader than initially observed — 6,891 deals carry the pre-rename legacy raw value `DUI` (2023-06 to 2024-08) plus 1,058 null-pipeline rows, all pre-2024-08 and outside the active reporting window. No backfill, no `pipeline_mapping` alias. Revisit if 2024-or-earlier historical reporting becomes a need.

---

## ~~#37 — Deal → Lead linkage field name~~ — RESOLVED 2026-05-30

The Zoho standard `Lead_Created_Time` field that Migration 142 originally targeted is unused at Cornerstone (0 of 29,587 deals populated). The actual conversion-time Lead Created Time lives on the Deal's **`Original_Created_Time`** field, copied over by Cornerstone's pre-existing Lead Conversion Mapping (Setup → Customization → Modules and Fields → Leads → Convert Mapping → Deals tab).

**Verified 2026-05-30** against 18 production deals: every `Deal.Original_Created_Time` exactly matches the converting Lead's `Created_Time`, with gaps from 45 seconds (fresh same-day conversion of Andrew Lerma) up to ~14 months (long-tail conversion of Symone Johnson's 2025-03-31 lead on 2026-05-30). The 14-month gap rules out any chance of `Original_Created_Time` being a copy of the Deal's own `Created_Time`.

**Fix shipped:** reporting-sync-deals reads `Original_Created_Time` from the Zoho payload (replaces the unused `Lead_Created_Time` field); migration 192 backfills the 16,239 historical deals already in the raw mirror. The `reporting.deals.lead_created_time` column name + downstream consumers stay as-is — semantics were always correct, only the source-field name was wrong.

See CONFIRMED.md #42.
