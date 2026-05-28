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

## Document changelog

- **2026-05-27** — Created alongside METRIC_DEFINITIONS.md rev 2. Seven resolutions recorded; the rest of OPEN_QUESTIONS.md remains open.
