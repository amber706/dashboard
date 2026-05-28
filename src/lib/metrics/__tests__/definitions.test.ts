// definitions.test.ts — property tests for every reporting primitive
// classifier in `../definitions.ts`. The three cases called out in the
// Phase 1A spec are explicit (search for "SPEC CASE").
//
// These tests are the canonical regression net for the taxonomy. If they
// drift from `docs/METRIC_DEFINITIONS.md` the doc is the source of truth —
// update the test, not the doc.

import { describe, expect, it } from "vitest";

import {
  AHCCCS_STAR_RATINGS,
  COMMERCIAL_STAR_RATINGS,
  INSURANCE_TYPE,
  LEVEL_OF_CARE_VALUES,
  MARKETING_CHANNEL,
  PIPELINE,
  PIPELINE_VALUES,
  REP_ROLE,
  REP_ROLE_VALUES,
  SOURCE_CATEGORY,
  SOURCE_CATEGORY_VALUES,
  STAGE_CATEGORY,
  STAGE_CATEGORY_VALUES,
  isAdmit,
  isAhcccsAdmit,
  isAhcccsLead,
  isBdAdmit,
  isClosedLost,
  isCommercialAdmit,
  isCommercialLead,
  isMql,
  isRawStageReferredOut,
  isReferredOut,
  isVob,
  profileToRepRole,
  rawSourceToSourceCategory,
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
  ...overrides,
});

const deal = (overrides: Partial<DealShape> = {}): DealShape => ({
  pipeline: PIPELINE.CommercialCash,
  stage_category: STAGE_CATEGORY.InProgress,
  vob_submitted: false,
  source_category: SOURCE_CATEGORY.DigitalMarketing,
  ...overrides,
});

// ── enum cardinality (catches accidental adds/removes) ─────────────────────

describe("enum cardinality", () => {
  it("Pipeline has exactly 4 values", () => {
    expect(PIPELINE_VALUES).toHaveLength(4);
  });

  it("StageCategory has exactly 6 values", () => {
    expect(STAGE_CATEGORY_VALUES).toHaveLength(6);
  });

  it("SourceCategory has exactly 3 values", () => {
    expect(SOURCE_CATEGORY_VALUES).toHaveLength(3);
  });

  it("RepRole has exactly 3 values", () => {
    expect(REP_ROLE_VALUES).toHaveLength(3);
  });

  it("LevelOfCare has 6 draft values (subject to OPEN_QUESTION #11)", () => {
    expect(LEVEL_OF_CARE_VALUES).toHaveLength(6);
  });

  it("Star rating thresholds match METRIC_DEFINITIONS.md", () => {
    expect(AHCCCS_STAR_RATINGS).toEqual([3]);
    expect(COMMERCIAL_STAR_RATINGS).toEqual([4, 5]);
  });
});

// ── Lead classifiers ───────────────────────────────────────────────────────

