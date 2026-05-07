// /bd/stuck-accounts — the BD reactivation queue.
//
// Reads the same data as /bd/top-accounts (flag computation lives in
// the bd-top-accounts edge function) but reframes it as an action
// list: only accounts with active reactivation flags appear, sorted
// by severity, with a recommended next action per row. The goal is
// to turn the dashboard from "informational" into "actionable" —
// instead of a manager scanning Top Accounts and inferring who needs
// outreach, this page just tells them.
//
// Flag → action mapping is intentionally simple text; we can layer
// Claude-generated suggestions per account later in Phase 4.

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowLeft, RefreshCw, Flag, AlertTriangle, Building2,
  ArrowRight, Calendar, Phone, TrendingDown, Sparkles, Mail, MapPin,
  ChevronDown, ChevronRight, Copy, Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";
import { exportCsv, isoToday } from "@/lib/bd-csv";

interface FlagState { state: "active" | "ok" | "no_data"; severity?: "high" | "medium" | "low"; reason?: string }
interface AccountFlags {
  reciprocal_gap: FlagState;
  no_recent_contact: FlagState;
  no_recent_meeting: FlagState;
  high_value_dormant: FlagState;
  low_conversion: FlagState;
  active_count: number;
}
interface TopAccount {
  id: string;
  name: string;
  type: string | null;
  industry: string | null;
  owner_id: string | null;
  is_reciprocal: boolean;
  referrals_recent: number;
  admits_recent: number;
  referrals_lifetime: number;
  referrals_out_recent: number;
  meetings_recent: number;
  net_balance: number;
  conversion_rate: number | null;
  last_referral_in: string | null;
  last_referral_out: string | null;
  last_meeting: string | null;
  flags: AccountFlags;
}
interface TopAccountsResponse {
  ok: boolean;
  accounts: TopAccount[];
  totals: {
    referrals_in: number; admits: number; referrals_out: number;
    meetings: number; flagged: number; reciprocal: number;
    accounts_returned: number; accounts_examined: number;
  };
  query_errors?: string[];
}

// Reactivation flags only — the ones that imply "this account needs
// outreach". reciprocal_gap and low_conversion are real flags but not
// reactivation-shaped, so they live on the Top Accounts page instead.
const REACTIVATION_FLAGS = ["high_value_dormant", "no_recent_contact", "no_recent_meeting"] as const;
type ReactivationFlag = typeof REACTIVATION_FLAGS[number];

const PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "Year", days: 365 },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// Severity rank used to sort the action queue. high > medium > low.
function severityRank(s: string | undefined): number {
  return s === "high" ? 3 : s === "medium" ? 2 : s === "low" ? 1 : 0;
}

// Pick the worst severity across the reactivation flags on a row.
// That's what surfaces as the row's overall priority.
function rowSeverity(a: TopAccount): number {
  let max = 0;
  for (const k of REACTIVATION_FLAGS) {
    const f = a.flags[k];
    if (f.state === "active") max = Math.max(max, severityRank(f.severity));
  }
  return max;
}

