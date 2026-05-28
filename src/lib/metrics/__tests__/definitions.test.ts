// definitions.test.ts — property tests for every reporting primitive
// classifier in `../definitions.ts`. Includes the three spec-mandated cases
// (search for "SPEC CASE") and the post-revision predicates added after the
// Zoho ground-truth screenshots resolved the original brief's wrong
// assumptions.
//
// If a test here drifts from `docs/METRIC_DEFINITIONS.md`, the doc is the
// source of truth — update the test, not the doc.

import { describe, expect, it } from "vitest";

import {
  AHCCCS_STAR_RATINGS,
  COMMERCIAL_STAR_RATINGS,
  INSURANCE_TYPE,
  LEVEL_OF_CARE,
  LEVEL_OF_CARE_VALUES,
  MARKETING_CHANNEL,
  OTHER_PAYER_INSURANCE_TYPES,
  PIPELINE,
  PIPELINE_VALUES,
  RAW_PIPELINE_STRINGS,
  REP_ROLE,
  REP_ROLE_VALUES,
  SOURCE_CATEGORY,
  SOURCE_CATEGORY_VALUES,
  STAGE_CATEGORY,
  STAGE_CATEGORY_VALUES,
  STAGE_CATEGORIES_AT_OR_PAST_VOB,
  STAGE_CATEGORIES_CLOSED,
  TOP_LINE_ADMIT_PIPELINES,
  TREATMENT_LOC_VALUES,
  isAdmit,
  isAhcccsAdmit,
  isAhcccsLead,
  isBdAdmit,
  isClosedLost,
  isCommercialAdmit,
  isCommercialLead,
  isDuiCompletion,
  isDuiLead,
  isDvAdmit,
  isDvLead,
  isMql,
  isOtherPayerLead,
  isPlacement,
  isTopLineAdmit,
  isTopLineMql,
  isTopLinePipeline,
  isTopLineVobReached,
  isTreatmentLead,
  isVobReached,
  isWin,
  isZocdocAdmit,
  leadScoreRatingToStarCount,
  profileToRepRole,
  rawPipelineToPipeline,
  rawSourceToSourceCategory,
  rawStageToCategory,
  sourceCategoryToMarketingChannel,
  type DealShape,
  type LeadShape,
} from "../definitions";

import {
  DEFAULT_FILTER,
  FilterContractSchema,
  LeadRowSchema,
  PrimitiveDefinitionSchema,
} from "../schemas";

// ── helpers ────────────────────────────────────────────────────────────────

const lead = (overrides: Partial<LeadShape> = {}): LeadShape => ({
  star_rating: null,
  insurance_type: null,
  level_of_care_requested: null,
  ...overrides,
});

const deal = (overrides: Partial<DealShape> = {}): DealShape => ({
  pipeline: PIPELINE.CommercialCash,
  stage_category: STAGE_CATEGORY.InProgress,
  source_category: SOURCE_CATEGORY.DigitalMarketing,
  ...overrides,
});

// ── enum cardinality (catches accidental adds/removes) ─────────────────────

