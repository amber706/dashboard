# Confirmed Resolutions

**Status:** Phase 1A gate file. Amber's resolutions to OPEN_QUESTIONS, recorded by Claude during the doc walkthrough and pending Amber's read-through + sign-off.

This file is the second half of the 1A acceptance gate. METRIC_DEFINITIONS.md describes the canonical taxonomy; CONFIRMED.md is where the decisions Amber made to lock that taxonomy live. Phase 1B does not begin until every question in OPEN_QUESTIONS.md is either resolved here or explicitly marked as "intentionally deferred."

Each entry below lists:
- The question (cross-referenced to OPEN_QUESTIONS.md when it originated there)
- Amber's resolution
- The downstream consequence (what changed in METRIC_DEFINITIONS.md / definitions.ts / migrations as a result)

---

## #1 — `Closed - Referred Out Unattached` is a Win, not a Loss

**Question:** Does Cornerstone treat `Closed - Referred Out Unattached` (Commercial-Cash only) as a win, a loss, or its own bucket?

**Resolution:** **Win.** When a specialist successfully places a caller at another provider Cornerstone cannot take, that is a successful outcome. The specialist still gets credit.

**Consequences:**
- New stage category `closed_won_referred_out_unattached`.
- New primitive: **Placement** (§7 in METRIC_DEFINITIONS.md). `isPlacement(deal)` predicate added.
- New rollup primitive: **Win** = Admit ∪ Placement (§8).
- Original brief's `closed_lost_referred_out` stage category is **removed** — that category was based on a wrong assumption.

---

## #2 — `Referred Out - Coming Back` is active, not closed

**Question:** Is the mid-pipeline `Referred Out - Coming Back` stage a closed outcome or an active one?

**Resolution:** **Active.** The deal is still open. We've parked the caller at a partner with the expectation they may come back to us.

