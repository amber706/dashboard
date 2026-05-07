// /bd/account — Account Intelligence workspace.
//
// Search a company → see the full relationship picture: referrals in,
// admits, deals in pipeline, referrals out, meetings, BD owner, last
// activity. Driven by structured Zoho fields via bd-account-search +
// bd-account-detail.

import { useEffect, useState, useCallback } from "react";
import { Link, useSearch } from "wouter";
import {
  Loader2, Search, ArrowLeft, ExternalLink, Building2, User,
  Calendar, TrendingUp, RefreshCw, ArrowRight, ArrowLeftRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";

interface AccountSearchResult {
  id: string;
  name: string;
  type: string | null;
  industry: string | null;
  owner_id: string | null;
}

interface BdAccountDetail {
  ok: boolean;
  account: {
    id: string;
    name: string;
    type: string | null;
    industry: string | null;
    owner_id: string | null;
    description: string | null;
  };
  summary: {
    referrals_in: number;
    admits: number;
    deals_in_pipeline: number;
    conversion_rate: number | null;
    meetings_count: number;
    last_referral_in: string | null;
    referrals_out: number;
    outbound_admits: number;
    last_referral_out: string | null;
    net_referral_balance: number;
    last_meeting: string | null;
  };
  referrals_in: any[];
  admits: any[];
  deals_in_pipeline: any[];
  referrals_out: any[];
  meetings: any[];
  business_contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    referral_count: number;
    last_referral_at: string | null;
  }>;
  window: { days: number; start: string; end: string };
}

type TabKey = "referrals" | "admits" | "pipeline" | "out" | "meetings" | "contacts";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
}

