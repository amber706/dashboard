// phase_1b_contracts.test.ts — chunk 4 acceptance tests.
//
// These tests freeze the Phase 1B invariants — mapping completeness, predicate
// composition rules, and the cross-references between the TS predicates and
// the SQL builder in supabase/migrations/151. If any of these fail, the
// `op_*` cache risks drifting from `src/lib/metrics/definitions.ts`.
//
// Tests are split into:
//   1. Mapping completeness  — every enum value has at least one raw mapping
//                              and no raw mapping points to a missing enum.
//   2. Predicate composition — isVobSubmitted/isAdmit/isTopLineAdmit follow
//                              the spec rules (CONFIRMED.md #33, #34).
//   3. Phase 1B contracts    — top-line pipelines, treatment-lead gate,
//                              insurance-wins precedence.

import { describe, it, expect } from "vitest";
import {
  PIPELINE,
  PIPELINE_VALUES,
  STAGE_CATEGORY,
  STAGE_CATEGORY_VALUES,
  STAGE_CATEGORIES_AT_OR_PAST_VOB,
  TOP_LINE_ADMIT_PIPELINES,
  LEVEL_OF_CARE,
  LEVEL_OF_CARE_VALUES,
  TREATMENT_LOC_VALUES,
  RAW_PIPELINE_STRINGS,
  RAW_STAGE_TO_CATEGORY,
  RAW_LOC_STRINGS,
  SOURCE_CATEGORY,
  INSURANCE_TYPE,
  AHCCCS_INSURANCE_TYPES,
  COMMERCIAL_INSURANCE_TYPES,
  OTHER_PAYER_INSURANCE_TYPES,
  AHCCCS_STAR_RATINGS,
  COMMERCIAL_STAR_RATINGS,
  isAdmit,
  isVobSubmitted,
  isTopLineAdmit,
  isAhcccsLead,
  isCommercialLead,
  isOtherPayerLead,
  isTreatmentLead,
  isReferralIn,
  leadScoreRatingToStarCount,
  profileToRepRole,
  type DealShape,
  type LeadShape,
} from "../definitions";

// ── 1. Mapping completeness ───────────────────────────────────────────────

describe("Phase 1B contract — mapping completeness", () => {
  it("every Pipeline enum value has a raw string", () => {
    for (const p of PIPELINE_VALUES) {
      expect(RAW_PIPELINE_STRINGS[p], `missing raw string for pipeline=${p}`).toBeTruthy();
    }
  });

  it("RAW_PIPELINE_STRINGS keys are exactly the Pipeline enum", () => {
    expect(new Set(Object.keys(RAW_PIPELINE_STRINGS)).size).toBe(PIPELINE_VALUES.length);
    for (const k of Object.keys(RAW_PIPELINE_STRINGS)) {
      expect(PIPELINE_VALUES).toContain(k);
    }
  });

  it("every StageCategory has at least one raw mapping", () => {
    const usedCategories = new Set(Object.values(RAW_STAGE_TO_CATEGORY));
    for (const cat of STAGE_CATEGORY_VALUES) {
      expect(usedCategories.has(cat), `no raw stage maps to category=${cat}`).toBe(true);
    }
  });

  it("no raw stage points to a non-existent stage category", () => {
    for (const [raw, cat] of Object.entries(RAW_STAGE_TO_CATEGORY)) {
      expect(STAGE_CATEGORY_VALUES, `raw stage "${raw}" maps to invalid category=${cat}`).toContain(cat);
    }
  });

  it("every LOC enum value has a raw string", () => {
    for (const loc of LEVEL_OF_CARE_VALUES) {
      expect(RAW_LOC_STRINGS[loc], `missing raw string for LOC=${loc}`).toBeTruthy();
    }
  });

  it("AHCCCS/Commercial/OtherPayer insurance types are disjoint", () => {
    const a = new Set(AHCCCS_INSURANCE_TYPES);
    const c = new Set(COMMERCIAL_INSURANCE_TYPES);
    const o = new Set(OTHER_PAYER_INSURANCE_TYPES);
    for (const t of a) expect(c.has(t)).toBe(false);
    for (const t of a) expect(o.has(t)).toBe(false);
    for (const t of c) expect(o.has(t)).toBe(false);
  });

  it("AHCCCS and Commercial star ratings are disjoint", () => {
    const a = new Set(AHCCCS_STAR_RATINGS);
    const c = new Set(COMMERCIAL_STAR_RATINGS);
    for (const s of a) expect(c.has(s)).toBe(false);
  });
});

// ── 2. Predicate composition ──────────────────────────────────────────────

