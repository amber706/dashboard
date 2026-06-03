/**
 * bd-args.test.ts — Phase 4 RPC-dispatch tests.
 *
 * Verifies each bd.* resolver sends the right RPC name + arg KEYS. The three
 * RPC families have different signatures (PostgREST matches by the exact set
 * of named params): funnel-by-source (has p_locs), referrals (no p_locs),
 * rep_activity (start/end [+ owner when reps filter set]).
 *
 * Taxonomy values come from definitions.ts (this file is in the literal
 * guard's scope — never inline normalized enum strings).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetRegistry, getMetric, registerMetrics } from "../resolver";
import { BD_METRICS } from "../keys/bd";
import { LEVEL_OF_CARE, PIPELINE, SOURCE_CATEGORY, TOP_LINE_ADMIT_PIPELINES } from "../definitions";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
}));
const mockRpc = vi.mocked(supabase.rpc);

const RANGE: DateRange = { from: "2026-05-01", to: "2026-05-31" };
const NO_FILTERS: FilterContract = { pipelines: [], sources: [], locs: [], reps: [] };
const ALL_FILTERS: FilterContract = {
  pipelines: [PIPELINE.CommercialCash],
  sources: [SOURCE_CATEGORY.BusinessDevelopment],
  locs: [LEVEL_OF_CARE.Iop3],
  reps: ["00000000-0000-0000-0000-000000000001"],
};
const resolve = (key: string, filters: FilterContract = NO_FILTERS) =>
  getMetric(key).resolve(RANGE, filters);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null } as never);
  _resetRegistry();
  registerMetrics(BD_METRICS);
});
afterEach(() => _resetRegistry());

describe("referral resolvers → referrals_daily_filtered (no p_locs)", () => {
  it("bd.referrals_in_total uses TOP_LINE pipelines and fires a prior-window call", async () => {
    await resolve("bd.referrals_in_total", NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledTimes(2); // current + MoM prior
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe("reporting_op_referrals_daily_filtered");
    expect(args).toEqual(
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_pipelines: TOP_LINE_ADMIT_PIPELINES,
        p_source_categories: null,
        p_owner_user_ids: null,
      }),
    );
    expect(Object.keys(args ?? {})).not.toContain("p_locs");
  });

  it("bd.referred_out_destinations → referred_out_breakdown_filtered, no p_locs", async () => {
    await resolve("bd.referred_out_destinations", ALL_FILTERS);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe("reporting_op_referred_out_breakdown_filtered");
    expect(Object.keys(args ?? {})).not.toContain("p_locs");
  });
});

describe("BD-sourced funnel → funnel_by_source_filtered", () => {
  it("bd.admits_from_bd forces p_source_categories = [business_development]", async () => {
    await resolve("bd.admits_from_bd", NO_FILTERS);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe("reporting_op_funnel_by_source_filtered");
    expect(args).toEqual(
      expect.objectContaining({ p_source_categories: [SOURCE_CATEGORY.BusinessDevelopment] }),
    );
    expect(mockRpc).toHaveBeenCalledTimes(2); // MoM
  });

  it("bd.admits_by_source passes all sources (no source override)", async () => {
    await resolve("bd.admits_by_source", NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_by_source_filtered",
      expect.objectContaining({ p_source_categories: null, p_pipelines: TOP_LINE_ADMIT_PIPELINES }),
    );
  });
});

describe("BD rep activity → rep_activity", () => {
  it("uses the unfiltered RPC when no reps filter is set", async () => {
    await resolve("bd.meetings_by_rep", NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith("reporting_op_rep_activity", {
      p_start: RANGE.from,
      p_end: RANGE.to,
    });
  });

  it("routes to rep_activity_filtered with p_owner_user_ids when reps filter is set", async () => {
    await resolve("bd.meetings_by_rep", { ...NO_FILTERS, reps: ["abc"] });
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_rep_activity_filtered",
      expect.objectContaining({ p_owner_user_ids: ["abc"] }),
    );
  });
});

describe("no resolver leaks an unexpected arg key", () => {
  const ALLOWED = new Set([
    "p_start", "p_end", "p_pipelines", "p_source_categories", "p_locs", "p_owner_user_ids",
  ]);
  const KEYS = BD_METRICS.map((d) => d.key);
  it.each(KEYS)("%s passes only known arg keys", async (key) => {
    await resolve(key, ALL_FILTERS);
    for (const [, args] of mockRpc.mock.calls) {
      for (const k of Object.keys(args ?? {})) {
        expect(ALLOWED.has(k), `unexpected RPC arg key: ${k}`).toBe(true);
      }
    }
  });
});
