/**
 * executive.test.ts — Phase 3 resolver math tests.
 *
 * Verifies each executive.* resolver computes the right number / shape given
 * a fake RPC response. The companion file executive-args.test.ts verifies the
 * other half: that the right RPC + args are sent.
 *
 * Two Phase-3-specific behaviours get focused coverage here:
 *   - month-over-month: top-line scalars populate prior_period_value from a
 *     SECOND RPC call over priorRange(range).
 *   - conversion funnel: rows are emitted in funnel order (Leads → Admit),
 *     NOT sorted by value, so BarChart renders left-to-right as the funnel.
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
import { EXECUTIVE_METRICS } from "../keys/executive";
import { PIPELINE, RAW_PIPELINE_STRINGS, SOURCE_CATEGORY } from "../definitions";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

const mockRpc = vi.mocked(supabase.rpc);

function rpcReturns(data: unknown) {
  mockRpc.mockResolvedValueOnce({ data, error: null } as never);
}
function rpcErrors(message: string) {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message } } as never);
}

const RANGE: DateRange = { from: "2026-05-01", to: "2026-05-31" };
const NO_FILTERS: FilterContract = { pipelines: [], sources: [], locs: [], reps: [] };

const resolve = (key: string, filters: FilterContract = NO_FILTERS) =>
  getMetric(key).resolve(RANGE, filters);

beforeEach(() => {
  vi.clearAllMocks();
  _resetRegistry();
  registerMetrics(EXECUTIVE_METRICS);
});
afterEach(() => _resetRegistry());

// ── priorRange helper ──────────────────────────────────────────────────────

describe("priorRange", () => {
  it("returns the equal-length window immediately preceding `from`", () => {
    // May 2026 is 31 days; the prior 31-day window ends Apr 30, starts Mar 31.
    expect(priorRange({ from: "2026-05-01", to: "2026-05-31" })).toEqual({
      from: "2026-03-31",
      to: "2026-04-30",
    });
  });

  it("handles a single-day window", () => {
    expect(priorRange({ from: "2026-05-10", to: "2026-05-10" })).toEqual({
      from: "2026-05-09",
      to: "2026-05-09",
    });
  });
});

// ── Top-line scalars with month-over-month deltas ───────────────────────────

describe("top-line scalar resolvers (MoM)", () => {
  it("admits_total sums admits, builds a series, and sets prior_period_value from the prior window", async () => {
    // First RPC call = current window; second = prior window.
    rpcReturns([
      { date: "2026-05-01", leads_count: 10, mqls_count: 6, vobs_count: 4, admits_count: 2, closed_lost_count: 1 },
      { date: "2026-05-02", leads_count: 8, mqls_count: 5, vobs_count: 3, admits_count: 3, closed_lost_count: 0 },
    ]);
    rpcReturns([
      { date: "2026-03-31", leads_count: 5, mqls_count: 3, vobs_count: 2, admits_count: 1, closed_lost_count: 0 },
    ]);

    const res = (await resolve("executive.admits_total")) as ScalarResult;
    expect(res.kind).toBe("scalar");
    expect(res.value).toBe(5); // 2 + 3
    expect(res.prior_period_value).toBe(1);
    expect(res.series).toEqual([
      { date: "2026-05-01", value: 2 },
      { date: "2026-05-02", value: 3 },
    ]);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it("mqls_total reads the mqls column for both windows", async () => {
    rpcReturns([{ date: "2026-05-01", leads_count: 10, mqls_count: 6, vobs_count: 4, admits_count: 2, closed_lost_count: 1 }]);
    rpcReturns([{ date: "2026-03-31", leads_count: 9, mqls_count: 7, vobs_count: 1, admits_count: 0, closed_lost_count: 0 }]);
    const res = (await resolve("executive.mqls_total")) as ScalarResult;
    expect(res.value).toBe(6);
    expect(res.prior_period_value).toBe(7);
  });
});

// ── Conversion ratio ─────────────────────────────────────────────────────────

describe("executive.mql_to_admit_rate", () => {
  it("computes admits/mqls for both windows", async () => {
    rpcReturns([{ date: "2026-05-01", leads_count: 20, mqls_count: 10, vobs_count: 6, admits_count: 4, closed_lost_count: 2 }]);
    rpcReturns([{ date: "2026-03-31", leads_count: 10, mqls_count: 8, vobs_count: 4, admits_count: 2, closed_lost_count: 1 }]);
    const res = (await resolve("executive.mql_to_admit_rate")) as ScalarResult;
    expect(res.value).toBeCloseTo(0.4); // 4/10
    expect(res.prior_period_value).toBeCloseTo(0.25); // 2/8
    expect(res.series).toEqual([]); // per-day ratios are noisy — no sparkline
  });

  it("returns null (not 0, not NaN) when the denominator is zero", async () => {
    rpcReturns([{ date: "2026-05-01", leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 0, closed_lost_count: 0 }]);
    rpcReturns([{ date: "2026-03-31", leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 0, closed_lost_count: 0 }]);
    const res = (await resolve("executive.mql_to_admit_rate")) as ScalarResult;
    expect(res.value).toBeNull();
    expect(res.prior_period_value).toBeNull();
  });
});

// ── Conversion funnel — order matters ───────────────────────────────────────

describe("executive.conversion_funnel", () => {
  it("emits rows in funnel order (Leads → MQLs → VOBs → Admits), not sorted by value", async () => {
    rpcReturns([
      { date: "2026-05-01", leads_count: 100, mqls_count: 40, vobs_count: 20, admits_count: 8, closed_lost_count: 5 },
    ]);
    const res = (await resolve("executive.conversion_funnel")) as BreakdownResult;
    expect(res.kind).toBe("breakdown");
    expect(res.rows.map((r) => r.label)).toEqual(["Leads", "MQLs", "VOBs", "Admits"]);
    expect(res.rows.map((r) => r.value)).toEqual([100, 40, 20, 8]);
    expect(res.total).toBe(100); // total = leads (top of funnel)
    // conversion funnel is a single RPC call (no prior window)
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

// ── Pipeline split ──────────────────────────────────────────────────────────

describe("executive.admits_by_pipeline", () => {
  it("labels rows via RAW_PIPELINE_STRINGS and sorts by value desc", async () => {
    rpcReturns([
      { pipeline: PIPELINE.Ahcccs, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 3, closed_lost_count: 0, referred_out_count: 0 },
      { pipeline: PIPELINE.CommercialCash, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 7, closed_lost_count: 0, referred_out_count: 0 },
    ]);
    const res = (await resolve("executive.admits_by_pipeline")) as BreakdownResult;
    expect(res.rows[0].label).toBe(RAW_PIPELINE_STRINGS[PIPELINE.CommercialCash]);
    expect(res.rows[0].value).toBe(7);
    expect(res.rows[1].label).toBe(RAW_PIPELINE_STRINGS[PIPELINE.Ahcccs]);
    expect(res.total).toBe(10);
  });

  it("labels a null pipeline row as (unassigned)", async () => {
    rpcReturns([
      { pipeline: null, leads_count: 5, mqls_count: 0, vobs_count: 0, admits_count: 0, closed_lost_count: 0, referred_out_count: 0 },
    ]);
    const res = (await resolve("executive.admits_by_pipeline")) as BreakdownResult;
    expect(res.rows[0].label).toBe("(unassigned)");
  });
});

// ── Channel split ───────────────────────────────────────────────────────────

describe("executive.admits_by_channel", () => {
  it("humanizes the source_category enum into a display label", async () => {
    rpcReturns([
      { source_category: SOURCE_CATEGORY.BusinessDevelopment, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 4, closed_lost_count: 0, referred_out_count: 0 },
      { source_category: SOURCE_CATEGORY.DigitalMarketing, leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 9, closed_lost_count: 0, referred_out_count: 0 },
    ]);
    const res = (await resolve("executive.admits_by_channel")) as BreakdownResult;
    // The label is a runtime humanization of the source_category enum; derive
    // the expected text the same way (don't inline the raw taxonomy string).
    const humanize = (s: string) =>
      s.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    // sorted desc: digital (9) first, then business development (4)
    expect(res.rows[0].label).toBe(humanize(SOURCE_CATEGORY.DigitalMarketing));
    expect(res.rows[1].label).toBe(humanize(SOURCE_CATEGORY.BusinessDevelopment));
    expect(res.total).toBe(13);
  });
});

// ── Payer mix ───────────────────────────────────────────────────────────────

describe("executive.payer_mix", () => {
  it("maps RPC buckets to a breakdown by count", async () => {
    rpcReturns([
      { bucket: "AHCCCS Lead", count: 30, share: 0.6 },
      { bucket: "Commercial Lead", count: 20, share: 0.4 },
    ]);
    const res = (await resolve("executive.payer_mix")) as BreakdownResult;
    expect(res.rows.map((r) => r.label)).toEqual(["AHCCCS Lead", "Commercial Lead"]);
    expect(res.total).toBe(50);
  });

  it("relabels the residual 'Unclassified' bucket to 'Payer Pending' for display, keeping the raw bucket as dimension_value", async () => {
    rpcReturns([
      { bucket: "AHCCCS Lead", count: 30, share: 0.5 },
      { bucket: "Unclassified", count: 30, share: 0.5 },
    ]);
    const res = (await resolve("executive.payer_mix")) as BreakdownResult;
    const residual = res.rows.find((r) => r.dimension_value === "Unclassified");
    expect(residual?.label).toBe("Payer Pending");
    // Display relabel only — drilldown key (dimension_value) is unchanged.
    expect(res.rows.map((r) => r.label)).toContain("Payer Pending");
    expect(res.rows.map((r) => r.label)).not.toContain("Unclassified");
  });
});

// ── Wins / refer-out ────────────────────────────────────────────────────────

describe("executive.referred_out_total", () => {
  it("sums referred_out_closed_count and builds a daily series", async () => {
    rpcReturns([
      { date: "2026-05-01", bd_referrals_in: 1, digital_referrals_in: 0, other_referrals_in: 0, referred_out_closed_count: 2 },
      { date: "2026-05-02", bd_referrals_in: 0, digital_referrals_in: 1, other_referrals_in: 0, referred_out_closed_count: 3 },
    ]);
    const res = (await resolve("executive.referred_out_total")) as ScalarResult;
    expect(res.value).toBe(5);
    expect(res.series).toEqual([
      { date: "2026-05-01", value: 2 },
      { date: "2026-05-02", value: 3 },
    ]);
  });
});

describe("executive.referred_out_destinations", () => {
  it("aggregates the (refer_out_type, pipeline) rows up to refer_out_type", async () => {
    rpcReturns([
      { refer_out_type: "In-Network Partner", pipeline: PIPELINE.CommercialCash, count: 4 },
      { refer_out_type: "In-Network Partner", pipeline: PIPELINE.Ahcccs, count: 2 },
      { refer_out_type: "Out-of-State", pipeline: PIPELINE.CommercialCash, count: 1 },
    ]);
    const res = (await resolve("executive.referred_out_destinations")) as BreakdownResult;
    const partner = res.rows.find((r) => r.label === "In-Network Partner");
    expect(partner?.value).toBe(6); // 4 + 2 collapsed across pipelines
    expect(res.total).toBe(7);
  });
});

// ── Error propagation ───────────────────────────────────────────────────────

describe("resolver error handling", () => {
  it("surfaces RPC errors with the RPC name", async () => {
    rpcErrors("boom");
    await expect(resolve("executive.conversion_funnel")).rejects.toThrow(
      /reporting_op_funnel_daily_filtered: boom/,
    );
  });
});
