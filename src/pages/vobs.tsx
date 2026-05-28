// /vobs — All VOBs module under Admissions.
//
// Every Verification_of_Benefits record submitted in window. Unlike
// /bd/refer-out-strategy's VOB Intelligence card (which filters to
// Commercial-only), this surface shows everything — commercial,
// AHCCCS, and anything else — with top-level filters for payer
// bucket, network (PPO/HMO/EPO/POS), carrier, and Level of Care.
//
// Filters all run client-side over the in-memory list so toggling
// is instant. Only the date window triggers a refetch.
//
// Backed by the bd-vob-intelligence edge function with
// commercial_only:false so AHCCCS VOBs come through.

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Loader2, RefreshCw, FileSearch, AlertTriangle, Download,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";

type Preset =
  | "today"
  | "this_week"
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "last_6_months"
  | "last_12_months";

interface Win { startIso: string; endIso: string; label: string; }

function startOfDay(d = new Date()): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d = new Date()): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function startOfWeek(d = new Date()): Date {
  const r = startOfDay(d); r.setDate(r.getDate() - r.getDay()); return r;
}
function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function addMonths(d: Date, n: number): Date { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function isoUtc(d: Date): string { return d.toISOString().slice(0, 19) + "+00:00"; }

function computeWindow(p: Preset): Win {
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
  { key: "last_month",     label: "Last month" },
  { key: "last_3_months",  label: "Last 3 months" },
  { key: "last_6_months",  label: "Last 6 months" },
  { key: "last_12_months", label: "Last 12 months" },
];

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
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtMoney(n: number | null): string {
  return n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
}

// Bucket a VOB into a top-level payer family. AHCCCS is detected from
// either VOB_Insurance_Type or the parent deal's Insurance_Type, so
// rows that are still tagged Commercial on the VOB but AHCCCS on the
// deal (or vice versa) land in the right pile.
type PayerBucket = "commercial" | "ahcccs" | "other";
function classifyPayer(v: VobRow): PayerBucket {
  const t = (v.insurance_type ?? "").toLowerCase();
  const dt = (v.deal_insurance_type ?? "").toLowerCase();
  if (t.includes("ahcccs") || dt.includes("ahcccs")) return "ahcccs";
  if (t.includes("commercial") || dt.includes("commercial")) return "commercial";
  return "other";
}

function networkBadge(network: VobRow["network"], policy: string | null) {
  if (network === "ppo") return <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">PPO</Badge>;
  if (network === "hmo") return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">HMO</Badge>;
  if (network === "epo") return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">EPO</Badge>;
  if (network === "pos") return <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-700 dark:text-blue-400">POS</Badge>;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">{policy ?? "—"}</Badge>;
}

function payerBadge(b: PayerBucket) {
  if (b === "commercial") return <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-700 dark:text-violet-300">Commercial</Badge>;
  if (b === "ahcccs") return <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-700 dark:text-sky-300">AHCCCS</Badge>;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Other</Badge>;
}

function ZohoDealLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <a href={`https://crm.zoho.com/crm/tab/Potentials/${id}`} target="_blank" rel="noopener noreferrer"
       className="hover:underline text-primary">
      {children}
    </a>
  );
}

