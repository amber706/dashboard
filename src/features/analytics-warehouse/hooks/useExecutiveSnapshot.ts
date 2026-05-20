import { useQuery } from "@tanstack/react-query";
import { fact } from "../api/client";
import type {
  DateRange, ExecutiveSnapshot, MonthlySeries, PayerRow, StageCount,
} from "../api/types";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const STAGE_ORDER: { key: string; label: string }[] = [
  { key: "lead_created",    label: "Leads Created" },
  { key: "connected_ftc",   label: "Connected/FTC" },
  { key: "vob_in_progress", label: "VOB In Progress" },
  { key: "vob_approved",    label: "VOB Approved" },
  { key: "admit_scheduled", label: "Admit Scheduled" },
  { key: "closed_admitted", label: "Closed Admitted" },
];

async function fetchExecutiveSnapshot(range: DateRange): Promise<ExecutiveSnapshot> {
  const fromDt = new Date(range.from);
  const toDt   = new Date(range.to);
  const span   = toDt.getTime() - fromDt.getTime();
  const priorFrom = isoDate(new Date(fromDt.getTime() - span - 86_400_000));
  const priorTo   = isoDate(new Date(fromDt.getTime() - 86_400_000));

  const now = new Date();
  const start8 = isoDate(new Date(now.getFullYear(), now.getMonth() - 7, 1));
  const start6 = isoDate(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  // Current-month window — used to scope the Closed Admitted funnel bar
  // to "admits closed this month" instead of lifetime counts.
  const monthStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd   = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  // Run independent queries in parallel.
  const [
    leadsRes, leadsPriorRes,
    admitsRes, admitsDigitalRes, admitsBdRes, admitsPriorRes,
    censusRes,
    vobApprovedRes, vobCompletedRes,
    trendRes, stageRes, payerTrendRes,
    closedAdmittedScopedRes,
  ] = await Promise.all([
    // New Leads = rows from Zoho's Leads module ONLY. Deals (which all
    // start as Leads then convert) would double-count if we just counted
    // every fact_pipeline row — stage_key='lead_created' is the canonical
    // marker that a row originated from the Leads module per the
    // warehouse loader's mapping.
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .eq("stage_key", "lead_created")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`),
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .eq("stage_key", "lead_created")
      .gte("lead_created_time", priorFrom).lte("lead_created_time", `${priorTo}T23:59:59`),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to).eq("is_digital", true),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to).eq("channel_group", "BD Referral"),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", priorFrom).lte("admit_date", priorTo),
    fact().from("fact_census").select("program_key, filled, level_of_care").eq("source_tab", "live_adc"),
    fact().from("fact_vob").select("*", { count: "exact", head: true })
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`)
      .not("vob_approved_date", "is", null),
    fact().from("fact_vob").select("*", { count: "exact", head: true })
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`)
      .not("vob_completed_date", "is", null),
    // 8-month admit trend. PostgREST silently caps select() at 1000
    // rows, and ~8 months × ~130 admits/mo ≈ 1040 — over the cap. The
    // truncation drops whichever rows land last in PK order, which is
    // why recent months (April etc.) silently undercounted. Explicit
    // .range() bumps the ceiling well above any realistic 8-month total.
    // Order ascending by admit_date so any future overflow trims the
    // oldest rows first, not the most-recent ones the user is watching.
    fact().from("fact_admit").select("admit_date, channel_group")
      .gte("admit_date", start8)
      .order("admit_date", { ascending: true })
      .range(0, 19999),
    // Current-pipeline-by-stage snapshot. Same truncation risk — every
    // open + closed pipeline row gets pulled. Bump the ceiling.
    fact().from("fact_pipeline").select("stage_key, is_stuck").range(0, 49999),
    fact().from("fact_admit").select("admit_date, payer_type_group")
      .gte("admit_date", start6)
      .order("admit_date", { ascending: true })
      .range(0, 19999),
    // Closed Admitted bar — scoped to current calendar month +
    // Commercial / AHCCCS pipelines per Amber's spec ("closing date for
    // this month and in ahcccs and commercial pipelines"). Replaces the
    // lifetime fact_pipeline stage_key=closed_admitted count in the
    // funnel chart so the bar reflects what BD actually closed this
    // month in the treatment service lines.
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", monthStart).lte("admit_date", monthEnd)
      .in("payer_type_group", ["Commercial", "AHCCCS"]),
  ]);

  // KPI counts.
  const newLeads      = leadsRes.count ?? 0;
  const newLeadsPrior = leadsPriorRes.count ?? 0;
  const admits        = admitsRes.count ?? 0;
  const admitsDigital = admitsDigitalRes.count ?? 0;
  const admitsBd      = admitsBdRes.count ?? 0;
  const admitsPrior   = admitsPriorRes.count ?? 0;
  const vobApproved   = vobApprovedRes.count ?? 0;
  const vobCompleted  = vobCompletedRes.count ?? 0;

  // Census aggregation.
  const census = censusRes.data ?? [];
  const activeCensus  = census.reduce((s, r) => s + (Number(r.filled) || 0), 0);
  const virtualCensus = census
    .filter((r) => String(r.level_of_care ?? "").toUpperCase().startsWith("VIOP"))
    .reduce((s, r) => s + (Number(r.filled) || 0), 0);
  const inPersonCensus = activeCensus - virtualCensus;

  // 8-month admit trend (digital vs BD). Bucket keys use a LOCAL YYYY-MM
  // slice so they match fact_admit.admit_date (a Postgres `date` with no
  // timezone) when sliced as a string. `d.toISOString().slice(0, 7)`
  // would shift to UTC and could disagree with admit_date strings around
  // the month boundary in Phoenix.
  const trendBucket: Record<string, { digital: number; bd: number }> = {};
  const localMk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 7 + i, 1);
    trendBucket[localMk(d)] = { digital: 0, bd: 0 };
  }
  const thisMk = localMk(now);
  for (const r of trendRes.data ?? []) {
    const mk = String(r.admit_date).slice(0, 7);
    if (!trendBucket[mk]) continue;
    if (r.channel_group === "BD Referral") trendBucket[mk].bd += 1;
    else trendBucket[mk].digital += 1;
  }
  // Build labels from a LOCAL Date (year, monthIdx, 1). `new Date("2026-05-01")`
  // parses as UTC midnight, which in Phoenix (UTC−7) renders as Apr 30 and
  // produces "Apr" — shifting every bar one month back. The fix is to
  // construct the Date in local time so the month index is preserved.
  const trend: MonthlySeries[] = Object.entries(trendBucket).map(([m, v]) => {
    const [yy, mm] = m.split("-").map(Number);
    return {
      month: new Date(yy, (mm ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short" }),
      digital: v.digital,
      bd: v.bd,
      isCurrent: m === thisMk,
    };
  });

  // Funnel health.
  const stageMap = new Map<string, number>();
  let stuckTotal = 0;
  for (const r of stageRes.data ?? []) {
    if (r.is_stuck) stuckTotal += 1;
    const key = String(r.stage_key ?? "_unknown");
    stageMap.set(key, (stageMap.get(key) ?? 0) + 1);
  }
  const funnel: StageCount[] = STAGE_ORDER.map((s) => ({
    stageKey: s.key,
    label: s.label,
    // Closed Admitted is special-cased: instead of "lifetime
    // fact_pipeline rows whose current stage = closed_admitted", we
    // use fact_admit filtered to this month + Commercial/AHCCCS so
    // the bar reflects "what we actually closed in treatment lines
    // this month". Every other stage stays as a current-pipeline
    // snapshot count.
    count: s.key === "closed_admitted"
      ? (closedAdmittedScopedRes.count ?? 0)
      : (stageMap.get(s.key) ?? 0),
  }));
  funnel.push({ stageKey: "stuck", label: "Stuck", count: stuckTotal, isStuck: true });

  // Payer trend (6mo). DUI and DV are court-mandated programs tracked
  // as distinct lines of business — they live in their own buckets, not
  // bundled into Cash or Unknown.
  const payerBucket: Record<string, PayerRow> = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    // Bucket key must reflect LOCAL month so it matches the keys we
    // derive from admit_date below (admit_date is a Postgres `date`,
    // stored without timezone, so the YYYY-MM slice is already local).
    // Using d.toISOString() here would shift to UTC and mis-key any
    // month boundary that crosses UTC midnight in Phoenix (UTC−7).
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    payerBucket[`${yy}-${mm}`] = {
      month: d.toLocaleDateString("en-US", { month: "short" }),
      commercial: 0, ahcccs: 0, cash: 0, dui: 0, dv: 0, unknown: 0,
    };
  }
  for (const r of payerTrendRes.data ?? []) {
    const mk = String(r.admit_date).slice(0, 7);
    if (!payerBucket[mk]) continue;
    const p = r.payer_type_group as "Commercial" | "AHCCCS" | "Cash" | "DUI" | "DV" | "Unknown" | null;
    if      (p === "Commercial") payerBucket[mk].commercial += 1;
    else if (p === "AHCCCS")     payerBucket[mk].ahcccs += 1;
    else if (p === "Cash")       payerBucket[mk].cash += 1;
    else if (p === "DUI")        payerBucket[mk].dui = (payerBucket[mk].dui ?? 0) + 1;
    else if (p === "DV")         payerBucket[mk].dv  = (payerBucket[mk].dv  ?? 0) + 1;
    else                         payerBucket[mk].unknown = (payerBucket[mk].unknown ?? 0) + 1;
  }
  const payerTrend = Object.values(payerBucket);

  // Deltas (period-over-period).
  const delta = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
  const vobRate = vobCompleted > 0 ? vobApproved / vobCompleted : null;

  return {
    range,
    kpis: {
      newLeads: { value: newLeads, delta: delta(newLeads, newLeadsPrior), priorValue: newLeadsPrior },
      admits:   { value: admits,   delta: delta(admits, admitsPrior),     digital: admitsDigital, bd: admitsBd },
      census:   { value: activeCensus, virtual: virtualCensus, inPerson: inPersonCensus },
      vobRate:  { value: vobRate,  approved: vobApproved, completed: vobCompleted },
    },
    trend,
    funnel,
    payerTrend,
  };
}

export function useExecutiveSnapshot(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "executive", range.from, range.to],
    queryFn: () => fetchExecutiveSnapshot(range),
    staleTime: 5 * 60_000,
  });
}
