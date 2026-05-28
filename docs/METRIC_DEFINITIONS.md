# Metric Definitions

**Status:** Phase 1A draft, revision 2 — pending Amber sign-off in `CONFIRMED.md`.
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

A **VOB** is a Deal that has reached the `VOB - Qualifying` stage or any later stage.

- **Source:** Zoho CRM Deals — stage history, not a custom field.
- **Rule:** `stage_category` is one of `vob_qualifying`, `vob_approved`, `pre_admit`, `referred_out_coming_back`, `closed_won_admitted`, `closed_won_referred_out_unattached`, `closed_lost` — i.e., the deal has at any point been at or past VOB.
- **Top-line VOB** = VOB **AND** top-line pipeline. (DUI and DV pipelines don't have VOB stages at all, so this filter is effectively automatic, but the predicate is the same.)
- **Counted on:** the date the deal first reached `vob_qualifying`. This requires stage transition history — see `OPEN_QUESTION #23`.
- **Why this changed from the original brief:** the brief assumed a custom `VOB Submitted` boolean field. In reality, VOB is a stage-driven concept in Cornerstone's Zoho: when a specialist advances a deal into `VOB - Qualifying`, that is the moment a VOB has been submitted. No separate field exists.
- **Edge cases:**
  - A Deal currently at `closed_lost` whose stage history includes `vob_qualifying` is still a VOB (it had one before it lost).
  - Without stage history, the only safe proxy is "current stage is at or past VOB" — but a deal that VOBed and then was reset to Stuck Lead would be missed. Phase 1B's sync must capture stage transitions, not just current stage. See `OPEN_QUESTION #23`.

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
- **Rule:** depends on the source-category field on the lead. The exact source-category column and the picklist of referral-source values are not yet pinned — see `OPEN_QUESTION #15` and `OPEN_QUESTION #17`.
- **Counted on:** Lead `Created Time`.

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
| DUI Completion | N/A — DUI doesn't use LOC; see `OPEN_QUESTION #25` for whether DUI has its own dimension |

**Rule of thumb:** any pre-Admit metric uses *Requested*. The Admit metric — and only the Admit metric — uses *Admitted*. Requested ≠ Admitted is common (a Lead might request Detox and admit to PHP).

LOC enum values are normalized via the Phase 1B `loc_mapping` table. The canonical normalized set is still in `OPEN_QUESTION #11`. Likely candidates based on ASAM levels of care: Detox, Residential, PHP, IOP, OP, Sober Living. Spelling variants in raw Zoho data (e.g., "Detox"/"Detoxification", "IOP"/"Intensive Outpatient") map to a single normalized value.

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

## 16. AHCCCS Lead

A Lead is an **AHCCCS Lead** if it satisfies **either**:
- `Lead.Star_Rating = 3`, OR
- `Lead.Insurance_Type = "AHCCCS"`.

Star rating field name and insurance type enum values: `OPEN_QUESTION #5`, `OPEN_QUESTION #4`.

---

## 17. Commercial Lead

A Lead is a **Commercial Lead** if it satisfies **either**:
- `Lead.Star_Rating ∈ {4, 5}`, OR
- `Lead.Insurance_Type ∈ {"Commercial Insurance", "Private Pay"}`.

- **Overlap with AHCCCS Lead** is possible. See `OPEN_QUESTION #9`.

---

## 18. AHCCCS Admit / Commercial Admit / ZocDoc Admit / DV Admit / DUI Completion

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

## 19. Admissions Rep

An **Admissions Rep** is a Zoho User who is currently active AND whose Profile is one of:

- `Treatment Standard`
- `Admin`

(`OPEN_QUESTION #6` — confirm exact Profile names against Zoho CRM Users.)

---

## 20. BD Rep

A **BD Rep** is a Zoho User who is currently active AND whose Profile = `Business Development`.

(`OPEN_QUESTION #6` — confirm exact Profile name.)

---

## 21. Orthogonality matrix

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

## 22. Test data exclusion

Test Leads, test Deals, and internal test users must be excluded from every metric. `OPEN_QUESTION #18`.

---

## 23. Filter contract preview

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