export default function AllVobs() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const win = useMemo(() => computeWindow(preset), [preset]);
  const [data, setData] = useState<VobResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Top-level filter bar (single-select chips). "" = no filter.
  const [fPayer, setFPayer] = useState<"" | PayerBucket>("");
  const [fNetwork, setFNetwork] = useState<"" | "ppo" | "hmo" | "epo" | "pos">("");
  const [fCarrier, setFCarrier] = useState<string>("");
  const [fLoc, setFLoc] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-vob-intelligence`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          start_iso: win.startIso,
          end_iso: win.endIso,
          commercial_only: false,
        }),
      });
      const json = (await res.json()) as VobResponse;
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [win.startIso, win.endIso]);

  useEffect(() => { load(); }, [load]);

  // Distinct values for the carrier + LOC dropdowns, computed from the
  // full loaded set (not the filtered list) so the user can always see
  // every option that exists in the window.
  const carrierOptions = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.vobs.map((v) => v.insurance_provider).filter((x): x is string => !!x))).sort();
  }, [data]);
  const locOptions = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.vobs.map((v) => v.vob_level_of_care).filter((x): x is string => !!x))).sort();
  }, [data]);

  // Apply all four filters in one pass.
  const filtered = useMemo(() => {
    if (!data) return [] as VobRow[];
    return data.vobs.filter((v) => {
      if (fPayer && classifyPayer(v) !== fPayer) return false;
      if (fNetwork && v.network !== fNetwork) return false;
      if (fCarrier && v.insurance_provider !== fCarrier) return false;
      if (fLoc && v.vob_level_of_care !== fLoc) return false;
      return true;
    });
  }, [data, fPayer, fNetwork, fCarrier, fLoc]);

  const hasFilters = !!(fPayer || fNetwork || fCarrier || fLoc);
  const clearFilters = () => { setFPayer(""); setFNetwork(""); setFCarrier(""); setFLoc(""); };

  // Bucket counts for the payer chip row — based on the loaded set,
  // not the filtered list, so the chips always show the underlying
  // distribution (the chips are filters, not output).
  const payerCounts = useMemo(() => {
    const c = { commercial: 0, ahcccs: 0, other: 0 };
    if (data) for (const v of data.vobs) c[classifyPayer(v)]++;
    return c;
  }, [data]);

  const networkCounts = useMemo(() => {
    const c = { ppo: 0, hmo: 0, epo: 0, pos: 0 };
    if (data) for (const v of data.vobs) {
      if (v.network === "ppo") c.ppo++;
      else if (v.network === "hmo") c.hmo++;
      else if (v.network === "epo") c.epo++;
      else if (v.network === "pos") c.pos++;
    }
    return c;
  }, [data]);

  const downloadCsv = () => {
    if (!filtered.length) return;
    const headers = [
      "VOB date", "Patient", "Payer bucket", "Carrier", "Plan / Network",
      "Policy type", "LOC requested", "VOB status", "Patient resp.",
      "Coinsurance %", "OOP max", "OOP remaining", "Deductible remaining",
      "Deal", "Deal stage", "Deal pipeline", "Deal insurance type",
    ];
    const rows = filtered.map((v) => [
      v.created_time ?? "",
      v.patient_name ?? "",
      classifyPayer(v),
      v.insurance_provider ?? "",
      v.network.toUpperCase(),
      v.policy_type ?? "",
      v.vob_level_of_care ?? "",
      v.vob_status ?? "",
      v.total_patient_responsibility ?? "",
      v.coinsurance_pct ?? "",
      v.oop_max ?? "",
      v.oop_remaining ?? "",
      v.deductible_remaining ?? "",
      v.deal_name ?? "",
      v.deal_stage ?? "",
      v.deal_pipeline ?? "",
      v.deal_insurance_type ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => {
        const s = String(cell ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all-vobs-${win.label.toLowerCase().replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell
      eyebrow="ADMISSIONS"
      title="All VOBs"
      subtitle="Every Verification of Benefits submitted in the selected window — commercial, AHCCCS, and other. Filter by payer bucket, plan network, carrier, or Level of Care."
      maxWidth={1400}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!filtered.length} className="gap-1.5 h-9">
            <Download className="w-3.5 h-3.5" />
            Download CSV
          </Button>
        </div>
      }
    >
      {/* Window preset row */}
      <div className="space-y-2">
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
        </div>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-primary" />
            All VOBs
            {data && <Badge variant="outline" className="ml-2 text-[10px]">{data.totals.count}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Filter chips — payer bucket */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">Payer</span>
            <Button size="sm" variant={fPayer === "" ? "default" : "outline"} onClick={() => setFPayer("")} className="h-7 text-[11px] px-2">
              All {data ? <Badge variant="outline" className="ml-1 text-[9px]">{data.totals.count}</Badge> : null}
            </Button>
            <Button size="sm" variant={fPayer === "commercial" ? "default" : "outline"} onClick={() => setFPayer("commercial")} className="h-7 text-[11px] px-2">
              Commercial <Badge variant="outline" className="ml-1 text-[9px]">{payerCounts.commercial}</Badge>
            </Button>
            <Button size="sm" variant={fPayer === "ahcccs" ? "default" : "outline"} onClick={() => setFPayer("ahcccs")} className="h-7 text-[11px] px-2">
              AHCCCS <Badge variant="outline" className="ml-1 text-[9px]">{payerCounts.ahcccs}</Badge>
            </Button>
            <Button size="sm" variant={fPayer === "other" ? "default" : "outline"} onClick={() => setFPayer("other")} className="h-7 text-[11px] px-2">
              Other <Badge variant="outline" className="ml-1 text-[9px]">{payerCounts.other}</Badge>
            </Button>
          </div>

          {/* Filter chips — network shape */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">Network</span>
            <Button size="sm" variant={fNetwork === "" ? "default" : "outline"} onClick={() => setFNetwork("")} className="h-7 text-[11px] px-2">
              All
            </Button>
            <Button size="sm" variant={fNetwork === "ppo" ? "default" : "outline"} onClick={() => setFNetwork("ppo")} className="h-7 text-[11px] px-2">
              PPO <Badge variant="outline" className="ml-1 text-[9px]">{networkCounts.ppo}</Badge>
            </Button>
            <Button size="sm" variant={fNetwork === "hmo" ? "default" : "outline"} onClick={() => setFNetwork("hmo")} className="h-7 text-[11px] px-2">
              HMO <Badge variant="outline" className="ml-1 text-[9px]">{networkCounts.hmo}</Badge>
            </Button>
            <Button size="sm" variant={fNetwork === "epo" ? "default" : "outline"} onClick={() => setFNetwork("epo")} className="h-7 text-[11px] px-2">
              EPO <Badge variant="outline" className="ml-1 text-[9px]">{networkCounts.epo}</Badge>
            </Button>
            <Button size="sm" variant={fNetwork === "pos" ? "default" : "outline"} onClick={() => setFNetwork("pos")} className="h-7 text-[11px] px-2">
              POS <Badge variant="outline" className="ml-1 text-[9px]">{networkCounts.pos}</Badge>
            </Button>
          </div>

          {/* Carrier + LOC selects */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Carrier</span>
              <select
                value={fCarrier}
                onChange={(e) => setFCarrier(e.target.value)}
                className="h-7 text-[11px] px-2 rounded-md border bg-background min-w-[180px]"
              >
                <option value="">All carriers</option>
                {carrierOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">LOC requested</span>
              <select
                value={fLoc}
                onChange={(e) => setFLoc(e.target.value)}
                className="h-7 text-[11px] px-2 rounded-md border bg-background min-w-[160px]"
              >
                <option value="">All levels</option>
                {locOptions.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            {hasFilters && (
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <div className="ml-auto text-[11px] text-muted-foreground">
              {loading ? "Loading…" : data ? (
                hasFilters
                  ? <>Showing <span className="font-medium text-foreground">{filtered.length}</span> of {data.totals.count}</>
                  : <>{data.totals.count} VOB{data.totals.count === 1 ? "" : "s"}</>
              ) : null}
            </div>
          </div>

          {loading && !data && (
            <div className="py-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading VOBs…</div>
          )}
          {data && data.vobs.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-6 text-center">No VOBs submitted in this window.</p>
          )}
          {data && filtered.length === 0 && data.vobs.length > 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">No VOBs match these filters.</p>
          )}

          {filtered.length > 0 && (
            <div className="max-h-[700px] overflow-y-auto pr-1 -mx-2">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-background z-10">
                  <tr>
                    <th className="text-left py-1.5 px-2">VOB date</th>
                    <th className="text-left py-1.5 px-2">Patient</th>
                    <th className="text-left py-1.5 px-2">Payer</th>
                    <th className="text-left py-1.5 px-2">Carrier</th>
                    <th className="text-left py-1.5 px-2">Network</th>
                    <th className="text-left py-1.5 px-2">LOC requested</th>
                    <th className="text-left py-1.5 px-2">VOB status</th>
                    <th className="text-right py-1.5 px-2">Patient resp.</th>
                    <th className="text-left py-1.5 px-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => {
                    const bucket = classifyPayer(v);
                    const activeFlags: Array<{ key: string; label: string; tone: string }> = [];
                    if (v.flags.high_responsibility) activeFlags.push({ key: "cost", label: `${fmtMoney(v.total_patient_responsibility)}+`, tone: "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5" });
                    if (v.flags.inn_only) activeFlags.push({ key: "inn", label: "INN-only", tone: "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5" });
                    if (v.flags.pos_check) activeFlags.push({ key: "pos", label: "POS verify", tone: "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5" });
                    if (v.flags.oon_eligible) activeFlags.push({ key: "oon", label: "OON-eligible", tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5" });
                    return (
                      <tr key={v.vob_id} className="border-t align-top hover:bg-accent/20">
                        <td className="py-1.5 px-2 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(v.created_time)}</td>
                        <td className="py-1.5 px-2 font-medium">
                          {v.deal_id
                            ? <ZohoDealLink id={v.deal_id}>{v.patient_name ?? v.deal_name ?? "(no name)"}</ZohoDealLink>
                            : (v.patient_name ?? "—")}
                        </td>
                        <td className="py-1.5 px-2">{payerBadge(bucket)}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{v.insurance_provider ?? "—"}</td>
                        <td className="py-1.5 px-2">{networkBadge(v.network, v.policy_type)}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{v.vob_level_of_care ?? "—"}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{v.vob_status ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                          {v.total_patient_responsibility != null && v.total_patient_responsibility >= 5000 ? (
                            <span className="text-rose-700 dark:text-rose-400">{fmtMoney(v.total_patient_responsibility)}</span>
                          ) : fmtMoney(v.total_patient_responsibility)}
                        </td>
                        <td className="py-1.5 px-2">
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
