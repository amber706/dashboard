// /bd/refer-out-strategy — outbound referral planning surface.
//
// Two payer rows (Commercial PPO, AHCCCS). Each row has two cards:
//   • New policies in window — fresh deals matching the payer bucket,
//     with LOC requested, current stage / lost reason, and the top 3
//     partner accounts that match (LOC offered + accepts payer +
//     reciprocity-scored in same window).
//   • Referred out in window — deals we sent out with that payer,
//     showing destination, refer-out type, BD rep, date.
//
// Window presets: Today / This week / This month / Last 3 months / Last 6 months.

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2, RefreshCw, ArrowRight, Building2, Sparkles, AlertTriangle, FileSearch } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

type Preset = "today" | "this_week" | "this_month" | "last_month" | "last_3_months" | "last_6_months" | "last_12_months";

interface Window { startIso: string; endIso: string; label: string; }

function startOfDay(d = new Date()): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d = new Date()): Date {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}
function startOfWeek(d = new Date()): Date {
  // Sunday-anchored week (Cornerstone's reporting cadence).
  const r = startOfDay(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}
function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function addMonths(d: Date, n: number): Date {
  const r = new Date(d); r.setMonth(r.getMonth() + n); return r;
}
function isoUtc(d: Date): string {
  return d.toISOString().slice(0, 19) + "+00:00";
}

function computeWindow(p: Preset): Window {
  const now = new Date();
  const end = endOfDay(now);
  switch (p) {
    case "today":          return { startIso: isoUtc(startOfDay(now)),                   endIso: isoUtc(end), label: "Today" };
    case "this_week":      return { startIso: isoUtc(startOfWeek(now)),                  endIso: isoUtc(end), label: "This week" };
    case "this_month":     return { startIso: isoUtc(startOfMonth(now)),                 endIso: isoUtc(end), label: "This month" };
    case "last_month": {
      const start = addMonths(startOfMonth(now), -1);
      const endLast = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { startIso: isoUtc(start), endIso: isoUtc(endLast), label: "Last month" };
    }
    case "last_3_months":  return { startIso: isoUtc(addMonths(startOfMonth(now), -2)),  endIso: isoUtc(end), label: "Last 3 months" };
    case "last_6_months":  return { startIso: isoUtc(addMonths(startOfMonth(now), -5)),  endIso: isoUtc(end), label: "Last 6 months" };
    case "last_12_months": return { startIso: isoUtc(addMonths(startOfMonth(now), -11)), endIso: isoUtc(end), label: "Last 12 months" };
  }
}

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "today",          label: "Today" },
  { key: "this_week",      label: "This week" },
  { key: "this_month",     label: "This month" },
  { key: "last_3_months",  label: "Last 3 months" },
  { key: "last_6_months",  label: "Last 6 months" },
];

// VOB Intelligence has its own window control with a wider set of
// presets, because the user wants to scan VOB cost shape across
// multiple horizons (today's intake, this week, last month, etc.).
const VOB_PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "today",          label: "Today" },
  { key: "this_week",      label: "This week" },
  { key: "this_month",     label: "This month" },
  { key: "last_month",     label: "Last month" },
  { key: "last_3_months",  label: "Last 3 months" },
  { key: "last_6_months",  label: "Last 6 months" },
  { key: "last_12_months", label: "Last 12 months" },
];

interface Suggestion {
  account_id: string;
  account_name: string;
  loc_outbound: string[];
  treats: string[];
  accepts_payer: boolean | null;
  network_relation: "oon_preferred" | "oon" | "inn" | "unknown";
  reciprocity: "Reciprocal" | "Non-Reciprocal" | null;
  age_fit: boolean;
  clinical_fit: boolean;
  referrals_in: number;
  referrals_out: number;
  score: number;
}
interface NewPolicy {
  deal_id: string;
  deal_name: string;
  created_time: string;
  loc_requested: string | null;
  stage: string | null;
  pipeline: string | null;
  lost_reason: string | null;
  insurance_type: string | null;
  policy_type: string | null;
  insurance_provider: string | null;
  age_group: string | null;
  mh_sud_primary: string | null;
  has_multiplan: boolean;
  suggestions: Suggestion[];
}
interface ReferredOut {
  deal_id: string;
  deal_name: string;
  refer_out_date: string | null;
  refer_out_type: string | null;
  loc_requested: string | null;
  stage: string | null;
  insurance_provider: string | null;
  bd_rep: string | null;
  referred_out_id: string | null;
  referred_out_name: string | null;
}
interface StrategyResponse {
  ok: boolean;
  window: { start_iso: string; end_iso: string };
  // OON-eligible commercial: PPO + POS + Multiplan-tagged deals.
  commercial: { new_policies: NewPolicy[]; referred_out: ReferredOut[] };
  // INN-only commercial: HMO + EPO. No referred_out tab — INN partners
  // who took the patient typically don't show up as a refer-out in our
  // outbound stream.
  commercial_inn: { new_policies: NewPolicy[] };
  ahcccs:     { new_policies: NewPolicy[]; referred_out: ReferredOut[] };
  partners_considered: number;
  error?: string;
}