describe("Phase 1B contract — predicate composition", () => {
  const baseDeal: DealShape = {
    pipeline: PIPELINE.CommercialCash,
    stage_category: STAGE_CATEGORY.MqlStuckLead,
    source_category: SOURCE_CATEGORY.DigitalMarketing,
    vob_submitted: false,
    vob_submitted_date: null,
    admit_date: null,
  };

  it("isAdmit fires when admit_date is set (primary signal)", () => {
    expect(isAdmit({ ...baseDeal, admit_date: "2026-05-15" })).toBe(true);
  });

  it("isAdmit fires when stage_category=closed_won_admitted (backup signal)", () => {
    expect(isAdmit({ ...baseDeal, stage_category: STAGE_CATEGORY.ClosedWonAdmitted })).toBe(true);
  });

  it("isAdmit is false when neither signal fires", () => {
    expect(isAdmit(baseDeal)).toBe(false);
  });

  it("isVobSubmitted fires on vob_submitted=true (primary 1)", () => {
    expect(isVobSubmitted({ ...baseDeal, vob_submitted: true })).toBe(true);
  });

  it("isVobSubmitted fires on vob_submitted_date set (primary 2)", () => {
    expect(isVobSubmitted({ ...baseDeal, vob_submitted_date: "2026-05-10" })).toBe(true);
  });

  it("isVobSubmitted fires on stage past VOB (backup)", () => {
    for (const cat of STAGE_CATEGORIES_AT_OR_PAST_VOB) {
      expect(
        isVobSubmitted({ ...baseDeal, stage_category: cat }),
        `should fire for stage_category=${cat}`,
      ).toBe(true);
    }
  });

  it("isVobSubmitted is FALSE for closed_lost with no primary signals", () => {
    expect(isVobSubmitted({ ...baseDeal, stage_category: STAGE_CATEGORY.ClosedLost })).toBe(false);
  });

  it("isVobSubmitted is FALSE for closed_won_dui_completion (DUI has no VOB)", () => {
    expect(
      isVobSubmitted({ ...baseDeal, stage_category: STAGE_CATEGORY.ClosedWonDuiCompletion }),
    ).toBe(false);
  });

  it("isTopLineAdmit excludes DV admits", () => {
    expect(
      isTopLineAdmit({
        ...baseDeal,
        pipeline: PIPELINE.DvCash,
        stage_category: STAGE_CATEGORY.ClosedWonAdmitted,
      }),
    ).toBe(false);
  });

  it("isTopLineAdmit excludes DUI admits", () => {
    expect(
      isTopLineAdmit({
        ...baseDeal,
        pipeline: PIPELINE.DuiCash,
        admit_date: "2026-05-15",
      }),
    ).toBe(false);
  });

  it("TOP_LINE_ADMIT_PIPELINES covers exactly commercial_cash/ahcccs/zocdoc", () => {
    expect(new Set(TOP_LINE_ADMIT_PIPELINES)).toEqual(
      new Set([PIPELINE.CommercialCash, PIPELINE.Ahcccs, PIPELINE.Zocdoc]),
    );
  });
});

// ── 3. Phase 1B contracts (lead-side) ─────────────────────────────────────

