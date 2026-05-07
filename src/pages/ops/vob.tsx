// /ops/vob — Verification of Benefits queue, sourced from Zoho Deals.
//
// The previous version queried public.leads.vob_status — an in-app
// phantom queue that only contained leads where someone had clicked
// the VOB modal in the dashboard. Completely disconnected from where
// the team actually runs VOBs. This rewrite reads the real pipeline
// from Zoho Deals via the vob-queue edge function:
//
//   - Commercial-Cash deals     → VOB needed, status driven by
//                                 Deal.VOB_Submitted_Date.
//   - AHCCCS deals              → "not required" — AHCCCS rolls
//                                 in-network automatically.
//   - DUI / DV / closed deals   → excluded from the queue entirely.
//
// Per-rep view: managers can see at a glance who has the longest
// pending queue, click into a single rep, and the list filters down.
// Same shape as /bd/meetings.
//
// Editing: VOBs are completed in Zoho, not here. Each row links to
// the deal in Zoho's Potentials tab.

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ShieldCheck, Loader2, ExternalLink, RefreshCw, AlertCircle,
  CheckCircle2, Clock, Download, X, User as UserIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";
import { downloadCsv } from "@/lib/csv-export";

type VobStatus = "pending" | "verified" | "not_required";

interface VobDeal {
  id: string;
  deal_name: string | null;
  stage: string | null;
  pipeline: string | null;
  bd_rep: string | null;
  owner_id: string | null;
  owner_name: string | null;
  vob_status: VobStatus;
  vob_submitted_date: string | null;
  insurance_type: string | null;
  ahcccs_provider: string | null;
  level_of_care: string | null;
  created_time: string | null;
  modified_time: string | null;
  days_pending: number | null;
}

interface RepSummary {
  owner_id: string;
  name: string;
  pending: number;
  verified: number;
  not_required: number;
  total: number;
  oldest_pending_days: number | null;
}

interface VobQueueResponse {
  ok: boolean;
  deals: VobDeal[];
  reps: RepSummary[];
  totals: { pending: number; verified: number; not_required: number; total: number };
  users: Record<string, { full_name: string | null; email: string | null }>;
  error?: string;
}

type StatusFilter = "all" | VobStatus;

