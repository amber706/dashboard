import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  PhoneCall, Loader2, Phone, Clock, AlertTriangle,
  ChevronRight, User as UserIcon, Mail, Filter, Download,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";

// A "stale" outreach candidate is a lead that:
//  - has outcome_category = 'in_progress' (still working it)
//  - has had at least one inbound call (so we know they're real, not a stub)
//  - has had NO outbound call in the last STALE_DAYS days
//  - was created within the last LOOKBACK_DAYS (don't surface ancient leads)
//
// We compute this client-side: first pull eligible leads, then fan out to check
// outbound calls per lead. Cheap enough at <500 leads.

const STALE_DAYS_OPTIONS = [1, 3, 7, 14] as const;
const LOOKBACK_DAYS = 60;
const PAGE_LIMIT = 200;

interface OutreachLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  email: string | null;
  stage: string | null;
  insurance_provider: string | null;
  urgency: string | null;
  created_at: string;
  owner: { id: string; full_name: string | null; email: string | null } | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  inbound_count: number;
  outbound_count: number;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function ageSince(s: string | null): string {
  if (!s) return "—";
  const ms = Date.now() - new Date(s).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function OpsOutreach() {
  const [leads, setLeads] = useState<OutreachLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleDays, setStaleDays] = useState<number>(3);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "unowned" | string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const lookbackISO = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 1. Active in-progress leads with a phone number, created in lookback window.
    const { data: leadRows, error: lErr } = await supabase
      .from("leads")
      .select(`id, first_name, last_name, primary_phone_normalized, email, stage,
        insurance_provider, urgency, created_at,
        owner:profiles!leads_owner_id_fkey(id, full_name, email)`)
      .eq("outcome_category", "in_progress")
      .not("primary_phone_normalized", "is", null)
      .gte("created_at", lookbackISO)
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (lErr) {
      setError(lErr.message);
      setLoading(false);
      return;
    }

    // 2. For each lead, find newest inbound + newest outbound + counts.
    const leadIds = (leadRows ?? []).map((l: any) => l.id);
    if (leadIds.length === 0) {
      setLeads([]);
      setLoading(false);
      return;
    }
    const { data: callRows } = await supabase
      .from("call_sessions")
      .select("lead_id, direction, started_at")
      .in("lead_id", leadIds)
      .order("started_at", { ascending: false, nullsFirst: false });

    const byLead = new Map<string, { lastIn: string | null; lastOut: string | null; inN: number; outN: number }>();
    for (const c of (callRows ?? []) as any[]) {
      if (!c.lead_id) continue;
      const b = byLead.get(c.lead_id) ?? { lastIn: null, lastOut: null, inN: 0, outN: 0 };
      if (c.direction === "inbound") {
        b.inN++;
        if (!b.lastIn || (c.started_at && c.started_at > b.lastIn)) b.lastIn = c.started_at;
      } else if (c.direction === "outbound") {
        b.outN++;
        if (!b.lastOut || (c.started_at && c.started_at > b.lastOut)) b.lastOut = c.started_at;
      }
      byLead.set(c.lead_id, b);
    }

    const enriched: OutreachLead[] = (leadRows ?? []).map((l: any) => {
      const b = byLead.get(l.id) ?? { lastIn: null, lastOut: null, inN: 0, outN: 0 };
      return {
        ...l,
        owner: Array.isArray(l.owner) ? l.owner[0] : l.owner,
        last_inbound_at: b.lastIn,
        last_outbound_at: b.lastOut,
        inbound_count: b.inN,
        outbound_count: b.outN,
      };
    });
    setLeads(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    logAudit("view", "leads", null, { surface: "ops_outreach" });
  }, []);

  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of leads) {
      if (l.owner?.id && !seen.has(l.owner.id)) {
        seen.set(l.owner.id, l.owner.full_name ?? l.owner.email ?? "Unknown");
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [leads]);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    return leads.filter((l) => {
      // Must have at least one inbound call (proves real lead, not a webform stub).
      if (l.inbound_count === 0) return false;
      // No outbound, OR last outbound is older than the stale threshold.
      if (l.last_outbound_at && new Date(l.last_outbound_at).getTime() > cutoff) return false;

      if (ownerFilter === "all") return true;
      if (ownerFilter === "unowned") return !l.owner?.id;
      return l.owner?.id === ownerFilter;
    }).sort((a, b) => {
      // Most-stale first: oldest last_inbound_at OR last_outbound_at, whichever is most recent.
      const aLast = a.last_outbound_at ?? a.last_inbound_at ?? a.created_at;
      const bLast = b.last_outbound_at ?? b.last_inbound_at ?? b.created_at;
      return aLast < bLast ? -1 : 1;
    });
  }, [leads, staleDays, ownerFilter]);

  const counts = useMemo(() => {
    const neverCalled = filtered.filter((l) => l.outbound_count === 0).length;
    const stale = filtered.filter((l) => l.outbound_count > 0).length;
    return { total: filtered.length, neverCalled, stale };
  }, [filtered]);

  return (
    <PageShell
      number="01"
      eyebrow="OUTREACH"
      title="Leads needing outreach"
      subtitle="In-progress leads with no outbound contact in the selected window. Surfaces leakage — people who reached out but we haven't followed up."
    >

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Tile label="Need outreach" value={counts.total} accent={counts.total > 0 ? "amber" : undefined} />
        <Tile label="Never called outbound" value={counts.neverCalled} accent={counts.neverCalled > 0 ? "rose" : undefined} />
        <Tile label="Stale (had outbound, but old)" value={counts.stale} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Filter className="w-3 h-3" /> No outbound in last
        </span>
        {STALE_DAYS_OPTIONS.map((d) => (
          <Button key={d} size="sm" variant={staleDays === d ? "default" : "outline"} onClick={() => setStaleDays(d)}>
            {d}d
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">Owner:</span>
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="text-xs border rounded px-2 py-1 bg-background"
        >
          <option value="all">All</option>
          <option value="unowned">Unowned</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={filtered.length === 0}
          className="ml-auto gap-1.5"
          onClick={() => {
            logAudit("export", "leads", null, { format: "csv", count: filtered.length, surface: "ops_outreach", stale_days: staleDays });
            downloadCsv(`outreach-${new Date().toISOString().slice(0, 10)}.csv`, filtered, [
              { key: "first_name", label: "First name" },
              { key: "last_name", label: "Last name" },
              { key: "primary_phone_normalized", label: "Phone" },
              { key: "email", label: "Email" },
              { key: "insurance_provider", label: "Insurance" },
              { key: "urgency", label: "Urgency" },
              { key: "stage", label: "Stage" },
              { key: "owner", label: "Owner", format: (v) => v?.full_name ?? v?.email ?? "" },
              { key: "last_inbound_at", label: "Last inbound", format: (v) => v ? new Date(v).toISOString() : "" },
              { key: "last_outbound_at", label: "Last outbound", format: (v) => v ? new Date(v).toISOString() : "(never)" },
              { key: "inbound_count", label: "Inbound count" },
              { key: "outbound_count", label: "Outbound count" },
              { key: "created_at", label: "Lead created", format: (v) => v ? new Date(v).toISOString() : "" },
            ]);
          }}
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && filtered.length === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          Nothing in this filter. Either everyone's been called or the threshold is too tight.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {filtered.map((l) => {
          const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown";
          const neverCalled = l.outbound_count === 0;
          return (
            <Link key={l.id} href={`/leads/${l.id}`} className="block">
              <Card className={`hover:bg-accent/30 transition-colors ${neverCalled ? "border-l-4 border-l-rose-500" : ""}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{name}</span>
                        {neverCalled && (
                          <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400 gap-1">
                            <AlertTriangle className="w-3 h-3" /> never called back
                          </Badge>
                        )}
                        {l.urgency === "high" && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">high urgency</Badge>
                        )}
                        {l.stage && (
                          <Badge variant="outline" className="text-[10px]">{l.stage}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        {l.primary_phone_normalized && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {l.primary_phone_normalized}</span>}
                        {l.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {l.email}</span>}
                        {l.insurance_provider && <span>{l.insurance_provider}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        <span><Clock className="w-3 h-3 inline-block" /> Last inbound {fmtTime(l.last_inbound_at)} ({ageSince(l.last_inbound_at)} ago)</span>
                        {l.last_outbound_at
                          ? <span>· Last outbound {fmtTime(l.last_outbound_at)} ({ageSince(l.last_outbound_at)} ago)</span>
                          : <span className="text-rose-600 dark:text-rose-400">· No outbound yet</span>}
                        <span>· {l.inbound_count} in / {l.outbound_count} out</span>
                      </div>
                      {l.owner && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <UserIcon className="w-3 h-3" /> Owner: {l.owner.full_name ?? l.owner.email}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: "amber" | "rose" }) {
  const accentClass = accent === "rose"
    ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
    : accent === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15"
      : "";
  return (
    <div className={`border rounded-lg p-3 ${accentClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}