export default function BdAccountIntelligence() {
  // Read ?id= so dashboard "Open" links land on a specific account.
  const search = useSearch();
  const initialId = (() => {
    const params = new URLSearchParams(search);
    return params.get("id");
  })();

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AccountSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<BdAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("referrals");
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string | null; email: string | null; zoho_user_id: string | null }>>([]);

  // Load profiles once for owner-id → name resolution.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("is_active", true);
      setProfiles((data ?? []) as any);
    })();
  }, []);

  function repName(zohoId: string | null | undefined): string {
    if (!zohoId) return "—";
    const p = profiles.find((p) => p.zoho_user_id === zohoId);
    return p?.full_name ?? p?.email ?? `(zoho ${zohoId.slice(-6)})`;
  }

  // Debounced search.
  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ q: query, limit: 25 }),
        });
        const json = await res.json();
        if (json.ok) setSearchResults(json.accounts ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadDetail = useCallback(async () => {
    if (!selectedAccountId) return;
    setDetailLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-detail`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ account_id: selectedAccountId, days: 180 }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setDetail(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccountId) loadDetail();
    else setDetail(null);
  }, [selectedAccountId, loadDetail]);

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Account Intelligence"
      subtitle="Search a referring company to see referrals in & out, admits, pipeline, meetings, and BD ownership in one view. Live from Zoho CRM."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <ArrowLeft className="w-3.5 h-3.5" /> Performance
            </Button>
          </Link>
          {detail && (
            <Button variant="outline" size="sm" onClick={loadDetail} disabled={detailLoading} className="gap-1.5 h-9">
              {detailLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </Button>
          )}
        </div>
      }
    >
      {/* Search bar */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a referring company by name…"
              className="pl-10 h-10 text-sm"
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {/* Search results dropdown */}
          {searchResults.length > 0 && !selectedAccountId && (
            <div className="border rounded-md max-h-72 overflow-y-auto">
              {searchResults.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setSelectedAccountId(a.id);
                    setSearchResults([]);
                    setQuery(a.name);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors border-b last:border-b-0 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{a.name}</span>
                    {a.type && <Badge variant="outline" className="text-[10px]">{a.type}</Badge>}
                    {a.industry && <span className="text-xs text-muted-foreground">· {a.industry}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {!selectedAccountId && (
        <Card>
          <CardContent className="pt-10 pb-10 text-center text-sm text-muted-foreground space-y-2">
            <Building2 className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p>Type a company name above to load the full account picture.</p>
          </CardContent>
        </Card>
      )}

      {selectedAccountId && detailLoading && !detail && (
        <Card>
          <CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading account from Zoho…
          </CardContent>
        </Card>
      )}

      {detail && (
        <>
          {/* Account header */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                <Building2 className="w-5 h-5 text-blue-500" />
                {detail.account.name}
                {detail.account.type && <Badge variant="outline" className="text-[10px]">{detail.account.type}</Badge>}
                {detail.account.industry && <Badge variant="outline" className="text-[10px]">{detail.account.industry}</Badge>}
              </CardTitle>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap mt-1">
                <span className="inline-flex items-center gap-1">
                  <User className="w-3 h-3" /> BD owner: <span className="font-medium text-foreground">{repName(detail.account.owner_id)}</span>
                </span>
                {detail.summary.last_meeting && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Last meeting: {fmtDate(detail.summary.last_meeting)} ({daysSince(detail.summary.last_meeting)})
                  </span>
                )}
                {detail.summary.last_referral_in && (
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Last in: {fmtDate(detail.summary.last_referral_in)} ({daysSince(detail.summary.last_referral_in)})
                  </span>
                )}
                {detail.summary.last_referral_out && (
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" /> Last out: {fmtDate(detail.summary.last_referral_out)} ({daysSince(detail.summary.last_referral_out)})
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-3 pt-0">
              <Stat label="Referrals in" value={detail.summary.referrals_in} accent="blue" />
              <Stat label="Referrals out" value={detail.summary.referrals_out} accent="orange" />
              <Stat
                label="Net balance"
                value={detail.summary.net_referral_balance > 0
                  ? `+${detail.summary.net_referral_balance}`
                  : detail.summary.net_referral_balance}
                accent={detail.summary.net_referral_balance < 0 ? "red" : "slate"}
              />
              <Stat label="Admits" value={detail.summary.admits} accent="emerald" />
              <Stat
                label="Conversion"
                value={detail.summary.conversion_rate != null ? `${detail.summary.conversion_rate}%` : "—"}
                accent="amber"
              />
              <Stat label="Meetings" value={detail.summary.meetings_count} accent="cyan" />
            </CardContent>
            {detail.account.description && (
              <CardContent className="pt-0 pb-4 text-xs text-muted-foreground italic border-t mt-2 pt-2">
                {detail.account.description}
              </CardContent>
            )}
          </Card>

          {/* Tabs */}
          <div className="flex items-center gap-2 flex-wrap border-b pb-2">
            {([
              { key: "referrals", label: "Referrals in", count: detail.referrals_in.length },
              { key: "admits", label: "Admits", count: detail.admits.length },
              { key: "pipeline", label: "In pipeline", count: detail.deals_in_pipeline.length },
              { key: "out", label: "Referrals out", count: detail.referrals_out.length },
              { key: "contacts", label: "Business contacts", count: detail.business_contacts?.length ?? 0 },
              { key: "meetings", label: "Meetings", count: detail.meetings.length },
            ] as const).map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={tab === t.key ? "default" : "outline"}
                onClick={() => setTab(t.key as TabKey)}
                className="h-8 gap-1.5"
              >
                {t.label}
                <Badge variant={tab === t.key ? "secondary" : "outline"} className="text-[10px] h-4 px-1.5">{t.count}</Badge>
              </Button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "referrals" && <DealsInTable rows={detail.referrals_in} repName={repName} />}
          {tab === "admits" && <DealsInTable rows={detail.admits} repName={repName} />}
          {tab === "pipeline" && <DealsInTable rows={detail.deals_in_pipeline} repName={repName} />}
          {tab === "out" && <DealsOutTable rows={detail.referrals_out} repName={repName} />}
          {tab === "contacts" && <BusinessContactsTable rows={detail.business_contacts ?? []} />}
          {tab === "meetings" && <MeetingsTable rows={detail.meetings} repName={repName} />}
        </>
      )}
    </PageShell>
  );
}

function Stat({ label, value, accent }: {
  label: string;
  value: number | string;
  accent: "blue" | "emerald" | "amber" | "violet" | "cyan" | "orange" | "slate" | "red";
}) {
  const tone: Record<string, string> = {
    blue: "text-blue-500 dark:text-blue-400",
    emerald: "text-emerald-500 dark:text-emerald-400",
    amber: "text-amber-500 dark:text-amber-400",
    violet: "text-violet-500 dark:text-violet-400",
    cyan: "text-cyan-500 dark:text-cyan-400",
    orange: "text-orange-500 dark:text-orange-400",
    slate: "text-slate-600 dark:text-slate-300",
    red: "text-red-500 dark:text-red-400",
  };
  return (
    <div className="text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone[accent]}`}>{value}</div>
    </div>
  );
}

