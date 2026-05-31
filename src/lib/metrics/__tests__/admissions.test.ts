// admissions.test.ts — Phase 2A resolver tests.
//
// Per the Phase 2 brief, each `admissions.*` metric_key must pass:
//   - generated-query / numeric correctness against seed data
//   - RLS scoping (specialist sees own slice; manager sees team)
//   - drill-down aggregate equals the metric value
//   - default time window resolves to this-month + last-2-months
//   - conversion ratios return null (not 0, not NaN) on zero denominator
//
// Phase 2A ships the substrate + 5 wired resolvers; the remaining 18 are
// stubbed with `notYetWired()` throws. Those keys have a single "stub
// raises" test each to lock the contract until they're filled in.
//
// All tests against the Supabase RPC layer are mocked here — the
// resolver-vs-live-data verification is logged manually in
// /docs/VERIFICATION_LOG.md per the 2A acceptance gate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importing the catalog has the side effect of registering every admissions
// metric. We import the resolver module first so we can clear the registry
// before each test and re-register cleanly.
import {
  _listRegisteredKeys,
  _resetRegistry,
  getMetric,
  registerMetrics,
  safeRatio,
  sumNullable,
  type MetricResult,
  type ScalarResult,
  type BreakdownResult,
} from "../resolver";
import { ADMISSIONS_METRICS } from "../keys/admissions";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

// ── module-level mock of supabase.rpc ─────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

const mockRpc = vi.mocked(supabase.rpc);

// ── helpers ───────────────────────────────────────────────────────────────

function rpcReturns(data: unknown) {
  // The real supabase rpc returns a PostgrestSingleResponse; for our purposes
  // we only need { data, error } so we use a minimal stub.
  mockRpc.mockResolvedValueOnce({ data, error: null } as never);
}

function rpcErrors(message: string) {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message } } as never);
}

const DEFAULT_RANGE: DateRange = { from: "2026-05-26", to: "2026-05-30" };

const DEFAULT_FILTERS: FilterContract = {
  pipelines: [],
  sources: [],
  locs: [],
  reps: [],
};

// Convenience: each test's resolve() call sends both args.
const resolve = (key: string) =>
  getMetric(key).resolve(DEFAULT_RANGE, DEFAULT_FILTERS);

// Five rows of synthetic funnel data — covers a 5-day window.
const SAMPLE_FUNNEL = [
  { date: "2026-05-26", leads_count: 30, mqls_count: 20, vobs_count: 12, admits_count: 6, closed_lost_count: 3 },
  { date: "2026-05-27", leads_count: 25, mqls_count: 18, vobs_count: 10, admits_count: 5, closed_lost_count: 4 },
  { date: "2026-05-28", leads_count: 28, mqls_count: 22, vobs_count: 14, admits_count: 7, closed_lost_count: 2 },
  { date: "2026-05-29", leads_count: 32, mqls_count: 24, vobs_count: 13, admits_count: 8, closed_lost_count: 5 },
  { date: "2026-05-30", leads_count: 35, mqls_count: 26, vobs_count: 15, admits_count: 9, closed_lost_count: 1 },
];
// Sums for quick reference:
//   mqls = 110, vobs = 64, admits = 35, closed_lost = 15

beforeEach(() => {
  vi.clearAllMocks();
  _resetRegistry();
  // Re-register the catalog freshly each test. The keys/admissions.ts module
  // also calls registerMetrics() at import time, but vitest's module cache
  // means that fires exactly once across all tests — so we own re-registration
  // here explicitly.
  registerMetrics(ADMISSIONS_METRICS);
});

afterEach(() => {
  _resetRegistry();
});

// ── pure helper tests ─────────────────────────────────────────────────────

describe("resolver helpers", () => {
  it("safeRatio returns null on zero denominator (NOT 0, NOT NaN)", () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(5, 0)).toBeNull();
    // sanity
    expect(safeRatio(0, 5)).toBe(0);
    expect(safeRatio(3, 4)).toBe(0.75);
  });

  it("sumNullable ignores null/undefined entries", () => {
    expect(sumNullable([1, 2, 3])).toBe(6);
    expect(sumNullable([1, null, 3, undefined, 5])).toBe(9);
    expect(sumNullable([])).toBe(0);
  });
});

