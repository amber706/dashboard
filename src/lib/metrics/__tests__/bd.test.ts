/**
 * bd.test.ts — Phase 4 BD resolver math tests.
 *
 * Verifies each bd.* resolver computes the right number/shape from a fake RPC
 * response. Companion: bd-args.test.ts (RPC + arg dispatch).
 *
 * Taxonomy values in fixtures come from definitions.ts (the CI literal guard
 * scans this file — never inline normalized enum strings).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetRegistry,
  getMetric,
  priorRange,
  registerMetrics,
  type BreakdownResult,
  type ScalarResult,
} from "../resolver";
import { BD_METRICS } from "../keys/bd";
import { PIPELINE, REP_ROLE, SOURCE_CATEGORY } from "../definitions";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
const mockRpc = vi.mocked(supabase.rpc);
const rpcReturns = (data: unknown) =>
  mockRpc.mockResolvedValueOnce({ data, error: null } as never);

const RANGE: DateRange = { from: "2026-05-01", to: "2026-05-31" };
const NO_FILTERS: FilterContract = { pipelines: [], sources: [], locs: [], reps: [] };
const resolve = (key: string, filters: FilterContract = NO_FILTERS) =>
  getMetric(key).resolve(RANGE, filters);

// Derive the BD display label the same way the resolver does (runtime
// humanization) so we don't inline the raw taxonomy string (CI literal guard).
const HUMAN_BD = SOURCE_CATEGORY.BusinessDevelopment
  .split("_")
  .map((w) => w[0].toUpperCase() + w.slice(1))
  .join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  _resetRegistry();
  registerMetrics(BD_METRICS);
});
afterEach(() => _resetRegistry());

// ── Referral inflow ─────────────────────────────────────────────────────────

describe("bd.referrals_in_total", () => {
  it("sums bd_referrals_in with a series and a MoM prior value", async () => {
    rpcReturns([
      { date: "2026-05-01", bd_referrals_in: 5, digital_referrals_in: 2, other_referrals_in: 1, referred_out_closed_count: 3 },
      { date: "2026-05-02", bd_referrals_in: 4, digital_referrals_in: 0, other_referrals_in: 0, referred_out_closed_count: 1 },
    ]);
    rpcReturns([
      { date: "2026-03-31", bd_referrals_in: 6, digital_referrals_in: 1, other_referrals_in: 0, referred_out_closed_count: 2 },
    ]);
    const res = (await resolve("bd.referrals_in_total")) as ScalarResult;
    expect(res.value).toBe(9);
    expect(res.prior_period_value).toBe(6);
    expect(res.series).toEqual([
      { date: "2026-05-01", value: 5 },
      { date: "2026-05-02", value: 4 },
    ]);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe("bd.referrals_in_by_channel", () => {
  it("splits inflow across BD / Digital / Other, sorted desc", async () => {
    rpcReturns([
      { date: "2026-05-01", bd_referrals_in: 5, digital_referrals_in: 8, other_referrals_in: 1, referred_out_closed_count: 0 },
    ]);
    const res = (await resolve("bd.referrals_in_by_channel")) as BreakdownResult;
    expect(res.rows.map((r) => r.value)).toEqual([8, 5, 1]); // digital, bd, other
    expect(res.rows[1].label).toBe(HUMAN_BD);
    expect(res.total).toBe(14);
  });
});

describe("bd.referred_out_total", () => {
  it("sums referred_out_closed_count with MoM", async () => {
    rpcReturns([{ date: "2026-05-01", bd_referrals_in: 0, digital_referrals_in: 0, other_referrals_in: 0, referred_out_closed_count: 7 }]);
    rpcReturns([{ date: "2026-03-31", bd_referrals_in: 0, digital_referrals_in: 0, other_referrals_in: 0, referred_out_closed_count: 4 }]);
    const res = (await resolve("bd.referred_out_total")) as ScalarResult;
    expect(res.value).toBe(7);
    expect(res.prior_period_value).toBe(4);
  });
});

describe("bd.referred_out_destinations", () => {
  it("aggregates (refer_out_type, pipeline) rows up to refer_out_type", async () => {
    rpcReturns([
      { refer_out_type: "Residential Unattached", pipeline: PIPELINE.CommercialCash, count: 4 },
      { refer_out_type: "Residential Unattached", pipeline: PIPELINE.Ahcccs, count: 2 },
      { refer_out_type: "Psych Unattached", pipeline: PIPELINE.Ahcccs, count: 3 },
    ]);
    const res = (await resolve("bd.referred_out_destinations")) as BreakdownResult;
    expect(res.rows.find((r) => r.label === "Residential Unattached")?.value).toBe(6);
    expect(res.total).toBe(9);
  });
});

// ── BD-sourced funnel ─────────────────────────────────────────────────────────

describe("bd.admits_from_bd", () => {
  it("sums admits_count from the BD-source rows, with MoM", async () => {
    rpcReturns([{ source_category: SOURCE_CATEGORY.BusinessDevelopment, leads_count: 0, mqls_count: 40, vobs_count: 20, admits_count: 9, closed_lost_count: 0, referred_out_count: 0 }]);
    rpcReturns([{ source_category: SOURCE_CATEGORY.BusinessDevelopment, leads_count: 0, mqls_count: 30, vobs_count: 15, admits_count: 6, closed_lost_count: 0, referred_out_count: 0 }]);
    const res = (await resolve("bd.admits_from_bd")) as ScalarResult;
    expect(res.value).toBe(9);
    expect(res.prior_period_value).toBe(6);
  });
});

describe("bd.bd_mql_to_admit_rate", () => {
  it("computes admits/mqls for BD source, null on zero denom", async () => {
    rpcReturns([{ source_category: SOURCE_CATEGORY.BusinessDevelopment, leads_count: 0, mqls_count: 50, vobs_count: 0, admits_count: 10, closed_lost_count: 0, referred_out_count: 0 }]);
    rpcReturns([{ source_category: SOURCE_CATEGORY.BusinessDevelopment, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 0, closed_lost_count: 0, referred_out_count: 0 }]);
    const res = (await resolve("bd.bd_mql_to_admit_rate")) as ScalarResult;
    expect(res.value).toBeCloseTo(0.2); // 10/50
    expect(res.prior_period_value).toBeNull(); // 0 denom
  });
});

describe("bd.admits_by_source", () => {
  it("returns all source categories with humanized labels, sorted desc", async () => {
    rpcReturns([
      { source_category: SOURCE_CATEGORY.DigitalMarketing, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 12, closed_lost_count: 0, referred_out_count: 0 },
      { source_category: SOURCE_CATEGORY.BusinessDevelopment, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 7, closed_lost_count: 0, referred_out_count: 0 },
    ]);
    const res = (await resolve("bd.admits_by_source")) as BreakdownResult;
    expect(res.rows[0].label).toBe("Digital Marketing");
    expect(res.rows[1].label).toBe(HUMAN_BD);
    expect(res.total).toBe(19);
  });
});

// ── BD rep activity / meetings ────────────────────────────────────────────────

const BD_REP = { owner_user_id: "u1", full_name: "Bea Dee", role_derived: REP_ROLE.BdRep };
const ADM_REP = { owner_user_id: "u2", full_name: "Ada Miss", role_derived: REP_ROLE.AdmissionsRep };
const zero = { inbound_calls: 0, outbound_calls: 0, missed_calls: 0, meetings_count: 0, meetings_by_type: null };

describe("bd.meetings_total", () => {
  it("sums meetings only for BD reps (excludes admissions reps), with MoM", async () => {
    rpcReturns([
      { ...BD_REP, ...zero, meetings_count: 5, meetings_by_type: { Tour: 3, Event: 2 } },
      { ...ADM_REP, ...zero, meetings_count: 99 }, // must be excluded
    ]);
    rpcReturns([{ ...BD_REP, ...zero, meetings_count: 3 }]);
    const res = (await resolve("bd.meetings_total")) as ScalarResult;
    expect(res.value).toBe(5); // admissions rep's 99 excluded
    expect(res.prior_period_value).toBe(3);
  });
});

describe("bd.meetings_by_type", () => {
  it("aggregates the per-rep meetings_by_type JSONB across BD reps", async () => {
    rpcReturns([
      { ...BD_REP, ...zero, meetings_by_type: { Tour: 3, Event: 2 } },
      { owner_user_id: "u3", full_name: "Bob Dev", role_derived: REP_ROLE.BdRep, ...zero, meetings_by_type: { Tour: 1, Drop: 4 } },
      { ...ADM_REP, ...zero, meetings_by_type: { Tour: 50 } }, // excluded
    ]);
    const res = (await resolve("bd.meetings_by_type")) as BreakdownResult;
    const tour = res.rows.find((r) => r.label === "Tour");
    expect(tour?.value).toBe(4); // 3 + 1 (admissions 50 excluded)
    expect(res.total).toBe(10); // Tour 4 + Event 2 + Drop 4
  });
});

describe("bd.meetings_by_rep", () => {
  it("breaks meetings down per BD rep", async () => {
    rpcReturns([
      { ...BD_REP, ...zero, meetings_count: 5 },
      { ...ADM_REP, ...zero, meetings_count: 99 }, // excluded
    ]);
    const res = (await resolve("bd.meetings_by_rep")) as BreakdownResult;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].label).toBe("Bea Dee");
    expect(res.rows[0].value).toBe(5);
  });
});
