/**
 * admissions-args.test.ts — Phase 2A integration-shaped tests.
 *
 * Earlier tests verify that the resolvers compute the right number given a
 * fake RPC response. This file verifies the OTHER half: that each resolver
 * passes the right RPC name + args to supabase, so the right slice of data
 * is even being asked for in the first place.
 *
 * Why this matters: every admissions.* metric is gated on RLS at the
 * Supabase layer. Whether RLS narrows correctly depends entirely on the
 * args the resolver sends — specifically `p_owner_user_ids`. If the
 * resolver fails to forward the FilterContract's `reps` slot, RLS still
 * holds (an unauthorized user can't escape their own scope) but the
 * dashboard would show un-narrowed data within an authorized user's
 * view, which is a UX bug.
 *
 * Each test invokes one resolver and inspects what was passed to the
 * mocked supabase.rpc — the RPC name, then the filter args.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _listRegisteredKeys,
  _resetRegistry,
  getMetric,
  registerMetrics,
} from "../resolver";
import { ADMISSIONS_METRICS } from "../keys/admissions";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";
import { TOP_LINE_ADMIT_PIPELINES } from "../definitions";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

const mockRpc = vi.mocked(supabase.rpc);

const RANGE: DateRange = { from: "2026-05-01", to: "2026-05-31" };
const NO_FILTERS: FilterContract = {
  pipelines: [],
  sources: [],
  locs: [],
  reps: [],
};
const ALL_FILTERS: FilterContract = {
  pipelines: ["commercial_cash"],
  sources: ["business_development"],
  locs: ["iop3"],
  reps: ["00000000-0000-0000-0000-000000000001"],
};

const resolve = (key: string, filters: FilterContract = NO_FILTERS) =>
  getMetric(key).resolve(RANGE, filters);

beforeEach(() => {
  vi.clearAllMocks();
  _resetRegistry();
  registerMetrics(ADMISSIONS_METRICS);
});

afterEach(() => {
  _resetRegistry();
});

// ── Funnel-RPC metrics (6 keys share the same RPC + args shape) ───────────

const FUNNEL_KEYS = [
  "admissions.mqls_total",
  "admissions.vobs_total",
  "admissions.admits_total",
  "admissions.closed_lost_total",
  "admissions.mql_to_vob_rate",
  "admissions.mql_to_admit_rate",
];

describe("Funnel-RPC resolvers (all 6 share reporting_op_funnel_daily_filtered)", () => {
  it.each(FUNNEL_KEYS)(
    "%s calls reporting_op_funnel_daily_filtered with TOP_LINE pipelines + the window when no filters set",
    async (key) => {
      await resolve(key, NO_FILTERS);
      expect(mockRpc).toHaveBeenCalledWith(
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
    },
  );

  it("forwards every filter slot to the RPC when all four are set", async () => {
    await resolve("admissions.mqls_total", ALL_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_daily_filtered",
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_pipelines: ALL_FILTERS.pipelines,
        p_source_categories: ALL_FILTERS.sources,
        p_locs: ALL_FILTERS.locs,
        p_owner_user_ids: ALL_FILTERS.reps,
      }),
    );
  });

  it("uses TOP_LINE default when pipeline filter is empty (brief's default filter set)", async () => {
    const filtersWithoutPipeline = { ...ALL_FILTERS, pipelines: [] };
    await resolve("admissions.mqls_total", filtersWithoutPipeline);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_daily_filtered",
      expect.objectContaining({ p_pipelines: TOP_LINE_ADMIT_PIPELINES }),
    );
  });
});

// ── By-LOC RPC metrics (3 keys share reporting_op_funnel_by_loc_filtered) ──

const BY_LOC_KEYS = [
  "admissions.mqls_by_requested_loc",
  "admissions.vobs_by_requested_loc",
  "admissions.admits_by_admitted_loc",
];

describe("By-LOC resolvers (all 3 share reporting_op_funnel_by_loc_filtered)", () => {
  it.each(BY_LOC_KEYS)("%s hits the right RPC", async (key) => {
    await resolve(key, NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_by_loc_filtered",
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_pipelines: TOP_LINE_ADMIT_PIPELINES,
      }),
    );
  });
});

// ── Rep-funnel RPC metrics (4 keys: by_rep × 3 + closed_lost_by_rep) ──────

const BY_REP_KEYS = [
  "admissions.mqls_by_rep",
  "admissions.vobs_by_rep",
  "admissions.admits_by_rep",
  "admissions.closed_lost_by_rep",
];

describe("By-Rep resolvers (all 4 share reporting_op_rep_funnel)", () => {
  it.each(BY_REP_KEYS)(
    "%s calls reporting_op_rep_funnel with just start + end (no filter args yet)",
    async (key) => {
      await resolve(key, NO_FILTERS);
      // rep_funnel isn't filter-aware yet — the resolver honors the
      // `reps` filter client-side after the RPC returns. See
      // PHASE_2A_NOTES.md "known gaps".
      expect(mockRpc).toHaveBeenCalledWith("reporting_op_rep_funnel", {
        p_start: RANGE.from,
        p_end: RANGE.to,
      });
    },
  );
});

// ── Rep × LOC matrix metrics (3 keys share funnel_by_rep_by_loc_filtered) ──

const MATRIX_KEYS = [
  "admissions.mqls_by_rep_by_loc",
  "admissions.vobs_by_rep_by_loc",
  "admissions.admits_by_rep_by_loc",
];

describe("Matrix resolvers (all 3 share reporting_op_funnel_by_rep_by_loc_filtered)", () => {
  it.each(MATRIX_KEYS)("%s hits the matrix RPC with all filter slots", async (key) => {
    await resolve(key, ALL_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_funnel_by_rep_by_loc_filtered",
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_pipelines: ALL_FILTERS.pipelines,
        p_source_categories: ALL_FILTERS.sources,
        p_locs: ALL_FILTERS.locs,
        p_owner_user_ids: ALL_FILTERS.reps,
      }),
    );
  });
});

// ── Call-activity metrics (4 keys via rep_activity) ───────────────────────

describe("Call-activity resolvers (rep_activity + _filtered variants)", () => {
  it("calls reporting_op_rep_activity (unfiltered) when no rep filter set", async () => {
    await resolve("admissions.inbound_calls_team", NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith("reporting_op_rep_activity", {
      p_start: RANGE.from,
      p_end: RANGE.to,
    });
  });

  it("routes to reporting_op_rep_activity_filtered when reps filter is set", async () => {
    await resolve("admissions.inbound_calls_team", {
      ...NO_FILTERS,
      reps: ["abc-uuid"],
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_rep_activity_filtered",
      expect.objectContaining({
        p_owner_user_ids: ["abc-uuid"],
      }),
    );
  });

  it("missed_call_pct_team uses the same rep_activity surface", async () => {
    await resolve("admissions.missed_call_pct_team", NO_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_rep_activity",
      expect.objectContaining({ p_start: RANGE.from, p_end: RANGE.to }),
    );
  });
});

// ── Closed-lost-by-reason RPC ─────────────────────────────────────────────

describe("admissions.closed_lost_by_reason — uses the dedicated filtered RPC", () => {
  it("calls reporting_op_closed_lost_by_reason_filtered with all filter slots", async () => {
    await resolve("admissions.closed_lost_by_reason", ALL_FILTERS);
    expect(mockRpc).toHaveBeenCalledWith(
      "reporting_op_closed_lost_by_reason_filtered",
      expect.objectContaining({
        p_start: RANGE.from,
        p_end: RANGE.to,
        p_pipelines: ALL_FILTERS.pipelines,
        p_source_categories: ALL_FILTERS.sources,
        p_locs: ALL_FILTERS.locs,
        p_owner_user_ids: ALL_FILTERS.reps,
      }),
    );
  });
});

// ── Spot-check: no resolver leaks a non-FilterContract field to the RPC ───

describe("Resolvers don't leak unexpected fields to the RPC", () => {
  const ALL_RESOLVERS = _listRegisteredKeys().filter((k) =>
    k.startsWith("admissions."),
  );
  // Re-register so this list isn't empty (the outer suite resets between tests).
  beforeEach(() => {
    _resetRegistry();
    registerMetrics(ADMISSIONS_METRICS);
  });
  const ADMISSIONS_KEYS = ADMISSIONS_METRICS.map((d) => d.key);
  void ALL_RESOLVERS; // referenced for clarity

  it.each(ADMISSIONS_KEYS)("%s passes only known arg keys", async (key) => {
    await resolve(key);
    const allCalls = mockRpc.mock.calls;
    expect(allCalls.length).toBeGreaterThan(0);
    for (const [, args] of allCalls) {
      const keys = Object.keys(args ?? {});
      // The full set of allowed RPC arg keys across every admissions
      // resolver. New args added in the future should be reviewed here.
      const allowed = new Set([
        "p_start",
        "p_end",
        "p_pipelines",
        "p_source_categories",
        "p_locs",
        "p_owner_user_ids",
      ]);
      for (const k of keys) {
        expect(allowed.has(k), `unexpected RPC arg key: ${k}`).toBe(true);
      }
    }
  });
});