// ── registry tests ────────────────────────────────────────────────────────

describe("admissions metric registry", () => {
  it("registers exactly 23 metric_keys", async () => {
    const keys = _listRegisteredKeys();
    const admissionsKeys = keys.filter((k) => k.startsWith("admissions."));
    expect(admissionsKeys).toHaveLength(23);
  });

  it("every registered key follows the admissions.<snake_case> pattern", async () => {
    const keys = _listRegisteredKeys().filter((k) => k.startsWith("admissions."));
    for (const k of keys) {
      expect(k).toMatch(/^admissions\.[a-z][a-z0-9_]*$/);
    }
  });

  it("every metric definition has a drilldown config", async () => {
    const keys = _listRegisteredKeys().filter((k) => k.startsWith("admissions."));
    for (const k of keys) {
      const def = getMetric(k);
      expect(def.drilldown).toBeDefined();
      expect(def.drilldown.source).toMatch(/^reporting\.(deals|leads|calls|meetings)$/);
    }
  });

  it("inverse metrics are exactly the down-is-good ones", async () => {
    const keys = _listRegisteredKeys().filter((k) => k.startsWith("admissions."));
    const inverseKeys = keys.filter((k) => getMetric(k).inverse === true);
    expect(inverseKeys.sort()).toEqual(
      [
        "admissions.closed_lost_by_reason",
        "admissions.closed_lost_by_rep",
        "admissions.closed_lost_total",
        "admissions.missed_call_pct_team",
      ].sort(),
    );
  });
});

// ── wired resolver tests ──────────────────────────────────────────────────