describe("enum cardinality", () => {
  it("Pipeline has exactly 5 values", () => {
    expect(PIPELINE_VALUES).toHaveLength(5);
  });

  it("StageCategory has exactly 9 values", () => {
    expect(STAGE_CATEGORY_VALUES).toHaveLength(9);
  });

  it("SourceCategory has exactly 3 values", () => {
    expect(SOURCE_CATEGORY_VALUES).toHaveLength(3);
  });

  it("RepRole has exactly 3 values", () => {
    expect(REP_ROLE_VALUES).toHaveLength(3);
  });

  it("LevelOfCare has 13 Cornerstone-specific values (CONFIRMED.md #11)", () => {
    expect(LEVEL_OF_CARE_VALUES).toHaveLength(13);
  });

  it("TREATMENT_LOC_VALUES excludes DUI and DV (the two program LOCs)", () => {
    expect(TREATMENT_LOC_VALUES).toHaveLength(11);
    expect(TREATMENT_LOC_VALUES).not.toContain(LEVEL_OF_CARE.Dui);
    expect(TREATMENT_LOC_VALUES).not.toContain(LEVEL_OF_CARE.Dv);
  });

  it("OTHER_PAYER_INSURANCE_TYPES holds Medicare, No Insurance, Out of State Medicaid", () => {
    expect(OTHER_PAYER_INSURANCE_TYPES).toEqual([
      INSURANCE_TYPE.Medicare,
      INSURANCE_TYPE.NoInsurance,
      INSURANCE_TYPE.OutOfStateMedicaid,
    ]);
  });

  it("TOP_LINE_ADMIT_PIPELINES is exactly {Commercial-Cash, AHCCCS, ZocDoc}", () => {
    expect(TOP_LINE_ADMIT_PIPELINES).toEqual([
      PIPELINE.CommercialCash,
      PIPELINE.Ahcccs,
      PIPELINE.Zocdoc,
    ]);
  });

  it("Star rating thresholds match METRIC_DEFINITIONS.md", () => {
    expect(AHCCCS_STAR_RATINGS).toEqual([3]);
    expect(COMMERCIAL_STAR_RATINGS).toEqual([4, 5]);
  });

  it("STAGE_CATEGORIES_AT_OR_PAST_VOB covers vob + pre-admit + referred-out-coming-back + closed categories (except DUI completion which doesn't have a VOB)", () => {
    expect(STAGE_CATEGORIES_AT_OR_PAST_VOB).toEqual([
      STAGE_CATEGORY.VobQualifying,
      STAGE_CATEGORY.VobApproved,
      STAGE_CATEGORY.PreAdmit,
      STAGE_CATEGORY.ReferredOutComingBack,
      STAGE_CATEGORY.ClosedWonAdmitted,
      STAGE_CATEGORY.ClosedWonReferredOutUnattached,
      STAGE_CATEGORY.ClosedLost,
    ]);
  });

  it("STAGE_CATEGORIES_CLOSED has exactly 4 closed outcomes", () => {
    expect(STAGE_CATEGORIES_CLOSED).toHaveLength(4);
  });
});

// ── Lead Score Rating parsing ──────────────────────────────────────────────

describe("leadScoreRatingToStarCount", () => {
  it.each([
    ["Unable To Score/Never Made Contact", 0],
    ["⭐ Junk/Spam", 1],
    ["⭐⭐ HR/Client Care/Family/Care Coordination", 2],
    ["⭐⭐⭐ Seeking Treatment: Medicaid", 3],
    ["⭐⭐⭐⭐ Seeking Treatment: Commercial, N...", 4],
    ["⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, ...", 5],
  ])("parses %s as %i stars", (rating, expected) => {
    expect(leadScoreRatingToStarCount(rating)).toBe(expected);
  });

  it("returns 0 for null/undefined/empty", () => {
    expect(leadScoreRatingToStarCount(null)).toBe(0);
    expect(leadScoreRatingToStarCount(undefined)).toBe(0);
    expect(leadScoreRatingToStarCount("")).toBe(0);
  });
});

// ── Lead-level LOC classifiers ─────────────────────────────────────────────

describe("isTreatmentLead / isDuiLead / isDvLead", () => {
  it("treats null LOC as treatment lead (default; LOC missing means not flagged as DUI/DV)", () => {
    expect(isTreatmentLead(lead())).toBe(true);
    expect(isDuiLead(lead())).toBe(false);
    expect(isDvLead(lead())).toBe(false);
  });

  it("LOC=DUI → DUI Lead, not treatment", () => {
    const l = lead({ level_of_care_requested: LEVEL_OF_CARE.Dui });
    expect(isDuiLead(l)).toBe(true);
    expect(isTreatmentLead(l)).toBe(false);
    expect(isDvLead(l)).toBe(false);
  });

  it("LOC=DV → DV Lead, not treatment", () => {
    const l = lead({ level_of_care_requested: LEVEL_OF_CARE.Dv });
    expect(isDvLead(l)).toBe(true);
    expect(isTreatmentLead(l)).toBe(false);
    expect(isDuiLead(l)).toBe(false);
  });

  it.each([
    LEVEL_OF_CARE.Bhrf,
    LEVEL_OF_CARE.Detox,
    LEVEL_OF_CARE.Php,
    LEVEL_OF_CARE.Iop5,
    LEVEL_OF_CARE.Iop3,
    LEVEL_OF_CARE.ViopAdult,
    LEVEL_OF_CARE.ViopAdolescent,
    LEVEL_OF_CARE.Op,
    LEVEL_OF_CARE.Vop,
    LEVEL_OF_CARE.VopAdult,
    LEVEL_OF_CARE.VopAdolescent,
  ])("treatment LOC %s → Treatment Lead", (loc) => {
    expect(isTreatmentLead(lead({ level_of_care_requested: loc }))).toBe(true);
  });
});

