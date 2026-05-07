// /bd — BD Performance Dashboard.
//
// Phase 1 surface: KPIs (referrals in, admits, conversion, meetings),
// top referring sources (grouped by Lead.Generated_By), per-BD-rep
// performance table. Real Zoho data via the bd-summary Edge Function.

import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, RefreshCw, TrendingUp, Phone, Calendar, Users, Target,
  ArrowRight, Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

interface BdSummary {
  ok: boolean;
  window: { days: number; start: string; end: string };
  kpis: {
    referrals_in: number;
    admits: number;
    conversion_rate: number | null;
    meetings_completed: number;
    all_org_admits: number;
    referrals_out: number | null;
    net_referral_balance: number | null;
  };
  top_accounts: Array<{
    account_name: string;
    referrals_in: number;
    admits: number;
    conversion_rate: number | null;
    last_referral_at: string | null;
    bd_owner_count: number;
  }>;
  reps: Array<{
    zoho_user_id: string;
    referrals_in: number;
    admits: number;
    conversion_rate: number | null;
    meetings_completed: number;
  }>;
  not_yet_wired: string[];
}

interface RepProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  zoho_user_id: string | null;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Year to date", days: Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (24 * 60 * 60 * 1000)) },
];

export default function BdDashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<BdSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<RepProfile[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-summary`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
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

  // Pull profiles once for zoho_user_id → name mapping.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("is_active", true);
      setProfiles((data ?? []) as RepProfile[]);
    })();
  }, []);

  function repName(zohoId: string): { name: string; profileId: string | null } {
    const p = profiles.find((p) => p.zoho_user_id === zohoId);
    if (p) return { name: p.full_name ?? p.email ?? zohoId, profileId: p.id };
    return { name: `(zoho user ${zohoId.slice(-6)})`, profileId: null };
  }

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Performance Dashboard"
      subtitle="Team and individual BD performance — referrals in, admits, conversion, meetings. Live from Zoho CRM."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd/account">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <Search className="w-3.5 h-3.5" /> Account Intelligence
            </Button>
          </Link>
          <Link href="/bd/meetings">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <Calendar className="w-3.5 h-3.5" /> Meetings
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      }
    >
      {/* Date range presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
          Window
        </span>
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
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Referrals in"
          value={data?.kpis.referrals_in ?? null}
          loading={loading}
          icon={<TrendingUp className="w-4 h-4 text-blue-500" />}
          sub="BD-sourced leads"
        />
        <Kpi
          label="Admits (BD)"
          value={data?.kpis.admits ?? null}
          loading={loading}
          icon={<Target className="w-4 h-4 text-emerald-500" />}
          sub={data ? `${data.kpis.all_org_admits} org-wide` : undefined}
        />
        <Kpi
          label="Conversion rate"
          value={data?.kpis.conversion_rate != null ? `${data.kpis.conversion_rate}%` : "—"}
          loading={loading}
          icon={<Target className="w-4 h-4 text-amber-500" />}
          sub="Referral → Admit"
        />
        <Kpi
          label="Meetings"
          value={data?.kpis.meetings_completed ?? null}
          loading={loading}
          icon={<Calendar className="w-4 h-4 text-violet-500" />}
          sub="Zoho Events in window"
        />
      </div>

      {/* Top referring sources */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Top referring sources</span>
            <span className="text-xs font-normal text-muted-foreground">grouped by Lead.Generated_By</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.top_accounts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">#</th>
                    <th className="text-left py-2 pr-3">Source</th>
                    <th className="text-right py-2 pr-3">Referrals in</th>
                    <th className="text-right py-2 pr-3">Admits</th>
                    <th className="text-right py-2 pr-3">Conv</th>
                    <th className="text-right py-2 pr-3">Last referral</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_accounts.map((a, i) => (
                    <tr key={a.account_name} className="border-t">
                      <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-3 font-medium">{a.account_name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.referrals_in}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.admits}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {a.conversion_rate != null ? `${a.conversion_rate}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                        {a.last_referral_at ? new Date(a.last_referral_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No BD-sourced referrals in this window.</p>
          )}
        </CardContent>
      </Card>

      {/* Per-rep table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per BD rep</CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.reps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">Rep</th>
                    <th className="text-right py-2 pr-3">Referrals in</th>
                    <th className="text-right py-2 pr-3">Admits</th>
                    <th className="text-right py-2 pr-3">Conv</th>
                    <th className="text-right py-2 pr-3">Meetings</th>
                    <th className="text-right py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.reps.map((r) => {
                    const { name, profileId } = repName(r.zoho_user_id);
                    return (
                      <tr key={r.zoho_user_id} className="border-t">
                        <td className="py-2 pr-3 font-medium">{name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.referrals_in}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.admits}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.conversion_rate != null ? `${r.conversion_rate}%` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.meetings_completed}</td>
                        <td className="py-2 pr-3 text-right">
                          {profileId && (
                            <Link href={`/ops/specialist/${profileId}`} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                              Open <ArrowRight className="w-3 h-3" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No rep activity in this window.</p>
          )}
        </CardContent>
      </Card>

      {/* Phase 2 hint */}
      {data?.not_yet_wired && data.not_yet_wired.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-4 pb-4 text-xs text-muted-foreground space-y-1">
            <div className="font-semibold uppercase tracking-wider">Coming next (Phase 2)</div>
            <ul className="list-disc list-inside space-y-0.5">
              {data.not_yet_wired.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function Kpi({ label, value, loading, icon, sub }: {
  label: string;
  value: number | string | null;
  loading: boolean;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          {icon} {label}
        </div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">
          {loading && value == null ? <Loader2 className="w-4 h-4 animate-spin" /> : (value ?? "—")}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