**Consequences:**
- New stage category `referred_out_coming_back` — distinct from both `in_progress` (because it's a meaningful checkpoint) and from any closed bucket.
- `Referred Out - Coming Back` deals do **not** count as Closed Lost. They do **not** count as Placements either (placements are closed).
- The original brief's mapping of "Referred out coming back" to `closed_lost_referred_out` is wrong on both ends — the deal is active, and there is no `closed_lost_referred_out` category.

---

## #3 — DUI and DV pipelines are reported separately from top-line Admits

**Question:** Do DUI - Cash and DV - Cash wins count toward headline "Admits this month"?

**Resolution:** **No — reported separately.** Top-line Admits = Commercial-Cash + AHCCCS + ZocDoc only. DUI and DV get their own KPIs.

**Consequences:**
- New constant `TOP_LINE_ADMIT_PIPELINES` = `{commercial_cash, ahcccs, zocdoc}`.
- `isAdmit(deal)` predicate classifies *any* Closed - Admitted deal regardless of pipeline (so DV admits do count as `isAdmit`). Top-line Admit KPI = `isAdmit(deal) AND pipeline ∈ TOP_LINE_ADMIT_PIPELINES`. This keeps the predicate orthogonal — the pipeline filter is the responsibility of the dashboard, not the predicate.
- DUI Completion is its own primitive (§9) with its own predicate `isDuiCompletion(deal)`. DUI does not use the Admit concept.
- DV Admits = `isAdmit(deal) AND pipeline = dv_cash`. Surfaced in a DV-specific KPI.

---

## #4 — VOB is stage-based, not custom-field-based

**Question:** Is VOB tracked via a `VOB Submitted` custom field on the Deal, via stage advancement, or both?

**Resolution:** **Stage.** A deal "has a VOB" if it has reached the `VOB - Qualifying` stage at any point. No separate custom field exists.

**Consequences:**
- VOB definition (§5) rewritten: VOB = deal whose stage history includes `VOB - Qualifying` or any later stage.
- Removed `vob_submitted: boolean` from the `DealShape` interface in `definitions.ts`.
- New stage categories `vob_qualifying` and `vob_approved`.
- New implementation question: Phase 1B's deal sync must capture stage transition history, not just current stage. Recorded in OPEN_QUESTIONS.md as `#23`.

---

## #5 — Pipeline names (resolves OPEN_QUESTION #19)

**Resolution:** the five Cornerstone pipelines, exact strings:

| Normalized | Raw Zoho |
|---|---|
| `commercial_cash` | `Commercial-Cash` |
| `ahcccs` | `AHCCCS` |
| `zocdoc` | `ZocDoc` |
| `dui_cash` | `DUI - Cash` |
| `dv_cash` | `DV - Cash` |

All under one layout: `Cornerstone Main Sales Pipeline`.

**Consequences:**
- Pipeline enum updated to 5 values.
- `pipeline_mapping` table seed values in Phase 1B will use these exact raw strings.

---

## #6 — DUI pipeline current status (resolves OPEN_QUESTION #2)

**Resolution:** DUI - Cash is in active use. It is structurally different from the treatment pipelines — it does not have a `Closed - Admitted` stage. Its win stages are `Closed - Screening Only`, `Closed - Both Screening & Classes`, `Closed - Classes Only`. Reported separately from top-line.

**Consequences:**
- `closed_won_dui_completion` stage category.
- `isDuiCompletion(deal)` predicate.
- DUI deals don't carry an LOC in the conventional sense — `OPEN_QUESTION #25` opened to confirm.

---

## #7 — Zoho Analytics workspace and view for Leads (partially resolves OPEN_QUESTION #7)

**Resolution:**
- Workspace ID: `2573883000000036001`
- View ID: `2573883000000035215`
- Report name: `Leads (Zoho CRM)`
- Owner workspace: `Cornerstone Healing Main An...` (Cornerstone Healing Main Analytics workspace)
- Row count at snapshot: 60,666

**Still pending:** OAuth client ID / secret / refresh token, scope, and whether the report supports incremental pull by Modified Time. Phase 1B can't write the sync without these. Tracked under OPEN_QUESTION #7 (residual).

---

## #8 — Insurance Type picklist (resolves OPEN_QUESTION #4)

**Resolution:** the Cornerstone Lead `Insurance Type` picklist contains:

| Value | Lead classification |
|---|---|
| `AHCCCS` | AHCCCS Lead (when treatment LOC) |
| `Commercial Insurance` | Commercial Lead (when treatment LOC) |
| `Cash` | Commercial Lead — **"Cash" replaces the brief's "Private Pay"** |
| `Medicare` | Other Payer Lead (#9) |
| `No Insurance` | Other Payer Lead (#9) |
| `Out of State Medicaid` | Other Payer Lead (#9) |

**Consequences:**
- `INSURANCE_TYPE.Cash` replaces `INSURANCE_TYPE.PrivatePay` in TS constants and Postgres enums.
- `COMMERCIAL_INSURANCE_TYPES = [CommercialInsurance, Cash]`.
- `AHCCCS_INSURANCE_TYPES = [Ahcccs]` (unchanged).
- New `OTHER_PAYER_INSURANCE_TYPES = [Medicare, NoInsurance, OutOfStateMedicaid]`.

---

## #9 — Other Payer Lead bucket

**Question:** how do Medicare, No Insurance, and Out of State Medicaid fit?

**Resolution:** **own bucket — reported separately.** None of the three roll into AHCCCS Lead or Commercial Lead. They surface as Other Payer Lead alongside the existing payer-split.

**Consequences:**
- New primitive `Other Payer Lead` (§19 in METRIC_DEFINITIONS.md).
- New predicate `isOtherPayerLead(lead)`.
- The headline payer-split chart shows AHCCCS / Commercial / Other Payer.

---

## #10 — Lead Score Rating field (resolves OPEN_QUESTION #5)

**Resolution:** the field is named **`Lead Score Rating`** — a single Zoho picklist column. There is no separate numeric "stars" field. Star count is parsed from the leading ⭐ characters in the picklist label.

Confirmed values (1-3 star labels visible verbatim; 4 and 5 star labels truncated in screenshot — see OPEN_QUESTION #27):
- 0: `Unable To Score/Never Made Contact`
- 1: `⭐ Junk/Spam`
- 2: `⭐⭐ HR/Client Care/Family/Care Coordination...`
- 3: `⭐⭐⭐ Seeking Treatment: Medicaid` → AHCCCS-eligible
- 4: `⭐⭐⭐⭐ Seeking Treatment: Commercial, ...` → Commercial-eligible
- 5: `⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, ...` → Commercial-eligible

**Consequences:**
- `LeadRowSchema` adds `lead_score_rating: string | null` and keeps the derived `star_rating: 0-5 | null`.
- `leadScoreRatingToStarCount(rating)` is the canonical conversion.
- The existing brief's classification rules (3 star = AHCCCS; 4-5 star = Commercial) are preserved.

---

## #11 — Level of Care picklist (resolves OPEN_QUESTION #11)

**Resolution:** the Zoho Lead `Level of Care Requested` picklist contains 13 Cornerstone-specific values:

`BHRF`, `Detox`, `PHP`, `IOP5`, `IOP3`, `VIOP Adult`, `VIOP Adolescent`, `OP`, `VOP`, `VOP Adult`, `VOP Adolescent`, `DUI`, `DV`.

The brief's ASAM-aligned candidates (Detox/Residential/PHP/IOP/OP/Sober Living) are partially wrong: Cornerstone uses BHRF instead of Residential (Arizona terminology), splits IOP into IOP5/IOP3 by frequency, has Virtual IOP and Virtual OP variants by adult/adolescent, and includes DUI and DV themselves as LOC values.

**Consequences:**
- `LEVEL_OF_CARE` enum rewritten to the 13 values above.
- `TREATMENT_LOC_VALUES` set excludes DUI and DV (the two program LOCs).
- Postgres `level_of_care` enum migration updated.

---

## #12 — LOC = DUI/DV implies pipeline

**Question:** at the Lead level, do DUI/DV LOC values lock the lead into the DUI - Cash / DV - Cash pipelines? Or can such a lead end up in Commercial-Cash if insurance changes?

**Resolution:** **yes — LOC = DUI implies pipeline = DUI - Cash; LOC = DV implies pipeline = DV - Cash.** LOC at the Lead level drives program routing.

**Consequences:**
- AHCCCS Lead, Commercial Lead, Other Payer Lead classifiers are gated on `isTreatmentLead(lead)` = LOC ∉ {DUI, DV}.
- A DUI lead with `insurance_type = AHCCCS` is classified as a DUI Lead, not an AHCCCS Lead.
- A DV lead with `star_rating = 5` is classified as a DV Lead, not a Commercial Lead.
- New predicates: `isTreatmentLead`, `isDuiLead`, `isDvLead`.

---

## #13 — Source Category is the canonical attribution field (partial resolution of #17)

**Question:** Zoho Leads carry four attribution fields: `Generated By`, `Tracking Source`, `Source Category`, `Source Medium`. Which one drives the BD / ZocDoc / Digital Marketing classification?

**Resolution:** **`Source Category`** is the canonical field. The other three (Generated By, Tracking Source, Source Medium) are observable but secondary; they do not feed the headline marketing-channel split.

**Consequences:**
- The existing catch-all rule stands: `Source Category = "Business Development"` → BD; `= "ZocDoc"` → ZocDoc; everything else → Digital Marketing.
- The example lead's `Source Category = SEO` correctly falls into Digital Marketing via the catch-all.
- Still pending: the full enumeration of `Source Category` raw values currently in production (OPEN_QUESTION #17 residual).

---

## #14 — Insurance Type: stored values differ from display labels

**Source:** Zoho CRM `getFields` API call against the Leads module.

**Resolution:** the Zoho API returns the *stored* (actual) value, not the display label. Two of the six insurance values have a stored/display mismatch:

| Display label | Stored value (what API returns) |
|---|---|
| Commercial Insurance | `Private Insurance` |
| Cash | `Cash Pay` |
| AHCCCS, Medicare, No Insurance, Out of State Medicaid | (same as display) |

The Zoho `Insurance_Type` picklist also contains EPO, HMO, POS, and PPO values overloaded into the same field. Those are network types and properly belong in the separate `Insurance_Policy_Type` field (a 4-value picklist: PPO / HMO / EPO / POS / Not Applicable). Per Amber's direction, we ignore both the network-type values in `Insurance_Type` and the entire `Insurance_Policy_Type` field for Phase 1A — see OPEN_QUESTION #29.

**Consequences:**
- `INSURANCE_TYPE.CommercialInsurance` = `"Private Insurance"` (was `"Commercial Insurance"`).
- `INSURANCE_TYPE.Cash` = `"Cash Pay"` (was `"Cash"`).
- Postgres `insurance_type` enum and Zod `InsuranceTypeEnum` updated to match.
- Display formatting of insurance values in the UI is handled at the resolver layer (Phase 1C), not in the canonical constants.

---

## #15 — Rep Profile names (resolves OPEN_QUESTION #6)

**Source:** Zoho CRM `getUsers` against all 37 active users.

**Resolution:** four distinct profiles in production:

| Profile | Role classification | Notes |
|---|---|---|
| `TREATMENT Standard` | Admissions Rep | **All caps on TREATMENT** — not "Treatment Standard" |
| `Administrator` | Admissions Rep | **Not "Admin"** — full word |
| `Call Center AHCCCS` | Admissions Rep | See #16 |
| `Business Development` | BD Rep | (unchanged) |

**Consequences:**
- `ADMISSIONS_REP_PROFILES` updated to `["TREATMENT Standard", "Administrator", "Call Center AHCCCS"]`.
- `BD_REP_PROFILE` = `"Business Development"` (unchanged).
- Old casings ("Treatment Standard", "Admin") no longer match.

---

## #16 — Call Center AHCCCS counts as Admissions Rep

**Question:** the `Call Center AHCCCS` profile (5+ active users including Berenice, Gerardo, Karla, Cynthia, Jose, Simon) — do these count as Admissions Reps for reporting?

**Resolution:** **Yes.** They handle AHCCCS-line intake — same workflow class as treatment intake, just specialized to the AHCCCS pipeline. Their activity rolls up into Admissions Rep metrics alongside TREATMENT Standard + Administrator.

**Consequences:**
- `ADMISSIONS_REP_PROFILES` includes `"Call Center AHCCCS"`.
- No need for a separate `call_center_rep` role; they classify as `admissions_rep` via `profileToRepRole`.

---

## #17 — Source Category full picklist + catch-all rule confirmed

**Source:** Zoho CRM `getFields` against Leads module.

**Resolution:** the Zoho `Source Category` picklist contains 13 values (excluding `-None-`):

`Alumni`, `Business Development`, `Call Center`, `Directory Listing`, `Internal`, `Option 1`, `Option 2`, `Organic Social`, `Paid Social`, `PPC`, `SEO`, `ZocDoc`.

Amber confirmed the catch-all classification rule stands as written: **everything not in `{Business Development, ZocDoc}` rolls up to Digital Marketing.** That means Alumni, Call Center, Internal, and the two placeholder "Option 1"/"Option 2" values all flow into Digital Marketing.

**Consequences:**
- `rawSourceToSourceCategory` unchanged.
- Phase 1B's `source_category_mapping` seeds all 11 non-BD/non-ZocDoc raw strings → Digital Marketing.
- `v_unmapped_sources` will be empty against current production data.

---

## #18 — Zoho CRM credentials reused; Analytics scope added via re-auth (resolves OPEN_QUESTION #7)

**Source:** existing Supabase Edge Function secrets surfaced via `mcp__supabase__get_edge_function` on `zoho-pull`, `etl-warehouse-zoho`, and a dozen other functions already in production.

**Resolution:** Phase 1B's Deals/Users/Meetings sync reuses these existing CRM secrets in Supabase Edge Function env:
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_API_DOMAIN` (defaults to `https://www.zohoapis.com`)
- `ZOHO_ACCOUNTS_DOMAIN` (defaults to `https://accounts.zoho.com`)

For Zoho Analytics access (Phase 1B Leads sync), Amber re-authorizes the existing Self Client at `api-console.zoho.com` with the combined scope:
`ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoAnalytics.data.READ,ZohoAnalytics.metadata.READ`
The new refresh token replaces the existing `ZOHO_REFRESH_TOKEN` secret. Same client ID/secret, single token covering both APIs.

---

## #19 — VOB uses BOTH the boolean field and stage (revises CONFIRMED.md #4)

**Source:** `getFields` on the Deals module surfaced custom fields `VOB_Submitted` (boolean), `VOB_Submitted_By` (text), `VOB_Submitted_Date` (date). The existing `etl-warehouse-zoho` function uses both the boolean and the stage.

**Resolution:** VOB has two signals:
- **`vob_submitted` boolean field** answers "has a VOB ever been submitted?" — used as the metric trigger, with `vob_submitted_date` as the date attribution.
- **`stage_category in {vob_qualifying, vob_approved}`** answers "what is the current VOB status?" — used for "VOB Approved" as a distinct metric.

This **revises CONFIRMED.md #4**, which previously said VOB was stage-only with no custom field. The boolean field does exist; Amber's earlier answer is amended.

**Consequences:**
- `DealShape` has `vob_submitted: boolean` again (the rev 3 removal was a mistake).
- `isVobSubmitted(deal)` = boolean is true.
- `isVobApproved(deal)` = `stage_category = vob_approved`.
- `VobDefinitionSchema` uses `vob_submitted: true` rule and `vob_submitted_date` as date_field.
- The "current-stage proxy for VOB" caveat from OPEN_QUESTION #23 is removed — we have the boolean.

---

## #20 — Admit metric counts on `Admit_Date` strictly (resolves OPEN_QUESTION #14)

**Source:** `getFields` on Deals confirmed `Admit_Date` (custom date field, distinct from the standard `Closing_Date`).

**Resolution:** the Admit metric counts on `Admit_Date` only. Deals where `stage_category = closed_won_admitted` but `admit_date IS NULL` are **excluded** from the headline Admit KPI. They surface in a data-quality view in Phase 1B (`v_admits_missing_date`) for specialist follow-up.

**Consequences:**
- `DealShape.admit_date: string | null`.
- `isAdmit(deal)` stays stage-based (`stage_category = closed_won_admitted`) — the classifier matches what the deal IS.
- `isCountableAdmit(deal)` = `isAdmit(deal) AND admit_date !== null` — what the metric counts.
- `AdmitDefinitionSchema` adds `admit_date_not_null: true` rule and `admit_date` as date_field.
- `closing_date` becomes informational only for admits; still used for `closed_lost`, `closed_won_referred_out_unattached`, and DUI completions where no `admit_date` makes sense.

---

## #21 — Both LOC fields exist; original brief's rule is implementable (revises OPEN_QUESTION #25)

**Source:** `getFields` on Deals shows both `Level_of_Care_Requested` AND `Admitted_Level_of_Care` exist as custom picklist fields.

**Resolution:** the brief's stage-dependent LOC rule is correct:

| Funnel stage | LOC source field |
|---|---|
| Lead | Leads → `Level_of_Care_Requested` (13-value picklist) |
| MQL / VOB / Placement / Closed Lost | Deals → `Level_of_Care_Requested` (13-value picklist, mirror of Leads) |
| **Admit** | Deals → **`Admitted_Level_of_Care`** (9-value picklist, more restrictive) |

`Admitted_Level_of_Care` is a *subset* of the Lead-side LOC enum. Its picklist contains only `BHRF, PHP, IOP5, IOP3, VIOP Adult, VIOP Adolescent, DUI, DV` — notably excluding `Detox, OP, VOP, VOP Adult, VOP Adolescent`. Treatment admits typically land at BHRF/PHP/IOP5/IOP3/VIOP; DUI/DV are program admits (with the DUI Completion / DV Admit metrics handling them).

**Consequences:**
- `DealRowSchema` keeps both `level_of_care_requested` and `admitted_level_of_care`.
- The Phase 1B normalization writes both columns from the corresponding Zoho fields.
- The single `LEVEL_OF_CARE` enum is reused for both fields; downstream code that expects a tighter "admitted LOC" set can filter to the 9-value subset.

---

## #22 — `DUI_or_Treatment` field confirmed (display label: `Treatment or Court Services`) — resolves OPEN_QUESTION #28

**Source:** `getFields` on Deals; api_name = `DUI_or_Treatment`, display_label = `Treatment or Court Services`.

**Resolution:** the picklist has 4 values: `Treatment`, `DUI`, `Domestic Violence`, `N/A or Other`. This is the canonical Deal-side routing signal:
- `Treatment` → routes to Commercial-Cash / AHCCCS / ZocDoc pipelines
- `DUI` → routes to DUI - Cash pipeline
- `Domestic Violence` → routes to DV - Cash pipeline
- `N/A or Other` → fallback bucket

For Phase 1A this confirms that the Lead-side LOC = DUI/DV → pipeline routing (CONFIRMED.md #12) has a Deal-side counterpart. Phase 1B can use `DUI_or_Treatment` as the authoritative pipeline router; LOC is a secondary signal.

---

## #23 — Stage canonical = display labels (resolves CONFIRMED.md #5 ambiguity)

**Source:** `getFields` on Deals revealed that stored actual_value differs from display_value for many stages (e.g., `Closed - Admitted` display → `Closed Won` actual; `Stuck Lead - Commercial/Cash` display → `Stuck Lead` actual).

**Resolution:** the canonical raw string in `RAW_STAGE_TO_CATEGORY` is the **display label**, not the stored actual_value. Phase 1B's sync layer is responsible for translating Zoho's stored actual_value → display label before classification.

This matches how a rep sees the field in the CRM and matches the screenshots Amber used to build the original taxonomy. It does mean the sync has an additional translation step (built from `getFields`' picklist metadata).

**Consequences:**
- `RAW_STAGE_TO_CATEGORY` keys stay as display labels.
- Phase 1B's `sync_zoho_crm_deals` calls `getFields` once at sync start to build the actual→display translation table.
- A defensive fallback in Phase 1B logs unmapped values to `v_unmapped_stages` for triage.

---

## #24 — Lead overlap: insurance-wins precedence (resolves OPEN_QUESTION #9)

**Question:** A Lead with `star_rating = 3` AND `insurance_type = "Commercial Insurance"` matches both AHCCCS Lead and Commercial Lead. Which wins?

**Resolution:** **Insurance wins.** When `insurance_type` is set (not null), it's the authoritative classifier; star rating is ignored. When `insurance_type` is null, star rating becomes the fallback signal.

| insurance_type | star_rating | Result |
|---|---|---|
| Commercial Insurance | 3 | Commercial (insurance wins) |
| Commercial Insurance | 5 | Commercial |
| AHCCCS | 5 | AHCCCS (insurance wins) |
| AHCCCS | 3 | AHCCCS |
| Medicare | (any) | Other Payer |
| null | 3 | AHCCCS (star fallback) |
| null | 4 or 5 | Commercial (star fallback) |
| null | null | Unclassified |

**Consequences:**
- `isAhcccsLead` and `isCommercialLead` updated: insurance check is exhaustive when present, star is the fallback.
- SPEC CASE #1 test rewritten: star=3 + Commercial Insurance → Commercial only (not both).
- Buckets are mutually exclusive — no double-counting when AHCCCS and Commercial counts are summed.

---

## #25 — Pipeline × Source orthogonality with deduplication (resolves OPEN_QUESTION #10)

**Resolution:** **orthogonal across dimensions, distinct in totals.**

A Deal with `pipeline = commercial_cash` AND `source_category = business_development` and stage `closed_won_admitted` counts:
- In the "Admits by Pipeline" chart: 1 under Commercial.
- In the "Admits by Source" chart: 1 under BD.
- In the headline "Total Admits this month" KPI: 1 (not 2).

The dimensions are independent multi-selects in the FilterBar. The headline totals always show distinct deal counts; per-dimension breakdowns can sum to more than the total. Dashboards must label per-dimension charts clearly so leadership doesn't misread the sums.

---

## #26 — MQL top-line filter (resolves OPEN_QUESTION #22)

**Resolution:** **headline MQL = MQL AND pipeline ∈ {Commercial-Cash, AHCCCS, ZocDoc}.** Same restriction as Admit. DUI and DV deals count as MQLs only inside their own pipeline-specific KPIs; never in the headline funnel.

**Consequences:** `isTopLineMql` predicate stays as written. Doc §4 confirms the rule explicitly.

---

## #27 — Referral In: source_category=BD OR BD_Rep is set (resolves OPEN_QUESTION #15)

**Question:** What makes a Lead a Referral In?

**Resolution:** Lead is a Referral In if **either**:
- `source_category = "Business Development"`, OR
- The `BD_Rep` Lead picklist field is set to a specific BD rep name (not null, not `-None-`, not `None`).

The `BD_Rep` field is a 20-value picklist of BD rep names (Amber, Ashley, Casey, Dane, Emari, Farah, etc.) — set on a Lead when a specific BD rep brought the referral in.

**Consequences:**
- `LeadShape` adds `bd_rep_inbound: string | null`.
- New predicate `isReferralIn(lead)` implements the OR rule.
- `LeadRowSchema` adds the matching field.
- `ReferralInDefinitionSchema` rule = `source_category_or_bd_rep_set: true`.

---

## #28 — Orphan deals fall back to Deal Created_Time (resolves OPEN_QUESTION #21)

**Resolution:** when a Closed-Admitted Deal has no matching Lead row in Zoho Analytics, Sales Cycle = `closing_date − deal.created_time`. The Deal's own creation timestamp substitutes for the missing Lead creation. Phase 1B's Sales Cycle calc handles this fallback.

**Trade-off:** under-reports cycle time slightly (the lead almost always existed before the Deal was created), but avoids excluding admits.

---

## #29 — Placement cycle metric scheduled (resolves OPEN_QUESTION #26)

**Resolution:** Phase 1B adds `op_placement_cycle_daily` alongside `op_sales_cycle_daily`. Same shape:

```
placement_cycle_days = closing_date − lead.created_time
  for deals where stage_category = closed_won_referred_out_unattached
```

Tracks how fast specialists place callers they can't take. Cheap to maintain.

---

## #30 — DUI granularity: roll up by default, drill-down available (resolves OPEN_QUESTION #24)

**Resolution:** the headline KPI shows a single `DUI Completions` count combining `Closed - Screening Only`, `Closed - Both Screening & Classes`, `Closed - Classes Only`. Clicking the KPI opens a breakdown by subtype.

**Consequences:**
- The normalized `deals` table adds a derived `dui_completion_subtype` field (one of: `screening_only` / `both` / `classes_only` / `null`) for the drill-down.
- The `stage_category` enum stays as `closed_won_dui_completion` for the rollup.

---

## #31 — Lead `Created_Time` is the intake moment (resolves OPEN_QUESTION #13)

**Resolution:** Zoho `Created_Time` on a Lead represents the moment the lead first came in — form submission, call answered, walk-in registered. Sales Cycle math uses this value directly as the start point.

---

## #32 — Insurance_Policy_Type deferred to Phase 2 (resolves OPEN_QUESTION #29)

**Resolution:** the separate `Insurance_Policy_Type` field (PPO/HMO/EPO/POS/Not Applicable) is a real reporting dimension but is **not in Phase 1**. Phase 2 adds a Network multi-select to the FilterBar for Commercial leads. Phase 1B schema does not include the field.

---

## #33 — VOB classifier priority chain (refines CONFIRMED.md #19)

**Source:** Amber's direct refinement of METRIC_DEFINITIONS.md §5 — primary fields first, stage-based methodology as a backup, and an explicit edge case for deals that close lost without ever VOBing.

**Resolution:** the canonical VOB classifier `isVobSubmitted(deal)` evaluates signals in priority order:

1. **Primary signal A:** `vob_submitted = true` → VOB. Return true immediately.
2. **Primary signal B:** `vob_submitted_date IS NOT NULL` → VOB. Specialists sometimes set the date without flipping the boolean; we honor either.
3. **Backup signal:** `stage_category` is one of `{vob_qualifying, vob_approved, pre_admit, referred_out_coming_back, closed_won_admitted, closed_won_referred_out_unattached}` → VOB. The deal is currently past the VOB step in the funnel, so a VOB must have happened.
4. **Otherwise:** not a VOB.

**Critical edge case (the bug fix):** `closed_lost` is **EXCLUDED** from the backup set. A deal can be created and closed-lost without ever VOBing (Stuck Lead → Closed Lost, lost to competition, caller dropped off). The previous taxonomy (rev 5) had `closed_lost` in the at-or-past-VOB set, which falsely classified every closed-lost deal as VOB-having. Fixed.

A `closed_lost` deal **with** either primary signal set still counts as VOB (it ran VOB and then lost).

`closed_won_dui_completion` is also excluded — DUI pipeline has no VOB stages.

**Consequences:**
- `STAGE_CATEGORIES_AT_OR_PAST_VOB` constant updated: 6 values now (removed `ClosedLost`).
- `isVobSubmitted` rewritten with the priority chain.
- `DealShape` adds `vob_submitted_date: string | null` (was already in `DealRowSchema`).
- `VobDefinitionSchema` rule = `any_of: [vob_submitted_eq_true, vob_submitted_date_not_null, stage_category_at_or_past_vob]`.
- New tests cover all six combinations: primary-true / date-set / stage-backup / closed-lost-no-fields (NOT VOB) / closed-lost-with-fields (IS VOB) / DUI (NOT VOB).

---

## #34 — Admit priority chain (revises CONFIRMED.md #20)

**Source:** Amber's refinement of METRIC_DEFINITIONS.md §6 — same shape as the VOB priority chain.

**Resolution:** `isAdmit(deal)` evaluates signals in priority order:

1. **Primary:** `admit_date` is non-null → Admit.
2. **Backup:** `stage_category = closed_won_admitted` → Admit (stage advancement is sufficient evidence even if Admit_Date hasn't been filled in yet).
3. **Otherwise:** not an Admit.

This **revises CONFIRMED.md #20**, which previously said the Admit metric counts on `Admit_Date` strictly. Stage advancement is now an accepted backup signal — specialists who close-admit a deal but forget to populate Admit_Date still produce Admits in reporting.

**Date attribution** in Phase 1B fact_admit: `COALESCE(admit_date, closing_date)`. Phase 1B's data-quality view (`v_admits_missing_date`) still surfaces stage=closed_won_admitted + admit_date IS NULL deals so the specialist can backfill the missing date.

**Consequences:**
- `isAdmit` rewritten with the 2-signal chain.
- `isCountableAdmit` is removed — no longer a useful distinction.
- `AdmitDefinitionSchema` rule = `any_of: [admit_date_not_null, stage_category_eq_closed_won_admitted]`.
- New tests cover four cases: admit_date set / stage backup / closed_lost without admit_date (NOT Admit) / in_progress without admit_date (NOT Admit).

---

## #35 — Source Category is a Zoho Global Picklist (refines CONFIRMED.md #13)

**Source:** Amber confirmation + Zoho `getFields` showing `global_picklist` set on the `Source_Category` field on both Leads and Deals.

**Resolution:** `Source_Category` is a Zoho Global Picklist — the same picklist values are shared across the Lead and Deal modules. Adding or renaming a value in one place updates everywhere. The API returns 13 values (including `-None-`, `Call Center`, `Option 1`, `Option 2`); the active Deal UI dropdown surfaces only 9 (`Alumni`, `Business Development`, `Directory Listing`, `Internal`, `Organic Social`, `Paid Social`, `PPC`, `SEO`, `ZocDoc`).

**Consequences:**
- Phase 1B's `source_category_mapping` is seeded ONCE from the global picklist and serves both Leads and Deals.
- The 4 hidden values (Call Center, Option 1, Option 2) are tracked under OPEN_QUESTION #34 — either active in Zoho but not displayed, legacy debris to clean up, or specific to a different module. Phase 1B sync logs any production deal/lead carrying one of these so we know whether they're in use.

---

## #36 — Closed Lost reason capture per pipeline

**Source:** Zoho `getFields` on Deals — three loss-reason fields exist.

**Resolution:** Closed Lost deals carry a reason populated from the appropriate per-pipeline field:

| Pipeline | Reason source field | Picklist count |
|---|---|---|
| Commercial-Cash / AHCCCS / ZocDoc | `Lost_Reasoning` (display: "Close Reasoning (Treatment)") | 45 values |
| DUI - Cash | `Close_Reasoning_DUI` (display: "Close Reasoning (DUI)") | 6 values: Lost to Competition, Non-Responsive (DUI), Referred Out, Sold - Screening, Unmet Financial Responsibility, Unqualified |
| DV - Cash | (no dedicated field yet) | — |
| Generic fallback | `Reason_For_Loss__s` (Zoho system field) | 10 values: Expectation Mismatch, Price, Unqualified Customer, Lack of response, Missed Follow Ups, Wrong Target, Competition, Future Interest, Other |

**Consequences:**
- `DealRowSchema` adds `closed_lost_reason: string | null`. Populated only when stage_category = closed_lost.
- Phase 1B's `sync_zoho_crm_deals` reads the appropriate source field by pipeline.
- Reporting can break Closed Lost by reason via the new column.
- DV pipeline lacks a dedicated reason field — surfaced as OPEN_QUESTION #35.

---

## Document changelog

- **2026-05-27** — Created alongside METRIC_DEFINITIONS.md rev 2. Seven resolutions recorded (#1–#7).
- **2026-05-27 (rev 2)** — Added six resolutions (#8–#13) alongside METRIC_DEFINITIONS.md rev 3. Closes OPEN_QUESTIONS #4, #5, #11; partially closes #17.
- **2026-05-27 (rev 3)** — Added four resolutions (#14–#17) from live Zoho CRM API queries. Closes OPEN_QUESTIONS #6 and the residual of #17. Adds new OPEN_QUESTION #29 (Insurance_Policy_Type dimension deferred) and #30 (PPO/Unknown data anomaly).
- **2026-05-27 (rev 4)** — Added six resolutions (#18–#23) from Supabase Edge Function inspection + Zoho Deals `getFields` + Amber's rev 5 answers. Closes OPEN_QUESTIONS #7, #14, #20 (transformed; the stage-history requirement is gone now that we have a boolean field), #25, #28. Revises CONFIRMED.md #4 (VOB now uses both signals).
- **2026-05-27 (rev 5)** — Added nine resolutions (#24–#32) batch-closing the remaining policy questions. Closes OPEN_QUESTIONS #9, #10, #13, #15, #21, #22, #24, #26, #29. OPEN_QUESTIONS #18 (test record exclusion) and #30 (PPO=Unknown anomaly) explicitly remain deferred — #18 to Phase 1B sample-data triage, #30 to Zoho cleanup.
- **2026-05-27 (rev 6)** — Added #33 refining the VOB classifier per Amber's edge case (closed_lost without VOB fields must NOT count as VOB).
- **2026-05-27 (rev 7)** — Added #34 (Admit priority chain, mirrors VOB), #35 (Source Category Zoho Global Picklist), #36 (Closed Lost reason capture per pipeline). Revises CONFIRMED.md #20.