const STATUS_META: Record<VobStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  pending: {
    label: "Pending",
    tone: "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5",
    icon: <Clock className="w-3 h-3" />,
  },
  verified: {
    label: "Verified",
    tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  not_required: {
    label: "Not required",
    tone: "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5",
    icon: <ShieldCheck className="w-3 h-3" />,
  },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function OpsVob() {
  const [data, setData] = useState<VobQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [days, setDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vob-queue`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ days }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const filteredDeals = useMemo(() => {
    if (!data) return [];
    let rows = data.deals;
    if (statusFilter !== "all") rows = rows.filter((d) => d.vob_status === statusFilter);
    if (selectedRepId) rows = rows.filter((d) => d.owner_id === selectedRepId);
    // Sort: pending oldest first (those need attention), then verified
    // newest first, then not-required by recency.
    return rows.slice().sort((a, b) => {
      if (a.vob_status === "pending" && b.vob_status === "pending") {
        return (b.days_pending ?? 0) - (a.days_pending ?? 0);
      }
      if (a.vob_status !== b.vob_status) {
        const order: Record<VobStatus, number> = { pending: 0, verified: 1, not_required: 2 };
        return order[a.vob_status] - order[b.vob_status];
      }
      return (b.modified_time ?? "").localeCompare(a.modified_time ?? "");
    });
  }, [data, statusFilter, selectedRepId]);

  function exportCsv() {
    if (!filteredDeals.length) return;
    downloadCsv<VobDeal>(
      `vob-queue-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredDeals,
      [
        { key: "vob_status", label: "Status" },
        { key: "deal_name", label: "Deal" },
        { key: "pipeline", label: "Pipeline" },
        { key: "insurance_type", label: "Insurance" },
        { key: "ahcccs_provider", label: "AHCCCS provider" },
        { key: "level_of_care", label: "LOC" },
        { key: "owner_name", label: "Owner" },
        { key: "bd_rep", label: "BD rep" },
        { key: "stage", label: "Stage" },
        { key: "days_pending", label: "Days pending" },
        { key: "vob_submitted_date", label: "VOB submitted" },
        { key: "created_time", label: "Created" },
        { key: "id", label: "Zoho ID" },
      ],
    );
  }

  const selectedRep = selectedRepId && data
    ? data.reps.find((r) => r.owner_id === selectedRepId) ?? null
    : null;

  return (
    <PageShell
      eyebrow="04 — VERIFICATION"
      title="VOB queue"
      subtitle="Insurance verification before intake. Pulled from Zoho Deals — Commercial-Cash deals need a VOB; AHCCCS deals are auto in-network. Run actual VOBs in Zoho; this surface tells you which deals are open."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredDeals.length} className="gap-1.5 h-9">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      }
    >
      {/* Lookback window */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lookback</span>
        {[30, 60, 90, 180].map((d) => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)} className="h-8 text-xs">
            {d} days
          </Button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-2">
          deals modified in window — terminal stages (Closed / Referred Out) excluded
        </span>
      </div>

      {/* Top-line totals */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile label="Pending" value={data.totals.pending} tone="amber"
            sub="awaiting verification" />
          <KpiTile label="Verified" value={data.totals.verified} tone="emerald"
            sub="VOB date set" />
          <KpiTile label="Not required" value={data.totals.not_required} tone="blue"
            sub="AHCCCS auto in-network" />
          <KpiTile label="Total in queue" value={data.totals.total} tone="default"
            sub={`${days}-day window`} />
        </div>
      )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </CardContent>
        </Card>
      )}

      {/* Per-rep summary — also acts as the rep selector. Click a row
          to filter the deal list to that rep; click the All chip to
          clear. Same shape as /bd/meetings. */}
      {data && data.reps.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">By rep</span>
              <Button
                size="sm"
                variant={selectedRepId === null ? "default" : "outline"}
                onClick={() => setSelectedRepId(null)}
                className="h-7 text-[11px] px-2"
              >
                All ({data.reps.length})
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Click a row to filter
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-1.5 pr-3">Rep</th>
                    <th className="text-right py-1.5 pr-3">Pending</th>
                    <th className="text-right py-1.5 pr-3">Verified</th>
                    <th className="text-right py-1.5 pr-3">Not required</th>
                    <th className="text-right py-1.5 pr-3">Total</th>
                    <th className="text-right py-1.5 pr-3">Oldest pending</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.reps.map((r) => {
                    const selected = selectedRepId === r.owner_id;
                    return (
                      <tr
                        key={r.owner_id}
                        onClick={() => setSelectedRepId(selected ? null : r.owner_id)}
                        className={`border-t cursor-pointer transition-colors ${selected ? "bg-primary/10" : "hover:bg-accent/30"}`}
                      >
                        <td className="py-1.5 pr-3 font-medium text-sm">
                          <span className="inline-flex items-center gap-1.5">
                            <UserIcon className="w-3 h-3 text-muted-foreground" />
                            {r.name}
                          </span>
                        </td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums text-sm ${r.pending > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                          {r.pending}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sm text-muted-foreground">{r.verified}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sm text-muted-foreground">{r.not_required}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sm font-semibold">{r.total}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums text-xs ${(r.oldest_pending_days ?? 0) > 7 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
                          {r.oldest_pending_days != null ? `${r.oldest_pending_days}d` : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          {selected && <X className="w-3.5 h-3.5 text-primary inline" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(["pending", "verified", "not_required", "all"] as const).map((s) => {
          const count = s === "all" ? (data?.totals.total ?? 0) : (data?.totals[s] ?? 0);
          return (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              className="h-8 text-xs gap-1.5"
            >
              {s === "all" ? "All" : STATUS_META[s as VobStatus].label}
              <span className="text-[10px] opacity-70 tabular-nums">{count}</span>
            </Button>
          );
        })}
        {selectedRep && (
          <Badge
            variant="outline"
            className="text-[11px] gap-1 border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5 cursor-pointer hover:bg-blue-500/10 ml-2"
            onClick={() => setSelectedRepId(null)}
            title="Clear rep filter"
          >
            <UserIcon className="w-3 h-3" /> {selectedRep.name} <X className="w-3 h-3" />
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredDeals.length} {filteredDeals.length === 1 ? "deal" : "deals"} shown
        </span>
      </div>

      {/* Deal list */}
      {loading && !data && (
        <Card>
          <CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading from Zoho…
          </CardContent>
        </Card>
      )}

      {data && filteredDeals.length === 0 && !loading && (
        <Card>
          <CardContent className="pt-10 pb-10 text-sm text-muted-foreground text-center">
            No deals match the current filter.
          </CardContent>
        </Card>
      )}

      {data && filteredDeals.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 pr-3 w-24">Status</th>
                  <th className="text-left py-2 pr-3">Deal</th>
                  <th className="text-left py-2 pr-3">Insurance</th>
                  <th className="text-left py-2 pr-3">LOC</th>
                  <th className="text-left py-2 pr-3">Stage</th>
                  <th className="text-left py-2 pr-3">Owner</th>
                  <th className="text-right py-2 pr-3">Days pending</th>
                  <th className="text-right py-2 pr-3">VOB date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map((d) => {
                  const meta = STATUS_META[d.vob_status];
                  return (
                    <tr key={d.id} className="border-t hover:bg-accent/20 transition-colors align-top">
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={`text-[10px] gap-1 ${meta.tone}`}>
                          {meta.icon} {meta.label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{d.deal_name ?? "(unnamed)"}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          <Badge variant="outline" className="text-[9px]">{d.pipeline ?? "—"}</Badge>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {d.insurance_type ?? "—"}
                        {d.ahcccs_provider && (
                          <div className="text-[10px] text-muted-foreground">{d.ahcccs_provider}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {d.level_of_care ? (
                          <Badge variant="outline" className="text-[9px]">{d.level_of_care}</Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{d.stage ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">
                        {d.owner_name ?? <span className="text-muted-foreground">—</span>}
                        {d.bd_rep && d.bd_rep !== d.owner_name && (
                          <div className="text-[10px] text-muted-foreground">BD: {d.bd_rep}</div>
                        )}
                      </td>
                      <td className={`py-2 pr-3 text-right text-xs tabular-nums ${(d.days_pending ?? 0) > 7 && d.vob_status === "pending" ? "text-rose-600 dark:text-rose-400 font-semibold" : ""}`}>
                        {d.days_pending != null ? `${d.days_pending}d` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                        {fmtDate(d.vob_submitted_date)}
                      </td>
                      <td className="py-2 pr-3">
                        <a
                          href={`https://crm.zoho.com/crm/tab/Potentials/${d.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          Zoho <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function KpiTile({ label, value, tone, sub }: {
  label: string; value: number; tone: "amber" | "emerald" | "blue" | "default"; sub: string;
}) {
  const accent = tone === "amber" ? "border-amber-500/30 bg-amber-500/5"
    : tone === "emerald" ? "border-emerald-500/30 bg-emerald-500/5"
    : tone === "blue" ? "border-blue-500/30 bg-blue-500/5"
    : "";
  const valueColor = tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "blue" ? "text-blue-600 dark:text-blue-400"
    : "";
  return (
    <Card className={accent}>
      <CardContent className="pt-3 pb-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${valueColor}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