// ── AHCCCS / Commercial / Other Payer Lead classifiers ─────────────────────

describe("isAhcccsLead", () => {
  it("classifies star_rating=3 as AHCCCS (default treatment lead)", () => {
    expect(isAhcccsLead(lead({ star_rating: 3 }))).toBe(true);
  });

  it("classifies insurance_type=AHCCCS as AHCCCS regardless of star", () => {
    expect(isAhcccsLead(lead({ star_rating: 5, insurance_type: INSURANCE_TYPE.Ahcccs }))).toBe(
      true,
    );
  });

  it("does not classify star_rating=4 alone as AHCCCS", () => {
    expect(isAhcccsLead(lead({ star_rating: 4 }))).toBe(false);
  });

  it("DUI lead with star_rating=3 is NOT AHCCCS (LOC gates out)", () => {
    expect(
      isAhcccsLead(
        lead({ star_rating: 3, level_of_care_requested: LEVEL_OF_CARE.Dui }),
      ),
    ).toBe(false);
  });

  it("DV lead with insurance=AHCCCS is NOT AHCCCS Lead (LOC gates out)", () => {
    expect(
      isAhcccsLead(
        lead({
          insurance_type: INSURANCE_TYPE.Ahcccs,
          level_of_care_requested: LEVEL_OF_CARE.Dv,
        }),
      ),
    ).toBe(false);
  });
});

describe("isCommercialLead", () => {
  it.each([4, 5])("classifies star_rating=%i as Commercial", (stars) => {
    expect(isCommercialLead(lead({ star_rating: stars }))).toBe(true);
  });

  it("classifies insurance_type=Commercial Insurance as Commercial", () => {
    expect(isCommercialLead(lead({ insurance_type: INSURANCE_TYPE.CommercialInsurance }))).toBe(
      true,
    );
  });

  it("classifies insurance_type=Cash as Commercial (Cornerstone uses Cash not Private Pay)", () => {
    expect(isCommercialLead(lead({ insurance_type: INSURANCE_TYPE.Cash }))).toBe(true);
  });

  it("does not classify star_rating=3 alone as Commercial", () => {
    expect(isCommercialLead(lead({ star_rating: 3 }))).toBe(false);
  });

  it("DUI lead with star_rating=5 is NOT Commercial Lead (LOC gates out)", () => {
    expect(
      isCommercialLead(
        lead({ star_rating: 5, level_of_care_requested: LEVEL_OF_CARE.Dui }),
      ),
    ).toBe(false);
  });
});

describe("isOtherPayerLead", () => {
  it.each([INSURANCE_TYPE.Medicare, INSURANCE_TYPE.NoInsurance, INSURANCE_TYPE.OutOfStateMedicaid])(
    "treats insurance=%s as Other Payer",
    (ins) => {
      expect(isOtherPayerLead(lead({ insurance_type: ins }))).toBe(true);
      expect(isAhcccsLead(lead({ insurance_type: ins }))).toBe(false);
      expect(isCommercialLead(lead({ insurance_type: ins }))).toBe(false);
    },
  );

  it("DUI lead with Medicare is NOT Other Payer (LOC gates out)", () => {
    expect(
      isOtherPayerLead(
        lead({
          insurance_type: INSURANCE_TYPE.Medicare,
          level_of_care_requested: LEVEL_OF_CARE.Dui,
        }),
      ),
    ).toBe(false);
  });
});

// SPEC CASE #1 — Lead overlap. METRIC_DEFINITIONS.md §17 + OPEN_QUESTION #9.
// Default = both classifications apply. If Amber resolves OPEN_QUESTION #9 to
// option A or B in CONFIRMED.md, this test gets rewritten.
describe("SPEC CASE — AHCCCS × Commercial Lead overlap (OPEN_QUESTION #9)", () => {
  const overlap = lead({
    star_rating: 3,
    insurance_type: INSURANCE_TYPE.CommercialInsurance,
  });

  it("classifies as AHCCCS Lead", () => {
    expect(isAhcccsLead(overlap)).toBe(true);
  });

  it("also classifies as Commercial Lead (current default — both apply)", () => {
    expect(isCommercialLead(overlap)).toBe(true);
  });
});

// ── Deal classifiers ───────────────────────────────────────────────────────