// Inbound deal table — Deal rows tied to Referring_Company. Columns:
// Deal name, Stage, Referring contact (the person at the partner who
// sent it), BD rep, LOC, Subcategory, Updated.
function DealsInTable({ rows, repName }: { rows: any[]; repName: (z: string | null | undefined) => string }) {
  if (rows.length === 0) {
    return <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">No deals in this category for the window.</CardContent></Card>;
  }
  return (
    <Card>
      <CardContent className="pt-4 pb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="text-left py-2 pr-3">Deal</th>
              <th className="text-left py-2 pr-3">Stage</th>
              <th className="text-left py-2 pr-3">Referred by</th>
              <th className="text-left py-2 pr-3">BD rep</th>
              <th className="text-left py-2 pr-3">LOC</th>
              <th className="text-left py-2 pr-3">Subcategory</th>
              <th className="text-right py-2 pr-3">Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const contactName = r["Referring_Business_Contact.Full_Name"] as string | null;
              const contactEmail = r["Referring_Business_Contact.Email"] as string | null;
              const contactPhone = r["Referring_Business_Contact.Phone"] as string | null;
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-2 pr-3 font-medium">{r.Deal_Name ?? "(no name)"}</td>
                  <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{r.Stage}</Badge></td>
                  <td className="py-2 pr-3 text-xs">
                    {contactName ? (
                      <div className="space-y-0.5">
                        <div className="font-medium">{contactName}</div>
                        {(contactEmail || contactPhone) && (
                          <div className="text-[10px] text-muted-foreground">
                            {contactEmail}{contactEmail && contactPhone ? " · " : ""}{contactPhone}
                          </div>
                        )}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 pr-3 text-xs">{r.BD_Rep ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs">{r.Admitted_Level_of_Care ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs">{r.Business_Development_Subcategory ?? "—"}</td>
                  <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                    {r.Modified_Time ? daysSince(r.Modified_Time) : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <a
                      href={`https://crm.zoho.com/crm/tab/Potentials/${r.id}`}
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
  );
}

// Distinct business contacts who've sent referrals from this account.
function BusinessContactsTable({ rows }: { rows: Array<{ id: string; name: string; email: string | null; phone: string | null; title: string | null; referral_count: number; last_referral_at: string | null }> }) {
  if (rows.length === 0) {
    return <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">No business contacts found in this window. Referrals from this account had no Referring_Business_Contact set in Zoho.</CardContent></Card>;
  }
  return (
    <Card>
      <CardContent className="pt-4 pb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="text-left py-2 pr-3">Name</th>
              <th className="text-left py-2 pr-3">Title</th>
              <th className="text-left py-2 pr-3">Email</th>
              <th className="text-left py-2 pr-3">Phone</th>
              <th className="text-right py-2 pr-3">Referrals</th>
              <th className="text-right py-2 pr-3">Last referral</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="py-2 pr-3 font-medium">{c.name}</td>
                <td className="py-2 pr-3 text-xs">{c.title ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">
                  {c.email ? <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a> : "—"}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {c.phone ? <a href={`tel:${c.phone}`} className="text-primary hover:underline">{c.phone}</a> : "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{c.referral_count}</td>
                <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                  {c.last_referral_at ? daysSince(c.last_referral_at) : "—"}
                </td>
                <td className="py-2 pr-3">
                  <a
                    href={`https://crm.zoho.com/crm/tab/Contacts/${c.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    Zoho <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// Outbound deal table — Deal rows where this account is the destination
// of a referral we sent out. Columns: Deal, Refer-out date, Type,
// Outbound BD rep, Admitted at facility, Owner, Updated.
function DealsOutTable({ rows, repName }: { rows: any[]; repName: (z: string | null | undefined) => string }) {
  if (rows.length === 0) {
    return <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">No outbound referrals to this account in the window.</CardContent></Card>;
  }
  return (
    <Card>
      <CardContent className="pt-4 pb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="text-left py-2 pr-3">Deal</th>
              <th className="text-left py-2 pr-3">Type</th>
              <th className="text-left py-2 pr-3">Outbound BD rep</th>
              <th className="text-left py-2 pr-3">Owner</th>
              <th className="text-left py-2 pr-3">Admitted there</th>
              <th className="text-right py-2 pr-3">Refer-out date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 pr-3 font-medium">{r.Deal_Name ?? "(no name)"}</td>
                <td className="py-2 pr-3 text-xs">{r.Refer_Out_Type ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">{r.Outbound_Referral_BD_Rep ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">{repName(r["Owner.id"])}</td>
                <td className="py-2 pr-3 text-xs">
                  {r.Admitted_at_Referred_Facility === true
                    ? <Badge variant="default" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">Yes</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                  {fmtDate(r.Refer_Out_Date)}
                </td>
                <td className="py-2 pr-3">
                  <a
                    href={`https://crm.zoho.com/crm/tab/Potentials/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    Zoho <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function MeetingsTable({ rows, repName }: { rows: any[]; repName: (z: string | null | undefined) => string }) {
  if (rows.length === 0) {
    return <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">No meetings tied to this account in the window.</CardContent></Card>;
  }
  return (
    <Card>
      <CardContent className="pt-4 pb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="text-left py-2 pr-3">Title</th>
              <th className="text-left py-2 pr-3">Owner</th>
              <th className="text-left py-2 pr-3">Venue</th>
              <th className="text-right py-2 pr-3">When</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 pr-3 font-medium">{r.Event_Title ?? "(untitled)"}</td>
                <td className="py-2 pr-3 text-xs">{repName(r["Owner.id"])}</td>
                <td className="py-2 pr-3 text-xs">{r.Venue ?? "—"}</td>
                <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                  {fmtDate(r.Start_DateTime)}
                </td>
                <td className="py-2 pr-3">
                  <a
                    href={`https://crm.zoho.com/crm/tab/Events/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    Zoho <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// Reference unused imports to keep the linter quiet during the rewrite.
void ArrowLeftRight;