interface VobFlags {
  inn_only: boolean;
  oon_eligible: boolean;
  pos_check: boolean;
  high_responsibility: boolean;
}
interface VobRow {
  vob_id: string;
  vob_name: string | null;
  created_time: string | null;
  patient_name: string | null;
  patient_state: string | null;
  policy_type: string | null;
  network: "ppo" | "hmo" | "epo" | "pos" | "unknown";
  insurance_provider: string | null;
  insurance_type: string | null;
  vob_status: string | null;
  vob_level_of_care: string | null;
  total_patient_responsibility: number | null;
  coinsurance_pct: number | null;
  oop_max: number | null;
  oop_remaining: number | null;
  deductible_remaining: number | null;
  deal_id: string | null;
  deal_name: string | null;
  deal_stage: string | null;
  deal_pipeline: string | null;
  deal_insurance_type: string | null;
  flags: VobFlags;
}
interface VobResponse {
  ok: boolean;
  window: { start_iso: string; end_iso: string };
  threshold: { large_responsibility: number };
  vobs: VobRow[];
  totals: {
    count: number;
    inn_only: number;
    oon_eligible: number;
    pos_check: number;
    high_responsibility: number;
  };
  error?: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Stages that count as "closed lost" — show Lost_Reasoning when present.
const LOST_STAGE_KEYWORDS = ["Lost", "Closed Lost", "Referred Out", "Stuck"];
function isLost(stage: string | null): boolean {
  if (!stage) return false;
  return LOST_STAGE_KEYWORDS.some((k) => stage.includes(k));
}

function stageTone(stage: string | null): string {
  if (!stage) return "border-muted text-muted-foreground";
  if (stage.startsWith("Closed Won") || stage.startsWith("Closed - Sold") || stage.startsWith("Closed - Admitted") || stage.startsWith("Closed - Screening") || stage.startsWith("Closed - Both") || stage.startsWith("Closed - Classes"))
    return "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5";
  if (isLost(stage))
    return "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5";
  return "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5";
}

function ZohoDealLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <a href={`https://crm.zoho.com/crm/tab/Potentials/${id}`} target="_blank" rel="noopener noreferrer"
       className="hover:underline text-primary">
      {children}
    </a>
  );
}