describe("isMql", () => {
  it("returns true for any Deal shape (MQL = exists in any pipeline)", () => {
    expect(isMql(deal())).toBe(true);
    expect(isMql(deal({ stage_category: STAGE_CATEGORY.ClosedWonAdmitted }))).toBe(true);
    expect(isMql(deal({ stage_category: STAGE_CATEGORY.ClosedLost }))).toBe(true);
  });
});

describe("isTopLineMql", () => {
  it("counts Commercial-Cash / AHCCCS / ZocDoc deals", () => {
    expect(isTopLineMql(deal({ pipeline: PIPELINE.CommercialCash }))).toBe(true);
    expect(isTopLineMql(deal({ pipeline: PIPELINE.Ahcccs }))).toBe(true);
    expect(isTopLineMql(deal({ pipeline: PIPELINE.Zocdoc }))).toBe(true);
  });

  it("excludes DUI and DV deals", () => {
    expect(isTopLineMql(deal({ pipeline: PIPELINE.DuiCash }))).toBe(false);
    expect(isTopLineMql(deal({ pipeline: PIPELINE.DvCash }))).toBe(false);
  });
});

describe("isVobReached", () => {
  it("is true once stage_category reaches vob_qualifying or later", () => {
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.VobQualifying }))).toBe(true);
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.VobApproved }))).toBe(true);
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.PreAdmit }))).toBe(true);
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.ClosedWonAdmitted }))).toBe(true);
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.ClosedLost }))).toBe(true);
    expect(
      isVobReached(deal({ stage_category: STAGE_CATEGORY.ClosedWonReferredOutUnattached })),
    ).toBe(true);
  });

  it("is false for in_progress stages (pre-VOB)", () => {
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.InProgress }))).toBe(false);
  });

  it("is false for DUI completion (DUI has no VOB stage)", () => {
    expect(isVobReached(deal({ stage_category: STAGE_CATEGORY.ClosedWonDuiCompletion }))).toBe(
      false,
    );
  });
});

describe("isAdmit", () => {
  it("requires stage_category = closed_won_admitted", () => {
    expect(isAdmit(deal({ stage_category: STAGE_CATEGORY.ClosedWonAdmitted }))).toBe(true);
  });

  it("rejects every other stage", () => {
    const nonAdmit = STAGE_CATEGORY_VALUES.filter((s) => s !== STAGE_CATEGORY.ClosedWonAdmitted);
    for (const stage of nonAdmit) {
      expect(isAdmit(deal({ stage_category: stage }))).toBe(false);
    }
  });

  it("does NOT require the pipeline to be top-line (DV admits still classify as Admit)", () => {
    expect(
      isAdmit(
        deal({ pipeline: PIPELINE.DvCash, stage_category: STAGE_CATEGORY.ClosedWonAdmitted }),
      ),
    ).toBe(true);
  });
});

describe("isPlacement", () => {
  it("matches closed_won_referred_out_unattached", () => {
    expect(
      isPlacement(deal({ stage_category: STAGE_CATEGORY.ClosedWonReferredOutUnattached })),
    ).toBe(true);
  });

  it("rejects every other stage", () => {
    const nonPlacement = STAGE_CATEGORY_VALUES.filter(
      (s) => s !== STAGE_CATEGORY.ClosedWonReferredOutUnattached,
    );
    for (const stage of nonPlacement) {
      expect(isPlacement(deal({ stage_category: stage }))).toBe(false);
    }
  });
});

describe("isWin", () => {
  it("is true for Admit", () => {
    expect(isWin(deal({ stage_category: STAGE_CATEGORY.ClosedWonAdmitted }))).toBe(true);
  });

  it("is true for Placement", () => {
    expect(isWin(deal({ stage_category: STAGE_CATEGORY.ClosedWonReferredOutUnattached }))).toBe(
      true,
    );
  });

  it("is false for DUI completion (DUI wins are separate from top-line Wins)", () => {
    expect(isWin(deal({ stage_category: STAGE_CATEGORY.ClosedWonDuiCompletion }))).toBe(false);
  });

  it("is false for Closed Lost", () => {
    expect(isWin(deal({ stage_category: STAGE_CATEGORY.ClosedLost }))).toBe(false);
  });
});

describe("isDuiCompletion", () => {
  it("matches closed_won_dui_completion", () => {
    expect(isDuiCompletion(deal({ stage_category: STAGE_CATEGORY.ClosedWonDuiCompletion }))).toBe(
      true,
    );
  });

  it("rejects every other stage", () => {
    const others = STAGE_CATEGORY_VALUES.filter(
      (s) => s !== STAGE_CATEGORY.ClosedWonDuiCompletion,
    );
    for (const stage of others) {
      expect(isDuiCompletion(deal({ stage_category: stage }))).toBe(false);
    }
  });
});

