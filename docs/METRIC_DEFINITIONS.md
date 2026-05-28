# Metric Definitions

**Status:** Phase 1A draft, revision 3 — pending Amber sign-off in `CONFIRMED.md`.
**Owner:** Reporting foundation working group.
**Phoenix is the operating timezone for every date boundary in this document.** Arizona does not observe DST; Phoenix midnight = 07:00 UTC year-round.

This document is the single source of truth for every reporting primitive used by the Admissions Copilot. Every chart, every KPI, and every cached operational metric table is built on top of the definitions below. If a definition is wrong here, it is wrong everywhere.

Open ambiguities are listed inline as `OPEN_QUESTION #N` and collected in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md). Resolved ambiguities live in [`CONFIRMED.md`](CONFIRMED.md). Nothing downstream of this document is permitted to "decide" an ambiguity — every open question must be resolved by Amber before Phase 1B begins.

---

## 0. Source systems

| System | Role | How we read it |
|---|---|---|
| **Zoho Analytics** | Source of truth for **Leads** (preserves pre-conversion state) | Pre-built report `Leads (Zoho CRM)` — workspace `2573883000000036001`, view `2573883000000035215`. Pulled via Analytics API. OAuth credentials pending — see `OPEN_QUESTION #7`. |
| **Zoho CRM** | Source of truth for **Deals**, **Users**, **Meetings** | Live API, incremental by `Modified_Time`. |
| **Call Tracking Metrics (CTM)** | Source of truth for **Calls** | Live API, incremental. |

**Why Zoho Analytics for Leads:** When a specialist converts a Lead to a Deal in Zoho CRM, the original Lead row disappears from the Leads module. A live CRM query today would only see leads that *never* converted — i.e., the losses — and would miss every Lead that became a Deal. Zoho Analytics maintains a separate, persistent snapshot of all leads including converted ones (60,666 rows at last check), and is therefore the only place historical lead volume survives.

---

## 1. Lead

A **Lead** is one row in the `Leads (Zoho CRM)` Zoho Analytics table, captured at the point the Lead was first created — even if that row has since been converted to a Deal.

- **Source:** Zoho Analytics → `Leads (Zoho CRM)` view.
- **Identity:** Zoho Lead ID (column `Id`).
- **Owner:** Zoho `Interaction Owner` → resolved to `user_identity.id` via Phase 1B mapping.
- **Created at:** Zoho Leads `Created Time` — see `OPEN_QUESTION #13` for semantics.
- **Rule:** every row in the Analytics Leads view is a Lead. No filter is applied at the definition layer; filtering by source/LOC/insurance/star happens via the filter contract.
- **Edge cases:**
  - A Lead that has been converted to a Deal still counts as a Lead on the date it was created. The Lead row is preserved by the Analytics snapshot.
  - The same caller contacting multiple times can produce multiple Lead rows. Deduplication is **not** part of the Lead definition — each row counts once.
  - Test Leads and internal test rows must be excluded. See `OPEN_QUESTION #18`.

---

## 2. Pipeline

A Deal in Zoho CRM belongs to exactly one of **five** pipelines (layout: `Cornerstone Main Sales Pipeline`):

| Normalized name | Raw Zoho string | Purpose | Top-line? |
|---|---|---|---|
| `commercial_cash` | `Commercial-Cash` | Commercial insurance + private pay | Yes |
| `ahcccs` | `AHCCCS` | AHCCCS Medicaid | Yes |
| `zocdoc` | `ZocDoc` | ZocDoc-sourced treatment funnel | Yes |
| `dui_cash` | `DUI - Cash` | DUI program — screening + classes, not treatment | No |
| `dv_cash` | `DV - Cash` | Domestic Violence program | No |

"Top-line" = pipeline counts toward the headline Admit, MQL, and VOB KPIs. DUI and DV are real pipelines and get their own reporting, but they are not folded into the headline funnel — they operate on a different model (screenings, classes, court-mandated participation) and their wins are not "treatment admits." This is the source of the `TOP_LINE_ADMIT_PIPELINES` set in `definitions.ts`.

