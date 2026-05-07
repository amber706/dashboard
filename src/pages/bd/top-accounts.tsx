// /bd/top-accounts — secondary BD dashboard ranking referring accounts
// by activity in the window, with flag indicators (reciprocal gap,
// no recent contact, no recent meeting, high-value dormant, low
// conversion). The BD action list.

import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowLeft, RefreshCw, Flag, AlertTriangle, Building2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

interface FlagState {
  state: "active" | "ok" | "no_data";
  severity?: "high" | "medium" | "low";
  reason?: string;
}

interface AccountFlags {
  reciprocal_gap: FlagState;
  no_recent_contact: FlagState;
  no_recent_meeting: FlagState;
  high_value_dormant: FlagState;
  low_conversion: FlagState;
  active_count: number;
}

interface TopAccount {
  id: string | null;
  name: string;
  type: string | null;
  industry: string | null;
  owner_id: string | null;
  is_reciprocal: boolean;
  referrals_recent: number;
  admits_recent: number;
  referrals_lifetime: number;
  meetings_recent: number;
  conversion_rate: number | null;
  last_referral_in: string | null;
  last_meeting: string | null;
  flags: AccountFlags;
}

interface TopAccountsResponse {
  ok: boolean;
  window: { days: number };
  thresholds: any;
  totals: {
    referrals_in: number;
    admits: number;
    meetings: number;
    flagged: number;
    reciprocal: number;
    accounts_returned: number;
    accounts_examined: number;
  };
  query_errors: string[];
  accounts: TopAccount[];
  not_yet_wired: string[];
}

const PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "Year", days: 365 },
];

const FLAG_LABELS: Record<keyof Omit<AccountFlags, "active_count">, string> = {
  reciprocal_gap: "Reciprocal gap",
  no_recent_contact: "No recent contact",
  no_recent_meeting: "No recent meeting",
  high_value_dormant: "High-value dormant",
  low_conversion: "Low conversion",
};

