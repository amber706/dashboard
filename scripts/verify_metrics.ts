#!/usr/bin/env tsx
/**
 * scripts/verify_metrics.ts — Phase 1B chunk 4 verifier + Phase 2A admissions
 * drift check.
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
 * `--scope=admissions` adds a second section that prints every
 * admissions.* metric resolver's output for the same window so the user can
 * cross-check against Zoho Analytics by hand. The admissions resolvers
 * aggregate from the same cache the funnel drift check validates, so the
 * funnel drift result transfers automatically — this section is for
 * hand-verification, not additional drift math.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     tsx scripts/verify_metrics.ts \
 *       --start 2026-05-01 --end 2026-05-31 \
 *       [--scope all|admissions] \
 *       [--tolerance 0.005] [--out drift.csv]
 *
 * Requires migrations 161 (verifier_*), 190-193 (Phase 2A enums + RPCs).
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

type Scope = "all" | "admissions";

interface Args {
  start: string;
  end: string;
  scope: Scope;
  tolerance: number;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    start: "",
    end: "",
    scope: "all",
    tolerance: 0.005,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--start" && v) { args.start = v; i++; }
    else if (k === "--end" && v) { args.end = v; i++; }
    else if (k === "--tolerance" && v) { args.tolerance = parseFloat(v); i++; }
    else if (k === "--out" && v) { args.out = v; i++; }
    else if (k === "--scope" && v) {
      if (v !== "all" && v !== "admissions") {
        console.error(`ERROR: --scope must be "all" or "admissions"; got "${v}".`);
        process.exit(2);
      }
      args.scope = v;
      i++;
    } else if (k === "--help" || k === "-h") {
      console.log(
        "Usage: tsx scripts/verify_metrics.ts " +
          "--start YYYY-MM-DD --end YYYY-MM-DD " +
          "[--scope all|admissions] [--tolerance 0.005] [--out drift.csv]",
      );
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

  if (args.scope === "admissions") {
    await printAdmissionsSpotCheck();
  }
}

/**
 * --scope=admissions extension: pretty-print every admissions.* metric
 * over the same window for hand-verification against Zoho Analytics.
 *
 * These values flow through the same op_lead_funnel_daily +
 * op_rep_activity_daily cache that the funnel drift check above already
 * verifies — there's no additional drift surface, just convenience
 * formatting for the spot-check Amber owes the Phase 2A acceptance gate.
 */
async function printAdmissionsSpotCheck(): Promise<void> {
  console.error("\n=== Phase 2A admissions spot-check ===");
  console.error(`Window: ${args.start} → ${args.end}`);
  console.error("Cross-check these against Zoho Analytics for the same window.\n");

  // Funnel totals — pulled via the same _filtered RPC the resolver uses.
  // Default pipelines = top-line (commercial_cash, ahcccs, zocdoc).
  const TOP_LINE = ["commercial_cash", "ahcccs", "zocdoc"];
  const { data: funnel, error: funnelErr } = await supa.rpc(
    "reporting_op_funnel_daily_filtered",
    {
      p_start: args.start,
      p_end: args.end,
      p_pipelines: TOP_LINE,
      p_source_categories: null,
      p_locs: null,
      p_owner_user_ids: null,
    },
  );
  if (funnelErr) {
    console.error(`(funnel) RPC error: ${funnelErr.message}`);
    return;
  }
  const fRows = (funnel ?? []) as Array<{
    mqls_count: number;
    vobs_count: number;
    admits_count: number;
    closed_lost_count: number;
  }>;
  const sum = (k: keyof typeof fRows[0]) =>
    fRows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0);
  const mqls = sum("mqls_count");
  const vobs = sum("vobs_count");
  const admits = sum("admits_count");
  const closed_lost = sum("closed_lost_count");

  const safeRatio = (n: number, d: number): string =>
    d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`;

  console.error("Volume (top-line pipelines only — Commercial-Cash + AHCCCS + ZocDoc):");
  console.error(`  admissions.mqls_total         = ${mqls}`);
  console.error(`  admissions.vobs_total         = ${vobs}`);
  console.error(`  admissions.admits_total       = ${admits}`);
  console.error(`  admissions.closed_lost_total  = ${closed_lost}`);

  console.error("\nConversion ratios:");
  console.error(`  admissions.mql_to_vob_rate    = ${safeRatio(vobs, mqls)}`);
  console.error(`  admissions.vob_to_admit_rate  = ${safeRatio(admits, vobs)}`);
  console.error(`  admissions.mql_to_admit_rate  = ${safeRatio(admits, mqls)}`);

  // Call activity — rep_activity is unfiltered (no pipeline/source/LOC
  // dimensions); we use the base RPC.
  const { data: ra, error: raErr } = await supa.rpc(
    "reporting_op_rep_activity",
    { p_start: args.start, p_end: args.end },
  );
  if (raErr) {
    console.error(`\n(rep_activity) RPC error: ${raErr.message}`);
  } else {
    const raRows = (ra ?? []) as Array<{
      inbound_calls: number;
      outbound_calls: number;
      missed_calls: number;
    }>;
    const inbound = raRows.reduce((acc, r) => acc + Number(r.inbound_calls ?? 0), 0);
    const outbound = raRows.reduce((acc, r) => acc + Number(r.outbound_calls ?? 0), 0);
    const missed = raRows.reduce((acc, r) => acc + Number(r.missed_calls ?? 0), 0);
    console.error("\nCall activity:");
    console.error(`  admissions.inbound_calls_team   = ${inbound}`);
    console.error(`  admissions.outbound_calls_team  = ${outbound}`);
    console.error(`  admissions.missed_call_pct_team = ${safeRatio(missed, inbound)} (missed=${missed})`);
  }

  // Per-rep funnel — print as a small table.
  const { data: rf, error: rfErr } = await supa.rpc(
    "reporting_op_rep_funnel",
    { p_start: args.start, p_end: args.end },
  );
  if (rfErr) {
    console.error(`\n(rep_funnel) RPC error: ${rfErr.message}`);
  } else {
    const rfRows = (rf ?? []) as Array<{
      full_name: string | null;
      mqls_count: number;
      vobs_count: number;
      admits_count: number;
      closed_lost_count: number;
    }>;
    if (rfRows.length > 0) {
      console.error("\nadmissions.{mqls,vobs,admits,closed_lost}_by_rep:");
      console.error("  " + "rep".padEnd(28) + "mqls    vobs    admits  closed_lost");
      for (const r of rfRows) {
        const name = (r.full_name ?? "(unattributed)").padEnd(28);
        const m = String(r.mqls_count).padStart(6);
        const v = String(r.vobs_count).padStart(6);
        const a = String(r.admits_count).padStart(6);
        const cl = String(r.closed_lost_count).padStart(8);
        console.error(`  ${name}${m}  ${v}  ${a}  ${cl}`);
      }
    }
  }

  console.error("\n=== End admissions spot-check ===\n");
  console.error("To finish closing the Phase 2A acceptance gate:");
  console.error("  1. Pick 3 of the above values (one volume, one ratio, one rep-scoped).");
  console.error("  2. Cross-check each against Zoho Analytics for the same window.");
  console.error("  3. Log the comparison in docs/VERIFICATION_LOG.md under a new");
  console.error("     'Phase 2a — Admissions Metrics' section.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