function NewPoliciesCard({ title, rows, bucketLabel }: { title: string; rows: NewPolicy[]; bucketLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          {title}
          <Badge variant="outline" className="ml-2 text-[10px]">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          {bucketLabel} deals created in window. Suggestions rank by the Account's Reciprocity picklist (Reciprocal first, then unverified, never Non-Reciprocal) plus LOC, network shape (OON-friendly for PPO/POS/Multiplan, in-network for HMO/EPO, in-plan for AHCCCS), age, and clinical primary. Window-scoped referrals_in × 2 − referrals_out breaks ties.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No new {bucketLabel.toLowerCase()} deals in this window.</p>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.deal_id} className="border rounded-md p-3 bg-card/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <ZohoDealLink id={r.deal_id}>
                      <span className="font-medium text-sm">{r.deal_name ?? "(no name)"}</span>
                    </ZohoDealLink>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                      <span>{fmtDate(r.created_time)}</span>
                      {r.insurance_provider && <span>· {r.insurance_provider}</span>}
                      {r.policy_type && r.policy_type !== "Not Applicable" && <span>· {r.policy_type}</span>}
                      {/* Multiplan = third-party OON wrap network. Detected
                          via substring match on VOB notes. Visible signal
                          that this caller has OON access even if Policy_Type
                          isn't tagged PPO/POS. */}
                      {r.has_multiplan && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">Multiplan</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {r.loc_requested && (
                      <Badge variant="outline" className="text-[10px]">{r.loc_requested}</Badge>
                    )}
                    {r.stage && (
                      <Badge variant="outline" className={`text-[10px] ${stageTone(r.stage)}`}>{r.stage}</Badge>
                    )}
                  </div>
                </div>
                {/* Caller-side tags that drive partner matching: age
                    population and clinical primary. If neither is set
                    we hide the row so we don't broadcast blanks. */}
                {(r.age_group || r.mh_sud_primary) && (
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {r.age_group && (
                      <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-700 dark:text-violet-300">
                        {r.age_group.includes("Adolescent") ? "Adolescent" : "Adult"}
                      </Badge>
                    )}
                    {r.mh_sud_primary && (
                      <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                        {r.mh_sud_primary.includes("SUD") ? "SUD primary" : "MH primary"}
                      </Badge>
                    )}
                  </div>
                )}
                {isLost(r.stage) && r.lost_reason && (
                  <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-400">
                    Lost reason: <span className="font-medium">{r.lost_reason}</span>
                  </div>
                )}
                {r.suggestions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-dashed">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Top partners</div>
                    <div className="space-y-1">
                      {r.suggestions.map((s, i) => (
                        <Link key={s.account_id} href={`/bd/account?id=${s.account_id}`}>
                          <a className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded hover:bg-accent">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="text-muted-foreground tabular-nums w-3">{i + 1}.</span>
                              <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{s.account_name}</span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
                              {/* Reciprocity tier — BD-curated picklist on
                                  the Account. "Reciprocal" is the strong
                                  signal; null/unset gets a softer treatment
                                  so the BD team sees who needs tagging. */}
                              {s.reciprocity === "Reciprocal" && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400" title="Reciprocity picklist set to Reciprocal in Zoho">reciprocal</Badge>
                              )}
                              {s.reciprocity === null && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/30 text-amber-700 dark:text-amber-400" title="Reciprocity not set on this Account in Zoho — BD team should tag">unverified</Badge>
                              )}
                              {/* Population + clinical fit indicators —
                                  match-checks done on the edge against
                                  the caller's Age_Group and MH/SUD
                                  primary. Only render when there's a
                                  caller-side signal to match against. */}
                              {r.age_group && s.age_fit && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-violet-500/30 text-violet-700 dark:text-violet-300">
                                  {r.age_group.includes("Adolescent") ? "adol" : "adult"}
                                </Badge>
                              )}
                              {r.mh_sud_primary && s.clinical_fit && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                                  {r.mh_sud_primary.includes("SUD") ? "SUD" : "MH"}
                                </Badge>
                              )}
                              {s.network_relation === "oon_preferred" && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" title="Partner has this carrier on their OON Preferred Policies list">OON pref</Badge>
                              )}
                              {s.network_relation === "oon" && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-blue-500/30 text-blue-700 dark:text-blue-400" title="Partner is out-of-network for this carrier">OON</Badge>
                              )}
                              {s.network_relation === "inn" && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/30 text-amber-700 dark:text-amber-400" title="Partner is in-network for this carrier">INN</Badge>
                              )}
                              <span>in {s.referrals_in} · out {s.referrals_out}</span>
                            </span>
                          </a>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {r.suggestions.length === 0 && (
                  <div className="mt-2 text-[11px] text-muted-foreground italic">
                    No partner accounts in Zoho match LOC + payer for this deal.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReferredOutCard({ title, rows, bucketLabel }: { title: string; rows: ReferredOut[]; bucketLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-primary" />
          {title}
          <Badge variant="outline" className="ml-2 text-[10px]">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          {bucketLabel} deals with a Refer Out Date in window. "Refer-out reason" is the Zoho Refer Out Type field (Detox/Residential/Psych × Attached/Unattached).
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No outbound {bucketLabel.toLowerCase()} referrals in this window.</p>
        ) : (
          <div className="max-h-[600px] overflow-y-auto pr-1">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-background">
                <tr>
                  <th className="text-left py-1.5 pr-2">Deal</th>
                  <th className="text-left py-1.5 pr-2">Sent to</th>
                  <th className="text-left py-1.5 pr-2">LOC</th>
                  <th className="text-left py-1.5 pr-2">Refer-out reason</th>
                  <th className="text-left py-1.5 pr-2">BD rep</th>
                  <th className="text-right py-1.5">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.deal_id} className="border-t">
                    <td className="py-1.5 pr-2 font-medium">
                      <ZohoDealLink id={r.deal_id}>{r.deal_name ?? "(no name)"}</ZohoDealLink>
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.referred_out_id && r.referred_out_name ? (
                        <Link href={`/bd/account?id=${r.referred_out_id}`}>
                          <a className="text-primary hover:underline">{r.referred_out_name}</a>
                        </Link>
                      ) : (r.referred_out_name ?? "—")}
                    </td>
                    <td className="py-1.5 pr-2">{r.loc_requested ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.refer_out_type ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.bd_rep ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtDate(r.refer_out_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VobIntelligenceCard({
  preset, onPresetChange, data, loading, error,
}: {
  preset: Preset;
  onPresetChange: (p: Preset) => void;
  data: VobResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const fmtMoney = (n: number | null) => n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
  const networkBadge = (network: VobRow["network"], policy: string | null) => {
    if (network === "ppo") return <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">PPO</Badge>;
    if (network === "hmo") return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">HMO</Badge>;
    if (network === "epo") return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">EPO</Badge>;
    if (network === "pos") return <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-700 dark:text-blue-400">POS</Badge>;
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">{policy ?? "—"}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-primary" />
          VOB Intelligence
          {data && <Badge variant="outline" className="ml-2 text-[10px]">{data.totals.count}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Commercial VOBs submitted in window. Network shape derived from Policy_Type: PPO carries OON benefits, HMO/EPO are in-network only, POS varies (verify).
          Large patient responsibility threshold: ${data?.threshold.large_responsibility.toLocaleString() ?? "5,000"}+.
        </p>
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {VOB_PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              onClick={() => onPresetChange(p.key)}
              className="h-7 text-[11px] px-2"
            >
              {p.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {error && (
          <div className="text-sm text-rose-700 dark:text-rose-400 py-2">{error}</div>
        )}
        {loading && !data && (
          <div className="py-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading VOBs…</div>
        )}
        {data && data.vobs.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No commercial VOBs in this window.</p>
        )}
        {data && data.vobs.length > 0 && (
          <>
            {/* Quick summary chips — totals across the loaded set */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3 text-[11px]">
              <span className="text-muted-foreground">Flagged:</span>
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">{data.totals.oon_eligible} PPO/OON</Badge>
              <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">{data.totals.inn_only} INN-only</Badge>
              <Badge variant="outline" className="border-blue-500/30 text-blue-700 dark:text-blue-400">{data.totals.pos_check} POS verify</Badge>
              <Badge variant="outline" className="border-rose-500/30 text-rose-700 dark:text-rose-400">{data.totals.high_responsibility} {">$"}{(data.threshold.large_responsibility / 1000).toFixed(0)}k cost</Badge>
            </div>
            <div className="max-h-[600px] overflow-y-auto pr-1">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-background">
                  <tr>
                    <th className="text-left py-1.5 pr-2">Patient</th>
                    <th className="text-left py-1.5 pr-2">Carrier</th>
                    <th className="text-left py-1.5 pr-2">Plan</th>
                    <th className="text-left py-1.5 pr-2">LOC</th>
                    <th className="text-left py-1.5 pr-2">Disposition</th>
                    <th className="text-right py-1.5 pr-2">Patient resp.</th>
                    <th className="text-left py-1.5 pr-2">Flags</th>
                    <th className="text-right py-1.5">VOB date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vobs.map((v) => {
                    const activeFlags: Array<{ key: string; label: string; tone: string }> = [];
                    if (v.flags.high_responsibility) activeFlags.push({ key: "cost", label: `${fmtMoney(v.total_patient_responsibility)}+ cost`, tone: "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5" });
                    if (v.flags.inn_only) activeFlags.push({ key: "inn", label: "INN-only", tone: "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5" });
                    if (v.flags.pos_check) activeFlags.push({ key: "pos", label: "POS verify", tone: "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5" });
                    return (
                      <tr key={v.vob_id} className="border-t align-top hover:bg-accent/20">
                        <td className="py-1.5 pr-2 font-medium">
                          {v.deal_id ? <ZohoDealLink id={v.deal_id}>{v.patient_name ?? v.deal_name ?? "(no name)"}</ZohoDealLink> : (v.patient_name ?? "—")}
                        </td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{v.insurance_provider ?? "—"}</td>
                        <td className="py-1.5 pr-2">{networkBadge(v.network, v.policy_type)}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{v.vob_level_of_care ?? "—"}</td>
                        <td className="py-1.5 pr-2">
                          {v.deal_stage ? <Badge variant="outline" className={`text-[10px] ${stageTone(v.deal_stage)}`}>{v.deal_stage}</Badge> : "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                          {v.total_patient_responsibility != null && v.total_patient_responsibility >= 5000 ? (
                            <span className="text-rose-700 dark:text-rose-400">{fmtMoney(v.total_patient_responsibility)}</span>
                          ) : fmtMoney(v.total_patient_responsibility)}
                        </td>
                        <td className="py-1.5 pr-2">
                          {activeFlags.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {activeFlags.map((f) => (
                                <Badge key={f.key} variant="outline" className={`text-[9px] gap-1 ${f.tone}`}>
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  {f.label}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtDate(v.created_time)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function BdReferOutStrategy() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const win = useMemo(() => computeWindow(preset), [preset]);
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // VOB Intelligence has its own window (defaults to "today") so the
  // BD lead can scan today's incoming VOBs without resetting the
  // strategy view's window.
  const [vobPreset, setVobPreset] = useState<Preset>("today");
  const vobWin = useMemo(() => computeWindow(vobPreset), [vobPreset]);
  const [vobData, setVobData] = useState<VobResponse | null>(null);
  const [vobLoading, setVobLoading] = useState(true);
  const [vobError, setVobError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-refer-out-strategy`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ start_iso: win.startIso, end_iso: win.endIso }),
      });
      const json = (await res.json()) as StrategyResponse;
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [win.startIso, win.endIso]);

  const loadVobs = useCallback(async () => {
    setVobLoading(true);
    setVobError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-vob-intelligence`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ start_iso: vobWin.startIso, end_iso: vobWin.endIso }),
      });
      const json = (await res.json()) as VobResponse;
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setVobData(json);
    } catch (e) {
      setVobError(e instanceof Error ? e.message : String(e));
    } finally {
      setVobLoading(false);
    }
  }, [vobWin.startIso, vobWin.endIso]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVobs(); }, [loadVobs]);

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Refer Out Strategy"
      subtitle="Outbound planning: what's coming in by payer, who we already sent out, and which partners best match by LOC + insurance + reciprocity."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <ArrowLeft className="w-3.5 h-3.5" /> Performance
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? "default" : "outline"}
            onClick={() => setPreset(p.key)}
            className="h-8 text-xs"
          >
            {p.label}
          </Button>
        ))}
        {data && (
          <span className="ml-2 text-[11px] text-muted-foreground">
            {data.partners_considered} partner accounts considered
          </span>
        )}
      </div>

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-rose-700 dark:text-rose-400">
            Failed to load: {error}
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…
        </CardContent></Card>
      )}

      {/* VOB Intelligence — independent window (defaults to "Today"). */}
      <VobIntelligenceCard
        preset={vobPreset}
        onPresetChange={setVobPreset}
        data={vobData}
        loading={vobLoading}
        error={vobError}
      />

      {data && (
        <div className="space-y-6">
          {/* Commercial OON row — PPO + POS + Multiplan. Two cards. */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Commercial · OON-eligible (PPO, POS, Multiplan)</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NewPoliciesCard title="New OON-eligible policies" rows={data.commercial.new_policies} bucketLabel="Commercial OON" />
              <ReferredOutCard title="Commercial referrals sent out" rows={data.commercial.referred_out} bucketLabel="Commercial" />
            </div>
          </div>
          {/* Commercial INN row — HMO + EPO. Single card; INN partners
              taken in-network typically don't surface as refer-outs. */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Commercial · In-network only (HMO, EPO)</h2>
            <div className="grid grid-cols-1 gap-4">
              <NewPoliciesCard title="New in-network-only policies" rows={data.commercial_inn.new_policies} bucketLabel="Commercial INN" />
            </div>
          </div>
          {/* AHCCCS row */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">AHCCCS</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NewPoliciesCard title="New AHCCCS deals" rows={data.ahcccs.new_policies} bucketLabel="AHCCCS" />
              <ReferredOutCard title="AHCCCS referrals sent out" rows={data.ahcccs.referred_out} bucketLabel="AHCCCS" />
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