describe("isClosedLost", () => {
  it("matches closed_lost only", () => {
    expect(isClosedLost(deal({ stage_category: STAGE_CATEGORY.ClosedLost }))).toBe(true);
  });

  it("does NOT match referred_out_coming_back (active, not closed) — see CONFIRMED.md #2", () => {
    expect(isClosedLost(deal({ stage_category: STAGE_CATEGORY.ReferredOutComingBack }))).toBe(
      false,
    );
  });

  it("does NOT match placement (a win, not a loss) — see CONFIRMED.md #1", () => {
    expect(
      isClosedLost(deal({ stage_category: STAGE_CATEGORY.ClosedWonReferredOutUnattached })),
    ).toBe(false);
  });
});

// ── Top-line composites ────────────────────────────────────────────────────

describe("isTopLinePipeline", () => {
  it("Commercial-Cash, AHCCCS, ZocDoc are top-line", () => {
    expect(isTopLinePipeline(deal({ pipeline: PIPELINE.CommercialCash }))).toBe(true);
    expect(isTopLinePipeline(deal({ pipeline: PIPELINE.Ahcccs }))).toBe(true);
    expect(isTopLinePipeline(deal({ pipeline: PIPELINE.Zocdoc }))).toBe(true);
  });

  it("DUI and DV are not top-line", () => {
    expect(isTopLinePipeline(deal({ pipeline: PIPELINE.DuiCash }))).toBe(false);
    expect(isTopLinePipeline(deal({ pipeline: PIPELINE.DvCash }))).toBe(false);
  });
});

describe("isTopLineAdmit", () => {
  it("DV admits do NOT count toward top-line (CONFIRMED.md #3)", () => {
    const dvAdmit = deal({
      pipeline: PIPELINE.DvCash,
      stage_category: STAGE_CATEGORY.ClosedWonAdmitted,
    });
    expect(isAdmit(dvAdmit)).toBe(true);
    expect(isTopLineAdmit(dvAdmit)).toBe(false);
  });

  it("Commercial admits count toward top-line", () => {
    expect(
      isTopLineAdmit(
        deal({
          pipeline: PIPELINE.CommercialCash,
          stage_category: STAGE_CATEGORY.ClosedWonAdmitted,
        }),
      ),
    ).toBe(true);
  });
});

describe("isTopLineVobReached", () => {
  it("DV deals at VOB stages do NOT count toward top-line (DV has no VOB anyway)", () => {
    // DV has no VOB stages, so this scenario is theoretical, but the predicate
    // still correctly excludes it on pipeline grounds.
    expect(
      isTopLineVobReached(
        deal({ pipeline: PIPELINE.DvCash, stage_category: STAGE_CATEGORY.VobQualifying }),
      ),
    ).toBe(false);
  });

  it("Commercial deal at VOB - Qualifying counts toward top-line VOB", () => {
    expect(
      isTopLineVobReached(
        deal({
          pipeline: PIPELINE.CommercialCash,
          stage_category: STAGE_CATEGORY.VobQualifying,
        }),
      ),
    ).toBe(true);
  });
});

// SPEC CASE #2 — pipeline mutual-exclusion among Admit subtypes.
describe("SPEC CASE — AHCCCS Admit excludes Commercial / ZocDoc / DV Admit", () => {
  const ahcccsAdmit = deal({
    pipeline: PIPELINE.Ahcccs,
    stage_category: STAGE_CATEGORY.ClosedWonAdmitted,
  });

  it("is an Admit", () => {
    expect(isAdmit(ahcccsAdmit)).toBe(true);
  });

  it("is an AHCCCS Admit", () => {
    expect(isAhcccsAdmit(ahcccsAdmit)).toBe(true);
  });

  it("is NOT a Commercial Admit", () => {
    expect(isCommercialAdmit(ahcccsAdmit)).toBe(false);
  });

  it("is NOT a ZocDoc Admit", () => {
    expect(isZocdocAdmit(ahcccsAdmit)).toBe(false);
  });

  it("is NOT a DV Admit", () => {
    expect(isDvAdmit(ahcccsAdmit)).toBe(false);
  });
});

