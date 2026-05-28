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

## Document changelog

- **2026-05-27** — Created alongside METRIC_DEFINITIONS.md rev 2. Seven resolutions recorded (#1–#7).
- **2026-05-27 (rev 2)** — Added six resolutions (#8–#13) alongside METRIC_DEFINITIONS.md rev 3. Closes OPEN_QUESTIONS #4, #5, #11; partially closes #17.