describe("isAhcccsLead", () => {
  it("classifies star_rating=3 as AHCCCS", () => {
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

  it("does not classify a null lead as AHCCCS", () => {
    expect(isAhcccsLead(lead())).toBe(false);
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

  it("classifies insurance_type=Private Pay as Commercial", () => {
    expect(isCommercialLead(lead({ insurance_type: INSURANCE_TYPE.PrivatePay }))).toBe(true);
  });

  it("does not classify star_rating=3 alone as Commercial", () => {
    expect(isCommercialLead(lead({ star_rating: 3 }))).toBe(false);
  });

  it("does not classify a null lead as Commercial", () => {
    expect(isCommercialLead(lead())).toBe(false);
  });
});

// SPEC CASE #1 — Lead overlap. Documented in METRIC_DEFINITIONS.md §13 and
// OPEN_QUESTION #9. Default = both classifications apply. If Amber chooses
// option A or B in CONFIRMED.md, this test gets rewritten.
describe("SPEC CASE — AHCCCS × Commercial Lead overlap (OPEN_QUESTION #9)", () => {
  const overlap = lead({
    star_rating: 3, // → AHCCCS-eligible by star
    insurance_type: INSURANCE_TYPE.CommercialInsurance, // → Commercial-eligible by insurance
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
  it("returns true for any Deal shape (MQL = exists in sales pipeline)", () => {
    expect(isMql(deal())).toBe(true);
    expect(isMql(deal({ stage_category: STAGE_CATEGORY.ClosedWon }))).toBe(true);
    expect(isMql(deal({ stage_category: STAGE_CATEGORY.ClosedLostOther }))).toBe(true);
  });
});

describe("isVob", () => {
  it("requires vob_submitted=true", () => {
    expect(isVob(deal({ vob_submitted: true }))).toBe(true);
    expect(isVob(deal({ vob_submitted: false }))).toBe(false);
  });
});

describe("isAdmit", () => {
  it("requires stage_category=closed_won", () => {
    expect(isAdmit(deal({ stage_category: STAGE_CATEGORY.ClosedWon }))).toBe(true);
  });

  it("rejects every other stage", () => {
    const nonWon = STAGE_CATEGORY_VALUES.filter((s) => s !== STAGE_CATEGORY.ClosedWon);
    for (const stage of nonWon) {
      expect(isAdmit(deal({ stage_category: stage }))).toBe(false);
    }
  });
});

describe("isClosedLost & isReferredOut", () => {
  it("Closed Lost matches both referred-out and other closed-lost stages", () => {
    expect(isClosedLost(deal({ stage_category: STAGE_CATEGORY.ClosedLostReferredOut }))).toBe(true);
    expect(isClosedLost(deal({ stage_category: STAGE_CATEGORY.ClosedLostOther }))).toBe(true);
  });

  it("Referred Out only matches closed_lost_referred_out", () => {
    expect(isReferredOut(deal({ stage_category: STAGE_CATEGORY.ClosedLostReferredOut }))).toBe(
      true,
    );
    expect(isReferredOut(deal({ stage_category: STAGE_CATEGORY.ClosedLostOther }))).toBe(false);
  });

  it("Closed Won is not Closed Lost", () => {
    expect(isClosedLost(deal({ stage_category: STAGE_CATEGORY.ClosedWon }))).toBe(false);
  });
});

// SPEC CASE #2 — AHCCCS Admit vs Commercial Admit pipeline-mutual-exclusion.
describe("SPEC CASE — AHCCCS Admit excludes Commercial Admit", () => {
  const ahcccsWon = deal({
    pipeline: PIPELINE.Ahcccs,
    stage_category: STAGE_CATEGORY.ClosedWon,
  });

  it("is an Admit", () => {
    expect(isAdmit(ahcccsWon)).toBe(true);
  });

  it("is an AHCCCS Admit", () => {
    expect(isAhcccsAdmit(ahcccsWon)).toBe(true);
  });

  it("is NOT a Commercial Admit", () => {
    expect(isCommercialAdmit(ahcccsWon)).toBe(false);
  });
});

// SPEC CASE #3 — Commercial × BD orthogonality (OPEN_QUESTION #10).
describe("SPEC CASE — Commercial Admit and BD Admit are orthogonal", () => {
  const commercialBdWon = deal({
    pipeline: PIPELINE.CommercialCash,
    stage_category: STAGE_CATEGORY.ClosedWon,
    source_category: SOURCE_CATEGORY.BusinessDevelopment,
  });

  it("counts as a Commercial Admit", () => {
    expect(isCommercialAdmit(commercialBdWon)).toBe(true);
  });

  it("also counts as a BD Admit", () => {
    expect(isBdAdmit(commercialBdWon)).toBe(true);
  });

  it("counts as an Admit", () => {
    expect(isAdmit(commercialBdWon)).toBe(true);
  });
});

// ── Stage / source mapping helpers ─────────────────────────────────────────

describe("isRawStageReferredOut", () => {
  it.each([
    "Closed Lost - Referred Out",
    "Closed Lost - Referred out Unattached",
    "Referred out coming back",
  ])("maps %s to referred-out", (raw) => {
    expect(isRawStageReferredOut(raw)).toBe(true);
  });

  it("rejects near-variants", () => {
    expect(isRawStageReferredOut("Closed Lost — Referred Out")).toBe(false); // em-dash
    expect(isRawStageReferredOut("Referred Out")).toBe(false); // missing prefix
    expect(isRawStageReferredOut("Closed Won")).toBe(false);
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

  it("falls back to Digital Marketing for any other value (catch-all rule)", () => {
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
  it("accepts a well-formed row", () => {
    const ok = LeadRowSchema.safeParse({
      source_lead_id: "zoho-lead-1",
      owner_user_id: "00000000-0000-0000-0000-000000000000",
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      level_of_care_requested: "detox",
      insurance_type: INSURANCE_TYPE.CommercialInsurance,
      star_rating: 4,
      created_at: "2026-05-01T07:00:00Z",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an invalid star rating", () => {
    const bad = LeadRowSchema.safeParse({
      source_lead_id: "x",
      owner_user_id: null,
      source_category: SOURCE_CATEGORY.DigitalMarketing,
      level_of_care_requested: null,
      insurance_type: null,
      star_rating: 6, // out of range
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
      star_rating: 3,
      created_at: "2026-05-01T07:00:00Z",
    });
    expect(bad.success).toBe(false);
  });
});

describe("PrimitiveDefinitionSchema", () => {
  it("parses an Admit definition", () => {
    const parsed = PrimitiveDefinitionSchema.parse({
      primitive: "admit",
      source: "zoho_crm.deals",
      rule: { stage_category: "closed_won" },
      date_field: "closing_date",
    });
    expect(parsed.primitive).toBe("admit");
  });

  it("rejects a Lead definition with the wrong source", () => {
    const r = PrimitiveDefinitionSchema.safeParse({
      primitive: "lead",
      source: "zoho_crm.leads", // wrong — Leads come from Analytics, not CRM
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

  it("accepts a valid custom range", () => {
    const r = FilterContractSchema.safeParse({
      time: { preset: "custom", start: "2026-05-01", end: "2026-05-31" },
      level_of_care: ["php", "iop"],
      pipeline: ["commercial_cash"],
      marketing_channel: ["digital"],
      sales_rep: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(r.success).toBe(true);
  });
});
