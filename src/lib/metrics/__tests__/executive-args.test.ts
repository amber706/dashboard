/**
 * executive-args.test.ts — Phase 3 RPC-dispatch tests.
 *
 * Verifies each executive.* resolver sends the right RPC name + the right
 * arg KEYS. This matters because the three RPC families have DIFFERENT
 * signatures (PostgREST matches by the exact set of named params):
 *   - funnel family:   p_pipelines, p_source_categories, p_locs, p_owner_user_ids
 *   - referrals family: NO p_locs
 *   - payer-mix:        NO p_pipelines
 * Passing an extra/missing key would make Postgres fail to resolve the
 * function, so these assertions guard against silent signature drift.
 *
 * Taxonomy values come from definitions.ts (this file is in the CI literal
 * guard's scope — never inline normalized enum strings).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetRegistry, getMetric, registerMetrics } from "../resolver";
import { EXECUTIVE_METRICS } from "../keys/executive";
import {
  LEVEL_OF_CARE,
  PIPELINE,
  SOURCE_CATEGORY,
  TOP_LINE_ADMIT_PIPELINES,
} from "../definitions";
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
  registerMetrics(EXECUTIVE_METRICS);
});
afterEach(() => _resetRegistry());

// ── Top-line scalars: funnel_daily_filtered, TOP_LINE default, TWO calls ────

const TOP_LINE_KEYS = [
  "executive.admits_total",
  "executive.vobs_total",
  "executive.mqls_total",
  "executive.mql_to_admit_rate",
];

describe("top-line scalars hit funnel_daily_filtered twice (current + prior)", () => {
  it.each(TOP_LINE_KEYS)("%s uses TOP_LINE pipelines and fires a prior-window call", async (key) => {
    await resolve(key, NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledTimes(2);

    // First call = current window with TOP_LINE default.
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      "reporting_op_funnel_daily_filtered",
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_pipelines: TOP_LINE_ADMIT_PIPELINES,
        p_source_categories: null,
        p_locs: null,
        p_owner_user_ids: null,
      }),
    );

    // Second call = the prior window (different, earlier dates).
    const secondArgs = mockRpc.mock.calls[1][1] as { p_start: string; p_end: string };
    expect(secondArgs.p_end < RANGE.from).toBe(true);
    expect(secondArgs.p_start < secondArgs.p_end).toBe(true);
  });

  it("forwards every filter slot to the current-window call", async () => {
    await resolve("executive.admits_total", ALL_FILTERS);
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      "reporting_op_funnel_daily_filtered",
      expect.objectContaining({
        p_pipelines: ALL_FILTERS.pipelines,
        p_source_categories: ALL_FILTERS.sources,
        p_locs: ALL_FILTERS.locs,
        p_owner_user_ids: ALL_FILTERS.reps,
      }),
    );
  });
});

// ── Pipeline split: ALL pipelines by default (null), not TOP_LINE ───────────

describe("pipeline-split resolvers default to ALL pipelines", () => {
  it.each([
    "executive.admits_by_pipeline",
    "executive.vobs_by_pipeline",
    "executive.mqls_by_pipeline",
  ])("%s passes p_pipelines=null when no pipeline filter is set", async (key) => {
    await resolve(key, NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_by_pipeline_filtered",
      expect.objectContaining({ p_pipelines: null }),
    );
  });

  it("respects an explicit pipeline filter", async () => {
    await resolve("executive.admits_by_pipeline", ALL_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_by_pipeline_filtered",
      expect.objectContaining({ p_pipelines: ALL_FILTERS.pipelines }),
    );
  });
});

// ── Channel split: funnel_by_source_filtered, TOP_LINE default ──────────────

describe("channel-split resolvers", () => {
  it.each(["executive.admits_by_channel", "executive.mqls_by_channel"])(
    "%s hits funnel_by_source_filtered with TOP_LINE default",
    async (key) => {
      await resolve(key, NO_FILTERS);
      expect(mockRpc).toHaveBeenCalledWith(
        "reporting_op_funnel_by_source_filtered",
        expect.objectContaining({ p_pipelines: TOP_LINE_ADMIT_PIPELINES }),
      );
    },
  );
});

// ── Payer mix: NO p_pipelines key ───────────────────────────────────────────

describe("executive.payer_mix", () => {
  it("calls payer_mix_filtered WITHOUT a p_pipelines arg (payer mix is pre-pipeline)", async () => {
    await resolve("executive.payer_mix", ALL_FILTERS);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe("reporting_op_payer_mix_filtered");
    expect(Object.keys(args ?? {})).not.toContain("p_pipelines");
    expect(args).toEqual(
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_source_categories: ALL_FILTERS.sources,
        p_locs: ALL_FILTERS.locs,
        p_owner_user_ids: ALL_FILTERS.reps,
      }),
    );
  });
});

// ── Refer-out: referrals family, NO p_locs key ──────────────────────────────

describe("refer-out resolvers use the referrals family (no p_locs)", () => {
  it("referred_out_total → referrals_daily_filtered without p_locs", async () => {
    await resolve("executive.referred_out_total", ALL_FILTERS);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe("reporting_op_referrals_daily_filtered");
    expect(Object.keys(args ?? {})).not.toContain("p_locs");
  });

  it("referred_out_destinations → referred_out_breakdown_filtered without p_locs", async () => {
    await resolve("executive.referred_out_destinations", ALL_FILTERS);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe("reporting_op_referred_out_breakdown_filtered");
    expect(Object.keys(args ?? {})).not.toContain("p_locs");
  });
});

// ── Global guard: no resolver leaks an unknown arg key to any RPC ───────────

describe("no resolver leaks unexpected arg keys", () => {
  const ALLOWED = new Set([
    "p_start",
    "p_end",
    "p_pipelines",
    "p_source_categories",
    "p_locs",
    "p_owner_user_ids",
  ]);
  const KEYS = EXECUTIVE_METRICS.map((d) => d.key);

  it.each(KEYS)("%s passes only known arg keys", async (key) => {
    await resolve(key, ALL_FILTERS);
    for (const [, args] of mockRpc.mock.calls) {
      for (const k of Object.keys(args ?? {})) {
        expect(ALLOWED.has(k), `unexpected RPC arg key: ${k}`).toBe(true);
      }
    }
  });
});