---

## 3. Stage Category (normalized rollup of every raw Zoho stage string)

A normalized rollup of every raw Zoho stage string into one of the following buckets. The Phase 1B `stage_mapping` table is the place where raw → normalized lives. The normalized set is what every metric and predicate operates on.

| Normalized category | Funnel position | Raw Zoho stage strings (per pipeline) |
|---|---|---|
| `in_progress` | Pre-VOB, default | `Stuck Lead - Commercial/Cash`, `Stuck Lead - Ahcccs`, `Stuck Lead - DUI (Cash)`, `Stuck Lead - DV (Cash)`, `Stuck Lead - ZocDoc`, `Qualifying Services` (DUI), `Scheduled Payment` (DUI), `Intake Scheduled` (DV) |
| `vob_qualifying` | VOB submitted, awaiting outcome | `VOB - Qualifying` (Commercial-Cash, AHCCCS, ZocDoc) |
| `vob_approved` | VOB approved, pre-admit | `VOB - Approved` (Commercial-Cash, AHCCCS, ZocDoc) |
| `pre_admit` | Active and progressing toward admit | `PA - Scheduling/Scheduled`, `PA - Completed`, `Direct Admit - Scheduled`, `Step Down - Scheduled` (Commercial-Cash, ZocDoc); `Pre Screen - Scheduled`, `Pre Screen - Completed`, `Intake Assessment - Scheduled` (AHCCCS); `Orientation Scheduled`, `Open Payment Plan` (DV, DUI) |
| `referred_out_coming_back` | Active but parked at a partner — may return | `Referred Out - Coming Back` (Commercial-Cash, AHCCCS, ZocDoc) |
| `closed_won_admitted` | **Treatment Admit** — the headline win | `Closed - Admitted` (Commercial-Cash, AHCCCS, DV - Cash, ZocDoc) |
| `closed_won_referred_out_unattached` | **Placement win** — we found them somewhere else | `Closed - Referred Out Unattached` (Commercial-Cash only) |
| `closed_won_dui_completion` | DUI program completion (any flavor) | `Closed - Screening Only`, `Closed - Both Screening & Classes`, `Closed - Classes Only` (DUI - Cash only) |
| `closed_lost` | Lost — caller did not engage | `Closed - Lost (Treatment)`, `Closed - Lost (DUI)`, `Closed - Lost (DV)` |

Two rules govern this set:

1. **Won-by-placement is a win, not a loss.** `Closed - Referred Out Unattached` rolls up as a *closed-won* outcome because Cornerstone's reporting treats placing a caller at another provider as success — the specialist did their job. This is a deliberate departure from the Phase 1A draft, which had previously treated it as Closed Lost. See `CONFIRMED.md` entry #1.

2. **`Referred Out - Coming Back` is active.** The deal is still open and the caller may return. It does **not** roll up to any closed category. See `CONFIRMED.md` entry #2.

Unmapped raw stage strings will surface in `v_unmapped_stages` (Phase 1B).

---

## 4. MQL (Marketing Qualified Lead)

An **MQL** is a Deal that exists in Zoho CRM at all.

- **Source:** Zoho CRM Deals.
- **Rule:** the Deal record exists. Creation alone qualifies — no stage filter.
- **Counted on:** the Deal's `Created_Time` (Phoenix-local date).
- **Top-line MQL** = MQL **AND** `pipeline ∈ TOP_LINE_ADMIT_PIPELINES`. The headline "MQLs this month" KPI uses the top-line filter; DUI and DV deals exist as MQLs in their own right but do not roll into the headline funnel. See `OPEN_QUESTION #22` to confirm.

---

## 5. VOB (Verification of Benefits)

A **VOB** is a Deal where at least one of the following is true:

1. **`VOB_Submitted` boolean field is `true`** — primary signal.
2. **`VOB_Submitted_Date` is non-null** — primary signal (specialists sometimes set the date without flipping the boolean; we honor either).
3. **Stage-based backup** (when both fields are empty): `stage_category` is one of `vob_qualifying`, `vob_approved`, `pre_admit`, `referred_out_coming_back`, `closed_won_admitted`, `closed_won_referred_out_unattached`. The deal is currently sitting past the VOB step, so a VOB must have run.