// SPEC CASE #3 — Pipeline × Source orthogonality (OPEN_QUESTION #10).
describe("SPEC CASE — Commercial Admit and BD Admit are orthogonal", () => {
  const commercialBdAdmit = deal({
    pipeline: PIPELINE.CommercialCash,
    stage_category: STAGE_CATEGORY.ClosedWonAdmitted,
    source_category: SOURCE_CATEGORY.BusinessDevelopment,
  });

  it("counts as a Commercial Admit", () => {
    expect(isCommercialAdmit(commercialBdAdmit)).toBe(true);
  });

  it("also counts as a BD Admit", () => {
    expect(isBdAdmit(commercialBdAdmit)).toBe(true);
  });

  it("counts as an Admit and as a top-line Admit", () => {
    expect(isAdmit(commercialBdAdmit)).toBe(true);
    expect(isTopLineAdmit(commercialBdAdmit)).toBe(true);
  });

  it("is a Win", () => {
    expect(isWin(commercialBdAdmit)).toBe(true);
  });
});

// ── Raw → normalized mapping helpers ───────────────────────────────────────

describe("rawStageToCategory", () => {
  it("maps the five Closed - Admitted variant pipelines to closed_won_admitted", () => {
    expect(rawStageToCategory("Closed - Admitted")).toBe(STAGE_CATEGORY.ClosedWonAdmitted);
  });

  it("maps Closed - Referred Out Unattached to closed_won_referred_out_unattached", () => {
    expect(rawStageToCategory("Closed - Referred Out Unattached")).toBe(
      STAGE_CATEGORY.ClosedWonReferredOutUnattached,
    );
  });

  it("maps all three DUI win stages to closed_won_dui_completion", () => {
    expect(rawStageToCategory("Closed - Screening Only")).toBe(
      STAGE_CATEGORY.ClosedWonDuiCompletion,
    );
    expect(rawStageToCategory("Closed - Both Screening & Classes")).toBe(
      STAGE_CATEGORY.ClosedWonDuiCompletion,
    );
    expect(rawStageToCategory("Closed - Classes Only")).toBe(
      STAGE_CATEGORY.ClosedWonDuiCompletion,
    );
  });

  it("maps all three Closed - Lost variants to closed_lost", () => {
    expect(rawStageToCategory("Closed - Lost (Treatment)")).toBe(STAGE_CATEGORY.ClosedLost);
    expect(rawStageToCategory("Closed - Lost (DUI)")).toBe(STAGE_CATEGORY.ClosedLost);
    expect(rawStageToCategory("Closed - Lost (DV)")).toBe(STAGE_CATEGORY.ClosedLost);
  });

  it("maps Referred Out - Coming Back to the active soft-out category", () => {
    expect(rawStageToCategory("Referred Out - Coming Back")).toBe(
      STAGE_CATEGORY.ReferredOutComingBack,
    );
  });

  it("maps Stuck Lead variants to in_progress", () => {
    expect(rawStageToCategory("Stuck Lead - Commercial/Cash")).toBe(STAGE_CATEGORY.InProgress);
    expect(rawStageToCategory("Stuck Lead - Ahcccs")).toBe(STAGE_CATEGORY.InProgress);
    expect(rawStageToCategory("Stuck Lead - DUI (Cash)")).toBe(STAGE_CATEGORY.InProgress);
    expect(rawStageToCategory("Stuck Lead - DV (Cash)")).toBe(STAGE_CATEGORY.InProgress);
    expect(rawStageToCategory("Stuck Lead - ZocDoc")).toBe(STAGE_CATEGORY.InProgress);
  });

  it("maps VOB stages correctly", () => {
    expect(rawStageToCategory("VOB - Qualifying")).toBe(STAGE_CATEGORY.VobQualifying);
    expect(rawStageToCategory("VOB - Approved")).toBe(STAGE_CATEGORY.VobApproved);
  });

  it("returns null for unmapped strings (Phase 1B surfaces these via v_unmapped_stages)", () => {
    expect(rawStageToCategory("Made-Up Stage Name")).toBeNull();
    expect(rawStageToCategory("")).toBeNull();
    expect(rawStageToCategory(null)).toBeNull();
    expect(rawStageToCategory(undefined)).toBeNull();
  });

  it("rejects near-variants (case + punctuation matter)", () => {
    expect(rawStageToCategory("closed - admitted")).toBeNull();
    expect(rawStageToCategory("Closed-Admitted")).toBeNull();
  });
});

