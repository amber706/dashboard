#!/usr/bin/env tsx
/**
 * scripts/verify_metrics.ts — Phase 1B chunk 4 verifier.
 *
 * For a chosen date range, recompute each headline funnel metric two ways:
 *   1) from the cached `reporting.op_lead_funnel_daily` rollup (via
 *      `public.verifier_cached_funnel`).
 *   2) from the normalized mirrors `reporting.leads`/`deals` using the same
 *      predicates the builder applies (via `public.verifier_ground_truth_funnel`).
 *
 * Emits a CSV side-by-side and exits non-zero if any row's drift is above
 * the tolerance (default 0.5%).
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     tsx scripts/verify_metrics.ts --start 2026-05-14 --end 2026-05-28 \
 *     [--tolerance 0.005] [--out drift.csv]
 *
 * Requires migration 161 applied (verifier_ground_truth_funnel +
 * verifier_cached_funnel RPCs).
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

interface Args {
  start: string;
  end: string;
  tolerance: number;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { start: "", end: "", tolerance: 0.005, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--start" && v) { args.start = v; i++; }
    else if (k === "--end" && v) { args.end = v; i++; }
    else if (k === "--tolerance" && v) { args.tolerance = parseFloat(v); i++; }
    else if (k === "--out" && v) { args.out = v; i++; }
    else if (k === "--help" || k === "-h") {
      console.log("Usage: tsx scripts/verify_metrics.ts --start YYYY-MM-DD --end YYYY-MM-DD [--tolerance 0.005] [--out drift.csv]");
      process.exit(0);
    }
  }
  if (!args.start || !args.end) {
    console.error("ERROR: --start and --end are required (YYYY-MM-DD).");
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(2);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const METRICS = [
  "leads_count",
  "mqls_count",
  "vobs_count",
  "admits_count",
  "closed_lost_count",
  "referred_out_count",
] as const;
type Metric = typeof METRICS[number];

interface FunnelRow {
  date: string;
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}

interface DailyRow {
  date: string;
  metric: Metric;
  cached: number;
  ground_truth: number;
  drift: number;        // |cached - gt| / max(|gt|, 1)
  status: "ok" | "drift" | "missing_cached";
}

function drift(cached: number, gt: number): number {
  const denom = Math.max(Math.abs(gt), 1);
  return Math.abs(cached - gt) / denom;
}

async function callRpc(name: string): Promise<FunnelRow[]> {
  const { data, error } = await supa.rpc(name, { p_start: args.start, p_end: args.end });
  if (error) {
    throw new Error(
      `${name} failed: ${error.message}\n` +
      `Did you apply supabase/migrations/161_verifier_rpcs.sql?`,
    );
  }
  return (data ?? []) as FunnelRow[];
}

async function main() {
  const tol = args.tolerance;
  console.error(`Verifying ${args.start} → ${args.end} with tolerance ${(tol * 100).toFixed(2)}%`);

  const [groundTruth, cached] = await Promise.all([
    callRpc("verifier_ground_truth_funnel"),
    callRpc("verifier_cached_funnel"),
  ]);

  const cachedByDate = new Map<string, FunnelRow>();
  for (const row of cached) cachedByDate.set(String(row.date), row);

  const rows: DailyRow[] = [];
  for (const gt of groundTruth) {
    const date = String(gt.date);
    const cachedRow = cachedByDate.get(date);
    for (const m of METRICS) {
      const gtN = Number(gt[m] ?? 0);
      const cachedN = cachedRow ? Number(cachedRow[m] ?? 0) : undefined;
      rows.push({
        date,
        metric: m,
        cached: cachedN ?? 0,
        ground_truth: gtN,
        drift: cachedN === undefined ? 1 : drift(cachedN, gtN),
        status: cachedN === undefined ? "missing_cached" : (drift(cachedN, gtN) > tol ? "drift" : "ok"),
      });
    }
  }

  const driftRows = rows.filter((r) => r.status !== "ok");
  const okCount = rows.length - driftRows.length;

  const header = ["date", "metric", "cached", "ground_truth", "drift_pct", "status"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.date, r.metric,
      String(r.cached), String(r.ground_truth),
      (r.drift * 100).toFixed(4),
      r.status,
    ].join(","));
  }
  const csv = lines.join("\n") + "\n";
  if (args.out) {
    writeFileSync(args.out, csv);
    console.error(`Wrote ${args.out}`);
  } else {
    process.stdout.write(csv);
  }

  console.error(`\nSummary: ${okCount} ok, ${driftRows.length} drift/missing (out of ${rows.length}).`);
  if (driftRows.length > 0) {
    console.error("First 10 drift rows:");
    for (const r of driftRows.slice(0, 10)) {
      console.error(`  ${r.date} ${r.metric}: cached=${r.cached}, gt=${r.ground_truth}, drift=${(r.drift * 100).toFixed(2)}% (${r.status})`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