Per CONFIRMED.md #33: the two primary signals are the canonical sources of truth. The stage-based backup is a fallback for deals where the specialist didn't fill in the VOB fields but the stage advancement proves a VOB happened.

**Critical edge case:** `closed_lost` is **excluded** from the stage-based backup. A deal can move directly from `Stuck Lead → Closed Lost` without ever running a VOB (the caller dropped off, was lost to competition, etc.). Treating every `closed_lost` deal as VOB-having would inflate the VOB count. A `closed_lost` deal with empty `VOB_Submitted` boolean AND empty `VOB_Submitted_Date` is **not** a VOB.

A `closed_lost` deal **with** either primary signal set IS a VOB — it ran VOB and then lost.

- **Source:** Zoho CRM Deals.
- **Top-line VOB** = VOB **AND** top-line pipeline. (DUI and DV pipelines don't have VOB stages at all, so this filter is effectively automatic, but the predicate is the same.)
- **Counted on:** `VOB_Submitted_Date` when set; otherwise the date `vob_submitted` flipped to true (Zoho's `Modified_Time` is the proxy if no flip-timestamp is captured). Phase 1B `sync_zoho_crm_deals` is responsible for picking the date.
- **`closed_won_dui_completion` is excluded** from the backup set — DUI - Cash pipeline has no VOB stages.

---

## 6. Admit

An **Admit** is a Deal with stage category `closed_won_admitted`.

- **Source:** Zoho CRM Deals.
- **Rule:** `stage_category = closed_won_admitted`. The raw Zoho stage is `Closed - Admitted` across all four pipelines that have it (Commercial-Cash, AHCCCS, DV - Cash, ZocDoc).
- **Top-line Admit** = Admit **AND** `pipeline ∈ TOP_LINE_ADMIT_PIPELINES`. The headline "Admits this month" KPI excludes DV admits. DV's `Closed - Admitted` is reported as a separate DV Admits KPI.
- **Counted on:** `Closing_Date` (see `OPEN_QUESTION #14` to confirm field name).
- **Edge cases:** a Deal that reaches Closed - Admitted, gets reopened, and is re-closed: counted on the most recent transition.

---

## 7. Placement (Closed-Won Referred Out Unattached)

A **Placement** is a Deal closed at `Closed - Referred Out Unattached` — the specialist successfully placed the caller at another provider when Cornerstone couldn't take them.

- **Source:** Zoho CRM Deals.
- **Rule:** `stage_category = closed_won_referred_out_unattached`. Only the Commercial-Cash pipeline has this stage.
- **Counted on:** `Closing_Date`.
- **Reporting role:** Placements are a *win* in Cornerstone's taxonomy but reported as a distinct line item alongside Admits, so leadership can see "treatment captures vs. placements" without losing either side. They roll up into "Total Wins" (= Admits + Placements) when a combined KPI is needed.

---

## 8. Win (rollup)

**Win** = Admit OR Placement. The combined "we helped this caller" KPI.

- `isAdmit(deal) OR isPlacement(deal)`
- Top-line Win = Win AND top-line pipeline (same filter as Admit).

---

## 9. DUI Completion (DUI pipeline only)

A **DUI Completion** is a Deal in the `dui_cash` pipeline closed at any of the three DUI win stages:
`Closed - Screening Only`, `Closed - Both Screening & Classes`, `Closed - Classes Only`.

- **Source:** Zoho CRM Deals.
- **Rule:** `stage_category = closed_won_dui_completion`. (All three raw strings roll up to this single category — the granularity between them is preserved as a separate `dui_completion_type` derived field for DUI-specific reporting; see `OPEN_QUESTION #24`.)
- **Counted on:** `Closing_Date`.
- **Reporting role:** DUI's analog of an Admit. Reported in DUI-specific KPIs; never folded into top-line Admits.

---

## 10. Closed Lost

A **Closed Lost** is a Deal at `stage_category = closed_lost`.

- **Source:** Zoho CRM Deals.
- **Rule:** any `Closed - Lost (X)` raw stage — pipeline-specific suffixes for treatment, DUI, DV.
- **Counted on:** `Closing_Date`.
- **Edge cases:**
  - There is **no** `closed_lost_referred_out` category any more. The previously-assumed "Referred Out is a kind of loss" is wrong in Cornerstone's model — see §7.
  - `Referred Out - Coming Back` is active and not a loss — see §3.

---

## 11. Referral In

A **Referral In** is a Lead that arrived from a referral source.

- **Source:** Zoho Analytics → `Leads (Zoho CRM)` view.
- **Rule** (CONFIRMED.md #27): the Lead is a Referral In if **either**:
  - `source_category = "Business Development"`, OR
  - `BD_Rep` field is set to a specific BD rep name (not null, not `-None-`, not `None`).
- **Counted on:** Lead `Created Time`.

The `BD_Rep` field is a Zoho Lead picklist of BD rep names (Amber, Ashley, Casey, Dane, Emari, Farah, Gene, Jacob, Joey, Josh, Joshua, Kimberly, Mindy, MJ, Nico, Sean, Stephen, Zac). A non-empty BD_Rep means the lead was attributed to that specific rep for inbound credit.

---

## 12. Referral Out

In the original brief, "Referral Out" meant Closed Lost - Referred Out variants. In Cornerstone's actual model, the closest analog is **Placement** (§7). There is no separate Referral Out metric beyond Placement.

- If a separate "referral pipeline" view is wanted (e.g., volume of `Referred Out - Coming Back` deals currently open + cumulative `Closed - Referred Out Unattached` deals), that is a derived report combining §3's `referred_out_coming_back` (active) with §7's `closed_won_referred_out_unattached` (closed). Implementation deferred to Phase 1C.

---

## 13. Level of Care (LOC)

LOC describes the clinical level of care being requested or admitted to. **The source field differs by funnel stage** — this is the most error-prone rule in the entire taxonomy:

| Funnel stage | LOC source field |
|---|---|
| Lead | Zoho Leads → **"Level of Care Requested"** |
| MQL | Zoho Deals → **"Level of Care Requested"** |
| VOB | Zoho Deals → **"Level of Care Requested"** |
| Admit | Zoho Deals → **"Level of Care Admitted"** |
| Placement / Closed Lost | Zoho Deals → **"Level of Care Requested"** |
| DUI Completion | N/A on the Deal side — the DUI - Cash pipeline doesn't carry an Admitted LOC. The Lead's LOC = `DUI` is what routed it into the DUI pipeline. |

**Rule of thumb:** any pre-Admit metric uses *Requested*. The Admit metric — and only the Admit metric — uses *Admitted*. Requested ≠ Admitted is common (a Lead might request Detox and admit to PHP).

### Canonical LOC enum (CONFIRMED.md #11)

The Lead picklist confirmed from Zoho:

| Normalized | Raw Zoho | Group |
|---|---|---|
| `bhrf` | `BHRF` | Treatment |
| `detox` | `Detox` | Treatment |
| `php` | `PHP` | Treatment |
| `iop5` | `IOP5` | Treatment |
| `iop3` | `IOP3` | Treatment |
| `viop_adult` | `VIOP Adult` | Treatment |
| `viop_adolescent` | `VIOP Adolescent` | Treatment |
| `op` | `OP` | Treatment |
| `vop` | `VOP` | Treatment |
| `vop_adult` | `VOP Adult` | Treatment |
| `vop_adolescent` | `VOP Adolescent` | Treatment |
| `dui` | `DUI` | Program (routes to DUI - Cash pipeline) |
| `dv` | `DV` | Program (routes to DV - Cash pipeline) |

Notably absent from the brief's draft: Residential (Cornerstone uses BHRF — Arizona's Behavioral Health Residential Facility designation), Sober Living, and any generic "IOP"/"OP" without frequency/format suffix. The TS constant `TREATMENT_LOC_VALUES` excludes DUI and DV; treatment-funnel classifiers (AHCCCS Lead, Commercial Lead, Other Payer Lead) are gated on a lead's LOC being in this set.

---

## 14. Source Category

Where the Lead came from. Three normalized buckets:

| Normalized name | Rule | Notes |
|---|---|---|
| `business_development` | Raw source category = "Business Development" | BD reps' outreach |
| `zocdoc` | Raw source category = "ZocDoc" | ZocDoc-sourced |
| `digital_marketing` | Raw source category ∉ {Business Development, ZocDoc} | **Catch-all.** Every Lead that is not BD or ZocDoc rolls up to Digital Marketing. |

This means Source Category is computed via the *negative* rule for Digital Marketing — any new raw source string Zoho introduces will automatically fall into Digital Marketing unless explicitly mapped otherwise. This is intentional: we'd rather over-count Digital Marketing than miss a new source bucket. Unmapped raw strings still appear in `v_unmapped_sources` (Phase 1B) for triage.

Raw Zoho field name and exact strings: `OPEN_QUESTION #17`. The Analytics screenshot shows an `Interaction Source` column on the Leads view that's the likely candidate but not yet confirmed.

---

## 15. Sales Cycle (days)

For a Deal where `stage_category = closed_won_admitted`:

```
sales_cycle_days = closing_date − lead.created_at
```

Where `lead.created_at` is the **Zoho Lead's** original `Created Time` (from Zoho Analytics), not the Deal's `Created_Time`.

- **Source for `closing_date`:** Zoho Deals → `Closing_Date`.
- **Source for `lead.created_at`:** Zoho Analytics Leads → `Created Time`, joined via the Deal's `Lead_Id` foreign key.
- **Scope:** top-line Admits only. DV admits and DUI completions are reported with their own cycle metrics, separately. Placements (`closed_won_referred_out_unattached`) get their own cycle metric — see `OPEN_QUESTION #26`.
- **Edge cases:**
  - **Orphan deals** (Deal with no matching Lead row in Analytics): excluded. See `OPEN_QUESTION #21`.
  - Negative values are impossible and indicate a data error — flagged in `v_sync_failures_recent`.

---

## 16. Lead Score Rating (the "star rating")

Cornerstone's Lead "star rating" is a single Zoho picklist field — **`Lead Score Rating`** — whose label encodes the star count as leading ⭐ characters. There is no separate numeric field. Phase 1B's normalization derives `star_rating: 0-5` by counting leading ⭐ characters in the picklist value via `leadScoreRatingToStarCount`.

Confirmed picklist values (CONFIRMED.md #10):

| Stars | Label | Implies |
|---|---|---|
| 0 | `Unable To Score/Never Made Contact` | Not classified |
| 1 | `⭐ Junk/Spam` | Excluded from active funnel |
| 2 | `⭐⭐ HR/Client Care/Family/Care Coordination...` | Not seeking treatment directly |
| 3 | `⭐⭐⭐ Seeking Treatment: Medicaid` | AHCCCS-eligible (star path) |
| 4 | `⭐⭐⭐⭐ Seeking Treatment: Commercial, ...` | Commercial-eligible (star path) |
| 5 | `⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, ...` | Commercial-eligible (star path) |

Full 4- and 5-star label text still truncated in screenshots — see `OPEN_QUESTION #27` to lock the strings.

---

## 17. AHCCCS Lead

A Lead is an **AHCCCS Lead** if **all** of the following hold:

1. The Lead is a Treatment Lead (LOC ∉ {DUI, DV}). See CONFIRMED.md #12.
2. **Insurance-wins precedence** (CONFIRMED.md #24):
   - If `insurance_type` is set → the lead is AHCCCS if and only if `insurance_type = "AHCCCS"`. Star rating is ignored.
   - If `insurance_type` is null → the lead is AHCCCS if `star_rating = 3` (star fallback).

The LOC gate excludes DUI and DV leads even if their insurance happens to be AHCCCS — those leads route to the DUI - Cash and DV - Cash pipelines and are reported as DUI / DV leads, not AHCCCS.

---

## 18. Commercial Lead

A Lead is a **Commercial Lead** if **all** of the following hold:

1. The Lead is a Treatment Lead.
2. **Insurance-wins precedence** (CONFIRMED.md #24):
   - If `insurance_type` is set → the lead is Commercial if and only if `insurance_type ∈ {"Commercial Insurance", "Cash"}`. Star rating is ignored.
   - If `insurance_type` is null → the lead is Commercial if `star_rating ∈ {4, 5}` (star fallback).

"Cash" replaces the original brief's "Private Pay" — Cornerstone's picklist uses Cash. See CONFIRMED.md #8.

- **AHCCCS Lead and Commercial Lead are now mutually exclusive** (insurance is single-valued, and star fallback is partitioned). The old "both apply" overlap rule from rev 1 is retired.

---

## 19. Other Payer Lead

A Lead is an **Other Payer Lead** if **all** of the following hold:

1. The Lead is a Treatment Lead.
2. `insurance_type ∈ {"Medicare", "No Insurance", "Out of State Medicaid"}`.

Per CONFIRMED.md #9, these three insurance types are surfaced as their own reporting bucket — not folded into AHCCCS, not folded into Commercial. Useful for executive reporting on payer mix and for spotting Medicare uptake. Reported alongside AHCCCS Lead and Commercial Lead in the headline payer-split chart.

---

## 20. DUI Lead / DV Lead

A **DUI Lead** is a Lead with `level_of_care_requested = "DUI"`.
A **DV Lead** is a Lead with `level_of_care_requested = "DV"`.

These leads convert into the DUI - Cash and DV - Cash pipelines respectively and are reported as their own dimensions. They do not feed the AHCCCS / Commercial / Other Payer Lead counts.

---

## 21. AHCCCS Admit / Commercial Admit / ZocDoc Admit / DV Admit / DUI Completion

Each is an `isAdmit` (treatment captures) or `isDuiCompletion` deal filtered by pipeline:

| Metric | Predicate |
|---|---|
| AHCCCS Admit | `isAdmit(deal) AND deal.pipeline = ahcccs` |
| Commercial Admit | `isAdmit(deal) AND deal.pipeline = commercial_cash` |
| ZocDoc Admit | `isAdmit(deal) AND deal.pipeline = zocdoc` |
| DV Admit | `isAdmit(deal) AND deal.pipeline = dv_cash` |
| DUI Completion | `isDuiCompletion(deal)` (pipeline already constrained by stage_category) |

`Top-line Admit` = AHCCCS Admit ∪ Commercial Admit ∪ ZocDoc Admit. DV Admits and DUI Completions are reported separately.

---

## 22. Admissions Rep

An **Admissions Rep** is a Zoho User who is currently active AND whose Profile is one of:

- `Treatment Standard`
- `Admin`

(`OPEN_QUESTION #6` — confirm exact Profile names against Zoho CRM Users.)

---

## 23. BD Rep

A **BD Rep** is a Zoho User who is currently active AND whose Profile = `Business Development`.

(`OPEN_QUESTION #6` — confirm exact Profile name.)

---

## 24. Orthogonality matrix

A single Deal can be classified along multiple orthogonal dimensions simultaneously:

| Dimension | Values |
|---|---|
| Pipeline | commercial_cash, ahcccs, zocdoc, dui_cash, dv_cash |
| Source Category | digital_marketing, business_development, zocdoc |
| Stage Category | (the 9 values in §3) |
| LOC | (LOC enum) |
| Rep Role (of owner) | admissions_rep, bd_rep, other |

A Deal with pipeline=`commercial_cash`, source_category=`business_development`, stage_category=`closed_won_admitted` is **all of**: Commercial Admit, BD Admit, top-line Admit, and a Win. These dimensions are filterable independently in the FilterBar.

The AHCCCS Lead / Commercial Lead overlap at the Lead level (§17) is the one place where two classifications on the same dimension can co-apply, because they share underlying fields. At the Deal level there is no overlap — Pipeline is single-valued.

---

## 25. Test data exclusion

Test Leads, test Deals, and internal test users must be excluded from every metric. `OPEN_QUESTION #18`.

---

## 26. Filter contract preview

Every dashboard page in Phase 1C and beyond accepts the same filter set:

- **Time:** Today, Current Week, Previous Week, This Month, This Quarter, Last Month, Last 3 Months, Last 6 Months, Last Year, Custom range. Default for trend charts: this month + the prior two months.
- **Level of Care:** multi-select from the LOC enum.
- **Pipeline:** multi-select. Default: top-line pipelines only (Commercial-Cash, AHCCCS, ZocDoc). User can opt DUI / DV in.
- **Marketing Channel:** multi-select (Digital, BD, ZocDoc) — derived from Source Category.
- **Sales Rep:** multi-select user_identity, role-aware (admissions reps see only themselves via RLS).

The Zod `FilterContractSchema` in `src/lib/metrics/schemas.ts` is the runtime contract.

---

## Document changelog

- **2026-05-27 (rev 1)** — Initial draft. Drafted by Claude for Amber's review.
- **2026-05-27 (rev 2)** — Revised against Zoho CRM Pipelines screenshots + Zoho Analytics Leads view. Pipelines: 4 → 5 (added `dv_cash`; renamed `dui` → `dui_cash`). Stage categories: 6 → 9 (introduced `vob_qualifying`, `vob_approved`, `pre_admit`, `referred_out_coming_back`, `closed_won_admitted`, `closed_won_referred_out_unattached`, `closed_won_dui_completion`; dropped `mql`, `vob_submitted`, `closed_won`, `closed_lost_referred_out`, `closed_lost_other`). VOB redefined as stage-based, not custom-field-based. `Closed - Referred Out Unattached` reclassified as Placement (a Win) rather than Closed Lost. Top-line Admit set defined: {Commercial-Cash, AHCCCS, ZocDoc}. New DUI Completion and Placement primitives. Zoho Analytics workspace + view IDs locked.
- **2026-05-27 (rev 3)** — Revised against Zoho Lead detail screenshots. Insurance Type expanded to the 6-value Cornerstone picklist; "Private Pay" renamed to "Cash". LOC enum rewritten to the 13 Cornerstone-specific values (BHRF instead of Residential; IOP5/IOP3 instead of generic IOP; VIOP/VOP virtual variants; DUI and DV as Lead-level LOC values). New Lead Score Rating field (string picklist) with star-count derivation. New Other Payer Lead primitive for Medicare / No Insurance / Out of State Medicaid. Lead classifiers gated on `isTreatmentLead` so DUI/DV leads do not bleed into AHCCCS/Commercial counts. Source Category confirmed as the canonical attribution field (Generated By / Tracking Source / Source Medium are observable but secondary).
- **2026-05-27 (rev 4)** — Insurance Type stored values ("Private Insurance", "Cash Pay") replace display labels. Profile names corrected ("TREATMENT Standard" caps, "Administrator" not "Admin"); "Call Center AHCCCS" added as a fourth admissions-rep profile.
- **2026-05-27 (rev 5)** — Zoho Deals `getFields` corrections: VOB uses both `VOB_Submitted` boolean AND stage; Admit metric counts on `Admit_Date` strictly; `Admitted_Level_of_Care` exists and is the Admit-side LOC source; `DUI_or_Treatment` field (display "Treatment or Court Services") is the Deal-side pipeline router; stage canonical = display labels (sync translates actual_value → display).
- **2026-05-27 (rev 6)** — Final policy closeout. Insurance-wins precedence on AHCCCS × Commercial overlap (mutually exclusive now). Referral In rule = `source_category=BD OR BD_Rep set`. Top-line MQL matches Admit (Commercial-Cash + AHCCCS + ZocDoc). Orthogonality clarified (distinct counts in totals, orthogonal across per-dimension charts). Orphan deals fall back to Deal `Created_Time`. Placement cycle metric scheduled. DUI rolls up with drill-down. Lead `Created_Time` = intake moment. Insurance_Policy_Type deferred to Phase 2.