describe("Phase 1B contract — lead classifiers", () => {
  const baseLead: LeadShape = {
    star_rating: null,
    insurance_type: null,
    level_of_care_requested: LEVEL_OF_CARE.Iop3,
    source_category: SOURCE_CATEGORY.DigitalMarketing,
    bd_rep_inbound: null,
  };

  it("isTreatmentLead is true for all treatment LOCs", () => {
    for (const loc of TREATMENT_LOC_VALUES) {
      expect(isTreatmentLead({ ...baseLead, level_of_care_requested: loc })).toBe(true);
    }
  });

  it("isTreatmentLead is false for DUI / DV LOC", () => {
    expect(isTreatmentLead({ ...baseLead, level_of_care_requested: LEVEL_OF_CARE.Dui })).toBe(false);
    expect(isTreatmentLead({ ...baseLead, level_of_care_requested: LEVEL_OF_CARE.Dv })).toBe(false);
  });

  it("insurance wins over star rating (AHCCCS lead with 5-star = Commercial)", () => {
    const lead: LeadShape = { ...baseLead, insurance_type: INSURANCE_TYPE.CommercialInsurance, star_rating: 3 };
    expect(isAhcccsLead(lead)).toBe(false);
    expect(isCommercialLead(lead)).toBe(true);
  });

  it("star fallback only fires when insurance is null", () => {
    expect(isAhcccsLead({ ...baseLead, star_rating: 3 })).toBe(true);
    expect(isCommercialLead({ ...baseLead, star_rating: 4 })).toBe(true);
    expect(isCommercialLead({ ...baseLead, star_rating: 5 })).toBe(true);
  });

  it("AHCCCS, Commercial, OtherPayer are mutually exclusive at the lead level", () => {
    const leads: LeadShape[] = [
      { ...baseLead, insurance_type: INSURANCE_TYPE.Ahcccs },
      { ...baseLead, insurance_type: INSURANCE_TYPE.CommercialInsurance },
      { ...baseLead, insurance_type: INSURANCE_TYPE.Medicare },
      { ...baseLead, star_rating: 3 },
      { ...baseLead, star_rating: 5 },
    ];
    for (const l of leads) {
      const a = isAhcccsLead(l);
      const c = isCommercialLead(l);
      const o = isOtherPayerLead(l);
      const trueCount = [a, c, o].filter(Boolean).length;
      expect(trueCount, `multiple classifiers fire for lead=${JSON.stringify(l)}`).toBeLessThanOrEqual(1);
    }
  });

  it("DUI/DV leads never match AHCCCS / Commercial / Other Payer", () => {
    const dui: LeadShape = { ...baseLead, level_of_care_requested: LEVEL_OF_CARE.Dui, insurance_type: INSURANCE_TYPE.Ahcccs };
    expect(isAhcccsLead(dui)).toBe(false);
    expect(isCommercialLead(dui)).toBe(false);
    expect(isOtherPayerLead(dui)).toBe(false);
  });

  it("isReferralIn fires when source_category is BD", () => {
    expect(isReferralIn({ ...baseLead, source_category: SOURCE_CATEGORY.BusinessDevelopment })).toBe(true);
  });

  it("isReferralIn fires when BD_Rep is a real name", () => {
    expect(isReferralIn({ ...baseLead, bd_rep_inbound: "Casey" })).toBe(true);
  });

  it("isReferralIn ignores the -None- sentinel", () => {
    expect(isReferralIn({ ...baseLead, bd_rep_inbound: "-None-" })).toBe(false);
    expect(isReferralIn({ ...baseLead, bd_rep_inbound: "None" })).toBe(false);
    expect(isReferralIn({ ...baseLead, bd_rep_inbound: "" })).toBe(false);
  });
});

// ── 4. Idempotency / pure-function invariants ─────────────────────────────

describe("Phase 1B contract — idempotency", () => {
  it("leadScoreRatingToStarCount is idempotent (string → number)", () => {
    const cases: Array<[string | null, number]> = [
      [null, 0],
      ["Unable To Score/Never Made Contact", 0],
      ["⭐ Junk/Spam", 1],
      ["⭐⭐ HR/Client Care", 2],
      ["⭐⭐⭐ Seeking Treatment: Medicaid", 3],
      ["⭐⭐⭐⭐ Seeking Treatment: Commercial", 4],
      ["⭐⭐⭐⭐⭐ Seeking Treatment: Commercial", 5],
    ];
    for (const [input, expected] of cases) {
      expect(leadScoreRatingToStarCount(input), `input=${JSON.stringify(input)}`).toBe(expected);
    }
  });

  it("profileToRepRole assigns the four known profiles", () => {
    expect(profileToRepRole("TREATMENT Standard")).toBe("admissions_rep");
    expect(profileToRepRole("Administrator")).toBe("admissions_rep");
    expect(profileToRepRole("Call Center AHCCCS")).toBe("admissions_rep");
    expect(profileToRepRole("Business Development")).toBe("bd_rep");
    expect(profileToRepRole("Random Other Profile")).toBe("other");
    expect(profileToRepRole(null)).toBe("other");
    expect(profileToRepRole(undefined)).toBe("other");
  });

  it("predicates are pure (calling twice yields the same result)", () => {
    const lead: LeadShape = {
      star_rating: 4,
      insurance_type: INSURANCE_TYPE.CommercialInsurance,
      level_of_care_requested: LEVEL_OF_CARE.Iop3,
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      bd_rep_inbound: null,
    };
    expect(isCommercialLead(lead)).toBe(isCommercialLead(lead));

    const deal: DealShape = {
      pipeline: PIPELINE.Ahcccs,
      stage_category: STAGE_CATEGORY.ClosedWonAdmitted,
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      vob_submitted: true,
      vob_submitted_date: "2026-05-10",
      admit_date: "2026-05-15",
    };
    expect(isAdmit(deal)).toBe(isAdmit(deal));
    expect(isVobSubmitted(deal)).toBe(isVobSubmitted(deal));
    expect(isTopLineAdmit(deal)).toBe(isTopLineAdmit(deal));
  });
});