describe("rawPipelineToPipeline", () => {
  it("maps the five exact Zoho pipeline strings", () => {
    expect(rawPipelineToPipeline(RAW_PIPELINE_STRINGS[PIPELINE.CommercialCash])).toBe(
      PIPELINE.CommercialCash,
    );
    expect(rawPipelineToPipeline(RAW_PIPELINE_STRINGS[PIPELINE.Ahcccs])).toBe(PIPELINE.Ahcccs);
    expect(rawPipelineToPipeline(RAW_PIPELINE_STRINGS[PIPELINE.Zocdoc])).toBe(PIPELINE.Zocdoc);
    expect(rawPipelineToPipeline(RAW_PIPELINE_STRINGS[PIPELINE.DuiCash])).toBe(PIPELINE.DuiCash);
    expect(rawPipelineToPipeline(RAW_PIPELINE_STRINGS[PIPELINE.DvCash])).toBe(PIPELINE.DvCash);
  });

  it("returns null for unknown pipelines", () => {
    expect(rawPipelineToPipeline("Commercial/Cash")).toBeNull(); // old brief's wrong name
    expect(rawPipelineToPipeline("DUI")).toBeNull(); // missing - Cash suffix
    expect(rawPipelineToPipeline(null)).toBeNull();
  });
});

describe("rawSourceToSourceCategory", () => {
  it("maps Business Development", () => {
    expect(rawSourceToSourceCategory("Business Development")).toBe(
      SOURCE_CATEGORY.BusinessDevelopment,
    );
  });

  it("maps ZocDoc", () => {
    expect(rawSourceToSourceCategory("ZocDoc")).toBe(SOURCE_CATEGORY.Zocdoc);
  });

  it("falls back to Digital Marketing for any other value", () => {
    expect(rawSourceToSourceCategory("Google Ads")).toBe(SOURCE_CATEGORY.DigitalMarketing);
    expect(rawSourceToSourceCategory("")).toBe(SOURCE_CATEGORY.DigitalMarketing);
    expect(rawSourceToSourceCategory(null)).toBe(SOURCE_CATEGORY.DigitalMarketing);
    expect(rawSourceToSourceCategory(undefined)).toBe(SOURCE_CATEGORY.DigitalMarketing);
  });
});

describe("sourceCategoryToMarketingChannel", () => {
  it("Digital Marketing → digital", () => {
    expect(sourceCategoryToMarketingChannel(SOURCE_CATEGORY.DigitalMarketing)).toBe(
      MARKETING_CHANNEL.Digital,
    );
  });

  it("Business Development → business_development", () => {
    expect(sourceCategoryToMarketingChannel(SOURCE_CATEGORY.BusinessDevelopment)).toBe(
      MARKETING_CHANNEL.BusinessDevelopment,
    );
  });

  it("ZocDoc → zocdoc", () => {
    expect(sourceCategoryToMarketingChannel(SOURCE_CATEGORY.Zocdoc)).toBe(MARKETING_CHANNEL.Zocdoc);
  });
});

// ── Rep role mapping ───────────────────────────────────────────────────────

describe("profileToRepRole", () => {
  it("Treatment Standard → admissions_rep", () => {
    expect(profileToRepRole("Treatment Standard")).toBe(REP_ROLE.AdmissionsRep);
  });

  it("Admin → admissions_rep", () => {
    expect(profileToRepRole("Admin")).toBe(REP_ROLE.AdmissionsRep);
  });

  it("Business Development → bd_rep", () => {
    expect(profileToRepRole("Business Development")).toBe(REP_ROLE.BdRep);
  });

  it("Unknown profile → other", () => {
    expect(profileToRepRole("Marketing")).toBe(REP_ROLE.Other);
    expect(profileToRepRole(null)).toBe(REP_ROLE.Other);
    expect(profileToRepRole(undefined)).toBe(REP_ROLE.Other);
  });
});

// ── Zod schema sanity ──────────────────────────────────────────────────────