// Translate the active flag combination into a plain-English next
// action. Order matters — most-actionable suggestion wins.
function recommendedAction(a: TopAccount): { label: string; icon: React.ReactNode; tone: string } {
  const noMtg = a.flags.no_recent_meeting.state === "active";
  const noCtc = a.flags.no_recent_contact.state === "active";
  const dormant = a.flags.high_value_dormant.state === "active";

  if (dormant && noMtg) {
    return {
      label: "Schedule a visit — high-value account has gone quiet",
      icon: <Calendar className="w-3.5 h-3.5" />,
      tone: "text-rose-600 dark:text-rose-400",
    };
  }
  if (dormant) {
    return {
      label: "Reach out — referral pace dropped on a key account",
      icon: <Sparkles className="w-3.5 h-3.5" />,
      tone: "text-rose-600 dark:text-rose-400",
    };
  }
  if (noMtg && noCtc) {
    return {
      label: "Schedule a visit — no recent meeting or call",
      icon: <Calendar className="w-3.5 h-3.5" />,
      tone: "text-amber-600 dark:text-amber-400",
    };
  }
  if (noMtg) {
    return {
      label: "Schedule a visit — no recent meeting",
      icon: <Calendar className="w-3.5 h-3.5" />,
      tone: "text-amber-600 dark:text-amber-400",
    };
  }
  if (noCtc) {
    return {
      label: "Call to check in — no recent BD activity logged",
      icon: <Phone className="w-3.5 h-3.5" />,
      tone: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    label: "Review",
    icon: <TrendingDown className="w-3.5 h-3.5" />,
    tone: "text-blue-600 dark:text-blue-400",
  };
}

const FLAG_LABEL: Record<ReactivationFlag, string> = {
  high_value_dormant: "High-value dormant",
  no_recent_contact: "No recent contact",
  no_recent_meeting: "No recent meeting",
};

export default function BdStuckAccounts() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<TopAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Profile lookup so we can resolve owner_id (Zoho user id) → name
  // for the BD-rep column. Same pattern as the other BD pages.
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string | null; zoho_user_id: string | null }>>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-top-accounts`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ days, min_referrals: 1 }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, zoho_user_id").eq("is_active", true);
      setProfiles((data ?? []) as any);
    })();
  }, []);

  function ownerName(zohoId: string | null): string {
    if (!zohoId) return "—";
    const p = profiles.find((p) => p.zoho_user_id === zohoId);
    return p?.full_name ?? `(zoho ${zohoId.slice(-6)})`;
  }

  // Filter to rows with at least one active reactivation flag, then
  // sort: severity desc, then lifetime-referrals desc (high-volume
  // accounts surface above one-off referrers), then days-since-last-
  // referral desc (longer dormancy first).
  const stuck = useMemo(() => {
    if (!data) return [];
    const filtered = data.accounts.filter((a) =>
      REACTIVATION_FLAGS.some((k) => a.flags[k].state === "active"),
    );
    return filtered.sort((a, b) => {
      const sev = rowSeverity(b) - rowSeverity(a);
      if (sev !== 0) return sev;
      const life = b.referrals_lifetime - a.referrals_lifetime;
      if (life !== 0) return life;
      const aDays = daysSince(a.last_referral_in) ?? -1;
      const bDays = daysSince(b.last_referral_in) ?? -1;
      return bDays - aDays;
    });
  }, [data]);

  const counts = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    for (const a of stuck) {
      const r = rowSeverity(a);
      if (r === 3) high++;
      else if (r === 2) medium++;
      else if (r === 1) low++;
    }
    return { high, medium, low, total: stuck.length };
  }, [stuck]);

  function downloadCsv() {
    if (stuck.length === 0) return;
    exportCsv<TopAccount>(`bd-stuck-accounts-${days}d-${isoToday()}.csv`, [
      { header: "Severity", value: (a) => ["", "low", "medium", "high"][rowSeverity(a)] },
      { header: "Account", value: (a) => a.name },
      { header: "Account ID", value: (a) => a.id },
      { header: "Type", value: (a) => a.type ?? "" },
      { header: "Lifetime referrals", value: (a) => a.referrals_lifetime },
      { header: "Referrals (window)", value: (a) => a.referrals_recent },
      { header: "Last referral in", value: (a) => a.last_referral_in ?? "" },
      { header: "Days dark", value: (a) => daysSince(a.last_referral_in) ?? "" },
      { header: "Last meeting", value: (a) => a.last_meeting ?? "" },
      { header: "BD owner", value: (a) => ownerName(a.owner_id) },
      { header: "Active flags", value: (a) => REACTIVATION_FLAGS.filter((k) => a.flags[k].state === "active").map((k) => FLAG_LABEL[k]).join("; ") },
      { header: "Recommended action", value: (a) => recommendedAction(a).label },
    ], stuck);
  }

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Stuck accounts"
      subtitle="Referring accounts that need outreach — high-value partners that have gone quiet, accounts with no recent meeting or call. Sorted by severity so the most urgent surface first."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd"><Button variant="outline" size="sm" className="gap-1.5 h-9"><ArrowLeft className="w-3.5 h-3.5" /> Performance</Button></Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={stuck.length === 0} className="h-9 text-xs">
            Download CSV
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lookback</span>
        {PRESETS.map((p) => (
          <Button key={p.label} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)} className="h-8 text-xs">
            {p.label}
          </Button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-2">
          Lookback only affects which accounts are examined for staleness — flag thresholds (e.g. 60d-no-meeting) are baked into the edge function.
        </span>
      </div>

      {/* Severity rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SeverityTile tone="rose" label="High-priority" value={counts.high} sub="dormant high-value accounts" />
        <SeverityTile tone="amber" label="Medium" value={counts.medium} sub="missing meetings or contact" />
        <SeverityTile tone="blue" label="Low" value={counts.low} sub="watch list" />
        <SeverityTile tone="default" label="Total" value={counts.total} sub={`out of ${data?.totals.accounts_examined ?? 0} examined`} />
      </div>

      {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}

      {loading && !data && <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading flagged accounts…</CardContent></Card>}

      {data && stuck.length === 0 && !loading && (
        <Card>
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <Sparkles className="w-8 h-8 text-emerald-500/60 mx-auto" />
            <p className="text-sm font-medium">Queue is clear.</p>
            <p className="text-xs text-muted-foreground">No referring accounts have active reactivation flags in the {days}-day window.</p>
          </CardContent>
        </Card>
      )}

      {data && stuck.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 pr-3 w-24">Priority</th>
                  <th className="text-left py-2 pr-3">Account</th>
                  <th className="text-left py-2 pr-3">Recommended action</th>
                  <th className="text-right py-2 pr-3">Days dark</th>
                  <th className="text-right py-2 pr-3">Last referral</th>
                  <th className="text-right py-2 pr-3">Last meeting</th>
                  <th className="text-right py-2 pr-3">Lifetime</th>
                  <th className="text-left py-2 pr-3">BD owner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stuck.map((a) => (
                  <StuckRow
                    key={a.id}
                    account={a}
                    ownerName={ownerName}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

// One row in the stuck-accounts table. Self-contained because it owns
// the Claude-suggestion expander state — pulling that into the parent
// would require a Map keyed by account id and re-render the whole
// table on every fetch. Easier to localize the state here.
function StuckRow({ account: a, ownerName }: {
  account: TopAccount;
  ownerName: (zohoId: string | null) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [suggestion, setSuggestion] = useState<{ channel: "visit" | "call" | "email"; subject_line: string; opener: string; reasoning: string } | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"opener" | "subject" | null>(null);

  const sev = rowSeverity(a);
  const sevLabel = sev === 3 ? "High" : sev === 2 ? "Medium" : "Low";
  const sevTone = sev === 3
    ? "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5"
    : sev === 2
      ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5"
      : "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5";
  const action = recommendedAction(a);
  const dDark = daysSince(a.last_referral_in);

  // Fetch the Claude suggestion once when the row is first expanded.
  // Cached on the row itself so collapsing + re-expanding doesn't
  // re-spend tokens. Refresh button forces a fresh fetch.
  async function loadSuggestion(force = false) {
    if (suggestion && !force) return;
    setSuggestionLoading(true);
    setSuggestionError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-reactivation-suggestion`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ account_id: a.id }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setSuggestion({
        channel: json.channel,
        subject_line: json.subject_line ?? "",
        opener: json.opener ?? "",
        reasoning: json.reasoning ?? "",
      });
    } catch (e) {
      setSuggestionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestionLoading(false);
    }
  }

  function toggleExpand() {
    if (!expanded) loadSuggestion(false);
    setExpanded(!expanded);
  }

  async function copy(text: string, field: "opener" | "subject") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch { /* clipboard might be unavailable; silent failure */ }
  }

  const channelMeta: Record<"visit" | "call" | "email", { label: string; icon: React.ReactNode; tone: string }> = {
    visit:  { label: "Visit",  icon: <MapPin className="w-3.5 h-3.5" />,   tone: "border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/5" },
    call:   { label: "Call",   icon: <Phone className="w-3.5 h-3.5" />,    tone: "border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/5" },
    email:  { label: "Email",  icon: <Mail className="w-3.5 h-3.5" />,     tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5" },
  };

  return (
    <>
      <tr className="border-t hover:bg-accent/20 transition-colors align-top">
        <td className="py-2 pr-3">
          <Badge variant="outline" className={`text-[10px] gap-1 ${sevTone}`}>
            <Flag className="w-2.5 h-2.5" />{sevLabel}
          </Badge>
        </td>
        <td className="py-2 pr-3">
          <div className="font-medium flex items-center gap-1.5">
            <Building2 className="w-3 h-3 text-muted-foreground" />
            {a.name}
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {REACTIVATION_FLAGS.filter((k) => a.flags[k].state === "active").map((k) => (
              <Badge key={k} variant="outline" className="text-[9px] text-muted-foreground" title={a.flags[k].reason}>
                {FLAG_LABEL[k]}
              </Badge>
            ))}
          </div>
        </td>
        <td className="py-2 pr-3">
          <button
            onClick={toggleExpand}
            className={`text-xs inline-flex items-center gap-1.5 hover:underline ${action.tone}`}
            title="Click to get a Claude-generated outreach suggestion"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {action.icon}
            <span>{action.label}</span>
          </button>
        </td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums">
          {dDark != null ? `${dDark}d` : "—"}
        </td>
        <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{fmtDate(a.last_referral_in)}</td>
        <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{fmtDate(a.last_meeting)}</td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums">{a.referrals_lifetime}</td>
        <td className="py-2 pr-3 text-xs">{ownerName(a.owner_id)}</td>
        <td className="py-2 pr-3">
          <Link href={`/bd/account?id=${a.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/30">
          <td colSpan={9} className="py-3 px-4">
            {suggestionLoading && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Asking Claude for a specific outreach suggestion based on this account's referral pattern…
              </div>
            )}
            {suggestionError && (
              <div className="text-xs text-rose-600 dark:text-rose-400">
                {suggestionError}
                <button onClick={() => loadSuggestion(true)} className="ml-2 underline">Retry</button>
              </div>
            )}
            {suggestion && !suggestionLoading && (
              <div className="space-y-3 max-w-3xl">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Suggested outreach
                  </span>
                  <Badge variant="outline" className={`text-[10px] gap-1 ${channelMeta[suggestion.channel].tone}`}>
                    {channelMeta[suggestion.channel].icon}
                    {channelMeta[suggestion.channel].label}
                  </Badge>
                  <button
                    onClick={() => loadSuggestion(true)}
                    className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 ml-auto"
                    title="Generate a fresh suggestion"
                  >
                    <RefreshCw className="w-3 h-3" /> Regenerate
                  </button>
                </div>
                {suggestion.subject_line && (
                  <div className="space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                      {suggestion.channel === "email" ? "Subject" : "One-line summary"}
                      <button
                        onClick={() => copy(suggestion.subject_line, "subject")}
                        className="text-muted-foreground/60 hover:text-foreground inline-flex items-center gap-0.5"
                        title="Copy"
                      >
                        {copiedField === "subject" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    <div className="text-sm font-medium">{suggestion.subject_line}</div>
                  </div>
                )}
                <div className="space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                    {suggestion.channel === "email" ? "Opening" : "What to say"}
                    <button
                      onClick={() => copy(suggestion.opener, "opener")}
                      className="text-muted-foreground/60 hover:text-foreground inline-flex items-center gap-0.5"
                      title="Copy"
                    >
                      {copiedField === "opener" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{suggestion.opener}</div>
                </div>
                {suggestion.reasoning && (
                  <div className="space-y-0.5 pt-1 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Why this</div>
                    <div className="text-xs text-muted-foreground italic">{suggestion.reasoning}</div>
                  </div>
                )}
              </div>
            )}
            {!suggestion && !suggestionLoading && !suggestionError && (
              <button onClick={() => loadSuggestion(false)} className="text-xs text-primary hover:underline inline-flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Ask Claude for a specific outreach suggestion
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SeverityTile({ tone, label, value, sub }: {
  tone: "rose" | "amber" | "blue" | "default";
  label: string; value: number; sub: string;
}) {
  const accent = tone === "rose"
    ? "border-rose-500/30 bg-rose-500/5"
    : tone === "amber"
      ? "border-amber-500/30 bg-amber-500/5"
      : tone === "blue"
        ? "border-blue-500/30 bg-blue-500/5"
        : "";
  const valueColor = tone === "rose"
    ? "text-rose-600 dark:text-rose-400"
    : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : "";
  return (
    <Card className={accent}>
      <CardContent className="pt-3 pb-3">
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          {tone !== "default" && <AlertTriangle className="w-3.5 h-3.5" />}
          {label}
        </div>
        <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${valueColor}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