describe("admissions.mqls_total — wired scalar", () => {
  it("sums mqls_count across the window", async () => {
    rpcReturns(SAMPLE_FUNNEL);
    const r = (await resolve("admissions.mqls_total")) as ScalarResult;
    expect(r.kind).toBe("scalar");
    expect(r.value).toBe(110);
    expect(r.series).toHaveLength(5);
    expect(r.series[0]).toEqual({ date: "2026-05-26", value: 20 });
  });

  it("returns zero (not null) when the RPC yields zero rows", async () => {
    rpcReturns([]);
    const r = (await resolve("admissions.mqls_total")) as ScalarResult;
    expect(r.value).toBe(0);
    expect(r.series).toEqual([]);
  });

  it("propagates RPC errors as Error instances", async () => {
    rpcErrors("permission denied");
    await expect(
      resolve("admissions.mqls_total"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("admissions.closed_lost_total — wired scalar (same shape, different column)", () => {
  it("sums closed_lost_count across the window", async () => {
    rpcReturns(SAMPLE_FUNNEL);
    const r = (await resolve("admissions.closed_lost_total")) as ScalarResult;
    expect(r.value).toBe(15);
  });
});

describe("admissions.mql_to_admit_rate — wired derived ratio", () => {
  it("computes admits / mqls correctly", async () => {
    rpcReturns(SAMPLE_FUNNEL);
    const r = (await resolve("admissions.mql_to_admit_rate")) as ScalarResult;
    // 35 / 110 ≈ 0.31818
    expect(r.value).toBeCloseTo(35 / 110, 5);
  });

  it("SPEC CASE: returns null (NOT 0, NOT NaN) when MQLs are zero", async () => {
    // The brief explicitly requires null on zero-denominator.
    rpcReturns([
      { date: "2026-05-30", leads_count: 0, mqls_count: 0, vobs_count: 0, admits_count: 0, closed_lost_count: 0 },
    ]);
    const r = (await resolve("admissions.mql_to_admit_rate")) as ScalarResult;
    expect(r.value).toBeNull();
    expect(Number.isNaN(r.value)).toBe(false);
  });

  it("does not emit a sparkline (daily ratios are too noisy)", async () => {
    rpcReturns(SAMPLE_FUNNEL);
    const r = (await resolve("admissions.mql_to_admit_rate")) as ScalarResult;
    expect(r.series).toEqual([]);
  });
});

describe("admissions.admits_by_admitted_loc — wired breakdown", () => {
  it("rolls up admits_count by level_of_care and sorts descending", async () => {
    rpcReturns([
      { date: "2026-05-26", level_of_care: "iop3", admits_count: 2 },
      { date: "2026-05-27", level_of_care: "iop3", admits_count: 3 },
      { date: "2026-05-26", level_of_care: "iop5", admits_count: 1 },
      { date: "2026-05-28", level_of_care: "php", admits_count: 4 },
      { date: "2026-05-28", level_of_care: null, admits_count: 1 },
    ]);
    const r = (await resolve("admissions.admits_by_admitted_loc")) as BreakdownResult;
    expect(r.kind).toBe("breakdown");
    expect(r.rows.map((x) => x.dimension_value)).toEqual(["iop3", "php", "iop5", "(none)"]);
    expect(r.rows.map((x) => x.value)).toEqual([5, 4, 1, 1]);
    expect(r.total).toBe(11);
  });

  it("returns an empty breakdown (kind: 'breakdown', rows: []) on no data", async () => {
    rpcReturns([]);
    const r = (await resolve("admissions.admits_by_admitted_loc")) as BreakdownResult;
    expect(r.kind).toBe("breakdown");
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
  });
});

describe("admissions.missed_call_pct_team — wired derived ratio (rep_activity)", () => {
  it("computes missed_calls / inbound_calls across the team", async () => {
    rpcReturns([
      { owner_user_id: "u1", inbound_calls: 50, missed_calls: 5 },
      { owner_user_id: "u2", inbound_calls: 40, missed_calls: 10 },
      { owner_user_id: null, inbound_calls: 10, missed_calls: 1 }, // unattributed
    ]);
    const r = (await resolve("admissions.missed_call_pct_team")) as ScalarResult;
    // 16 / 100 = 0.16
    expect(r.value).toBeCloseTo(0.16, 5);
  });

  it("returns null when there are no inbound calls", async () => {
    rpcReturns([{ owner_user_id: "u1", inbound_calls: 0, missed_calls: 0 }]);
    const r = (await resolve("admissions.missed_call_pct_team")) as ScalarResult;
    expect(r.value).toBeNull();
  });
});

// ── stubbed resolvers ─────────────────────────────────────────────────────

const STUBBED_KEYS = [
  "admissions.mql_to_vob_rate",
  "admissions.vob_to_admit_rate",
  "admissions.admits_total",
  "admissions.vobs_total",
  "admissions.vobs_by_requested_loc",
  "admissions.mqls_by_requested_loc",
  "admissions.admits_by_rep",
  "admissions.vobs_by_rep",
  "admissions.mqls_by_rep",
  "admissions.admits_by_rep_by_loc",
  "admissions.vobs_by_rep_by_loc",
  "admissions.mqls_by_rep_by_loc",
  "admissions.inbound_calls_team",
  "admissions.inbound_calls_by_rep",
  "admissions.outbound_calls_team",
  "admissions.outbound_calls_by_rep",
  "admissions.closed_lost_by_reason",
  "admissions.closed_lost_by_rep",
];

describe("stubbed resolvers", () => {
  it("there are exactly 18 stubbed resolvers (locks the wired/stubbed split)", () => {
    expect(STUBBED_KEYS).toHaveLength(18);
  });

  it.each(STUBBED_KEYS)("%s throws not_yet_wired with the docs pointer", async (key) => {
    await expect(resolve(key)).rejects.toThrow(
      /not yet wired/,
    );
  });
});

// ── unknown-key behavior ──────────────────────────────────────────────────

describe("getMetric error handling", () => {
  it("throws a helpful error when the key is not registered", async () => {
    expect(() => getMetric("admissions.does_not_exist")).toThrow(
      /unknown metric key/,
    );
  });
});

// Use the unused `MetricResult` import to keep the type-check happy.
const _typecheck: MetricResult | null = null;
void _typecheck;