describe("LeadRowSchema", () => {
  it("accepts a well-formed row with the new lead_score_rating field", () => {
    const ok = LeadRowSchema.safeParse({
      source_lead_id: "zoho-lead-1",
      owner_user_id: "00000000-0000-0000-0000-000000000000",
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      level_of_care_requested: "iop3",
      insurance_type: INSURANCE_TYPE.CommercialInsurance,
      lead_score_rating: "⭐⭐⭐⭐ Seeking Treatment: Commercial, N",
      star_rating: 4,
      created_at: "2026-05-01T07:00:00Z",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts star_rating=0 (the new minimum, representing 'Unable To Score')", () => {
    const ok = LeadRowSchema.safeParse({
      source_lead_id: "zoho-lead-2",
      owner_user_id: null,
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      level_of_care_requested: null,
      insurance_type: null,
      lead_score_rating: "Unable To Score/Never Made Contact",
      star_rating: 0,
      created_at: "2026-05-01T07:00:00Z",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an invalid star rating (>5)", () => {
    const bad = LeadRowSchema.safeParse({
      source_lead_id: "x",
      owner_user_id: null,
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      level_of_care_requested: null,
      insurance_type: null,
      lead_score_rating: null,
      star_rating: 6,
      created_at: "2026-05-01T07:00:00Z",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects an invalid level_of_care", () => {
    const bad = LeadRowSchema.safeParse({
      source_lead_id: "x",
      owner_user_id: null,
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      level_of_care_requested: "bogus",
      insurance_type: null,
      lead_score_rating: null,
      star_rating: 3,
      created_at: "2026-05-01T07:00:00Z",
    });
    expect(bad.success).toBe(false);
  });

  it("accepts every Cornerstone insurance type", () => {
    for (const ins of [
      INSURANCE_TYPE.Ahcccs,
      INSURANCE_TYPE.CommercialInsurance,
      INSURANCE_TYPE.Cash,
      INSURANCE_TYPE.Medicare,
      INSURANCE_TYPE.NoInsurance,
      INSURANCE_TYPE.OutOfStateMedicaid,
    ]) {
      const ok = LeadRowSchema.safeParse({
        source_lead_id: "x",
        owner_user_id: null,
        source_category: SOURCE_CATEGORY.DigitalMarketing,
        level_of_care_requested: null,
        insurance_type: ins,
        lead_score_rating: null,
        star_rating: null,
        created_at: "2026-05-01T07:00:00Z",
      });
      expect(ok.success).toBe(true);
    }
  });
});

describe("PrimitiveDefinitionSchema", () => {
  it("parses an Admit definition (stage_category = closed_won_admitted)", () => {
    const parsed = PrimitiveDefinitionSchema.parse({
      primitive: "admit",
      source: "zoho_crm.deals",
      rule: { stage_category: STAGE_CATEGORY.ClosedWonAdmitted },
      date_field: "closing_date",
    });
    expect(parsed.primitive).toBe("admit");
  });

  it("parses a Placement definition", () => {
    const parsed = PrimitiveDefinitionSchema.parse({
      primitive: "placement",
      source: "zoho_crm.deals",
      rule: { stage_category: STAGE_CATEGORY.ClosedWonReferredOutUnattached },
      date_field: "closing_date",
    });
    expect(parsed.primitive).toBe("placement");
  });

  it("parses a DUI Completion definition", () => {
    const parsed = PrimitiveDefinitionSchema.parse({
      primitive: "dui_completion",
      source: "zoho_crm.deals",
      rule: { stage_category: STAGE_CATEGORY.ClosedWonDuiCompletion },
      date_field: "closing_date",
    });
    expect(parsed.primitive).toBe("dui_completion");
  });

  it("rejects a Lead definition with the wrong source", () => {
    const r = PrimitiveDefinitionSchema.safeParse({
      primitive: "lead",
      source: "zoho_crm.leads",
      date_field: "created_at",
    });
    expect(r.success).toBe(false);
  });
});

describe("FilterContractSchema", () => {
  it("validates the DEFAULT_FILTER", () => {
    const r = FilterContractSchema.safeParse(DEFAULT_FILTER);
    expect(r.success).toBe(true);
  });

  it("rejects a custom range with start after end", () => {
    const r = FilterContractSchema.safeParse({
      time: { preset: "custom", start: "2026-06-01", end: "2026-05-01" },
      level_of_care: [],
      pipeline: [],
      marketing_channel: [],
      sales_rep: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid custom range with all 5 pipelines", () => {
    const r = FilterContractSchema.safeParse({
      time: { preset: "custom", start: "2026-05-01", end: "2026-05-31" },
      level_of_care: ["php", "iop3", "iop5", "viop_adult"],
      pipeline: ["commercial_cash", "ahcccs", "zocdoc", "dui_cash", "dv_cash"],
      marketing_channel: ["digital"],
      sales_rep: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(r.success).toBe(true);
  });
});