function flagTone(severity: string | undefined): string {
  if (severity === "high") return "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5";
  if (severity === "medium") return "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5";
  return "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function BdTopAccounts() {
  const [days, setDays] = useState(90);
  const [minReferrals, setMinReferrals] = useState(1);
  const [data, setData] = useState<TopAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-top-accounts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ days, min_referrals: minReferrals }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days, minReferrals]);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Top Referring Accounts"
      subtitle="Accounts ranked by referrals in window. Flagged rows float to the top — reciprocal gaps, dormant high-value accounts, and low-conversion senders need follow-up."
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
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant={days === p.days ? "default" : "outline"}
            onClick={() => setDays(p.days)}
            className="h-8 text-xs"
          >
            {p.label}
          </Button>
        ))}
        <span className="mx-3 h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground">Min referrals</span>
        <select
          value={minReferrals}
          onChange={(e) => setMinReferrals(Number(e.target.value))}
          className="h-8 text-xs px-2 rounded border bg-background"
        >
          <option value="1">1+</option>
          <option value="3">3+</option>
          <option value="5">5+</option>
          <option value="10">10+</option>
        </select>
      </div>

      {/* Scope warnings */}
      {data?.query_errors && data.query_errors.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-3 pb-3 text-xs space-y-2">
            <div className="font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Zoho scope gap — running in degraded mode
            </div>
            <div className="text-muted-foreground">
              The Zoho refresh token doesn't have read access to one or more required modules.
              Until that's fixed, account names are derived from <code>Lead.Generated_By</code>{" "}
              (which on your tenant looks like categories: "Digital Referral", "BD Referral",
              "Alumni Referral", etc.) instead of real Account records.
            </div>
            <details className="text-muted-foreground">
              <summary className="cursor-pointer">Errors ({data.query_errors.length})</summary>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {data.query_errors.map((e, i) => <li key={i} className="font-mono text-[10px]">{e}</li>)}
              </ul>
            </details>
            <div className="text-muted-foreground">
              <strong>To fix:</strong> Re-authorize Zoho with these added scopes:{" "}
              <code>ZohoCRM.modules.accounts.READ</code>, <code>ZohoCRM.modules.events.READ</code>{" "}
              (or <code>ZohoCRM.modules.ALL</code>).
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* KPI cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Total referrals in" value={data.totals.referrals_in} />
          <KpiCard label="Admits" value={data.totals.admits} />
          <KpiCard label="Conv rate" value={data.totals.referrals_in > 0 ? `${Math.round((data.totals.admits / data.totals.referrals_in) * 100)}%` : "—"} />
          <KpiCard label="Accounts flagged" value={data.totals.flagged} accent={data.totals.flagged > 0 ? "rose" : "default"} />
          <KpiCard label="Reciprocal" value={data.totals.reciprocal} />
        </div>
      )}

      {/* Accounts table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Accounts</span>
            <span className="text-xs font-normal text-muted-foreground">
              {data ? `${data.totals.accounts_returned} of ${data.totals.accounts_examined} examined` : "loading"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading from Zoho…
            </div>
          ) : data && data.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts match the current filters.</p>
          ) : data && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">#</th>
                    <th className="text-left py-2 pr-3">Account</th>
                    <th className="text-right py-2 pr-3">Referrals</th>
                    <th className="text-right py-2 pr-3">Admits</th>
                    <th className="text-right py-2 pr-3">Conv</th>
                    <th className="text-right py-2 pr-3">Lifetime</th>
                    <th className="text-right py-2 pr-3">Last ref</th>
                    <th className="text-right py-2 pr-3">Last mtg</th>
                    <th className="text-left py-2 pr-3">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a, i) => {
                    const activeFlags = (Object.keys(FLAG_LABELS) as Array<keyof typeof FLAG_LABELS>)
                      .filter((k) => a.flags[k].state === "active");
                    return (
                      <tr key={a.id ?? a.name} className="border-t align-top hover:bg-accent/20 transition-colors">
                        <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="py-2 pr-3">
                          <div className="font-medium flex items-center gap-1.5">
                            <Building2 className="w-3 h-3 text-muted-foreground" />
                            {a.name}
                            {a.is_reciprocal && <Badge variant="outline" className="text-[9px]">reciprocal</Badge>}
                          </div>
                          {a.type && <div className="text-[10px] text-muted-foreground">{a.type}</div>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">{a.referrals_recent}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{a.admits_recent}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {a.conversion_rate != null ? `${a.conversion_rate}%` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{a.referrals_lifetime}</td>
                        <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{fmtDate(a.last_referral_in)}</td>
                        <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{fmtDate(a.last_meeting)}</td>
                        <td className="py-2 pr-3">
                          {activeFlags.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {activeFlags.map((k) => {
                                const f = a.flags[k];
                                if (f.state !== "active") return null;
                                return (
                                  <Badge
                                    key={k}
                                    variant="outline"
                                    className={`text-[9px] gap-1 ${flagTone(f.severity)}`}
                                    title={f.reason}
                                  >
                                    <Flag className="w-2.5 h-2.5" />
                                    {FLAG_LABELS[k]}
                                  </Badge>
                                );
                              })}
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

      {/* Phase 2 hint */}
      <Card className="border-dashed">
        <CardContent className="pt-3 pb-3 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold uppercase tracking-wider">What still needs to land</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Re-auth Zoho with <code>ZohoCRM.modules.accounts.READ</code> + <code>ZohoCRM.modules.events.READ</code> for real Account_Name + Meetings data</li>
            <li>Custom <code>Referring_Account</code> lookup field on Lead/Deal in Zoho — eliminates name-string fuzzy matching</li>
            <li>Referrals Out tracking (today the workflow pushes to Slack; needs a Zoho field)</li>
            <li>Two-way meeting sync (Phase 3)</li>
          </ul>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number | string; accent?: "rose" | "default" }) {
  return (
    <Card className={accent === "rose" ? "border-rose-500/30 bg-rose-500/5" : ""}>
      <CardContent className="pt-3 pb-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}

