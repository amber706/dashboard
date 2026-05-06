// /ops/rep-leads/[id] — drilldown for the Open Leads tile on the Rep
// Workload page. Shows the actual Zoho Lead rows owned by one rep,
// with all the fields a manager would want for triage:
// name, phone, email, lead status, source category, lead score, days
// since last touch, level of care, insurance type, generated-by signal,
// and the Description blob (specialist's notes from the call).
//
// Lead data comes via the zoho-rep-leads Edge Function (live Zoho COQL,
// not a local cache). Same "open" definition as the count tile:
// Modified_Time within last 90 days, Lead_Status NOT closed.

import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft, Loader2, Phone, Mail, ExternalLink, RefreshCw,
  Calendar, Star, Search, Download,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";
import { downloadCsv } from "@/lib/csv-export";

interface ZohoLead {
  id: string;
  First_Name: string | null;
  Last_Name: string | null;
  Phone: string | null;
  Mobile: string | null;
  Email: string | null;
  Lead_Status: string | null;
  Lead_Source: string | null;
  Source_Category: string | null;
  Description: string | null;
  Modified_Time: string | null;
  Created_Time: string | null;
  Lead_Score_Rating: string | null;
  Insurance_Type: string | null;
  Member_ID: string | null;
  Level_of_Care_Requested: string | null;
  Generated_By: string | null;
}

// Group statuses into a coarse priority bucket so the UI shows the most
// actionable rows at the top. Mirrors the Lead_Status taxonomy in the
// CP360 KB ("Pending Initial Contact: Urgent" = high; "Unable to
// Contact" = medium; "Potential: Still Assessing" = medium; etc.)
function statusPriority(status: string | null): number {
  if (!status) return 5;
  if (/urgent|requested call back/i.test(status)) return 0;
  if (/qualified/i.test(status)) return 1;
  if (/pending initial|potential|info missing/i.test(status)) return 2;
  if (/contacted: needs follow|follow up needed/i.test(status)) return 3;
  if (/pre-qualified/i.test(status)) return 4;
  return 5;
}

function statusTone(status: string | null): string {
  if (!status) return "border-muted text-muted-foreground";
  const p = statusPriority(status);
  if (p === 0) return "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5";
  if (p === 1) return "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5";
  if (p === 2) return "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5";
  if (p === 3) return "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5";
  return "border-muted text-muted-foreground";
}

function daysSince(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (d === 0) {
    const h = Math.floor(ms / (60 * 60 * 1000));
    if (h === 0) return `${Math.floor(ms / 60000)}m`;
    return `${h}h`;
  }
  if (d === 1) return "1d";
  return `${d}d`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Star rating shorthand: Lead_Score_Rating in Zoho is a string like
// "⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, Ready". Pull just the
// star count for compact display.
function scoreStars(rating: string | null): { stars: number; label: string } {
  if (!rating) return { stars: 0, label: "" };
  const stars = (rating.match(/⭐/g) ?? []).length;
  const label = rating.replace(/⭐/g, "").trim();
  return { stars, label };
}

export default function RepLeadsDrilldown() {
  const params = useParams<{ id: string }>();
  const repId = params.id;
  const [profile, setProfile] = useState<{ id: string; full_name: string | null; email: string | null; zoho_user_id: string | null } | null>(null);
  const [leads, setLeads] = useState<ZohoLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const PAGE_SIZE = 100;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("id", repId)
        .maybeSingle();
      setProfile(data as any);
    })();
  }, [repId]);

  async function load(append = false) {
    if (!profile?.zoho_user_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoho-rep-leads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          zoho_user_id: profile.zoho_user_id,
          limit: PAGE_SIZE,
          offset: append ? offset : 0,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      const newLeads = (json.leads ?? []) as ZohoLead[];
      // Sort by status priority, then by recency
      newLeads.sort((a, b) => {
        const p = statusPriority(a.Lead_Status) - statusPriority(b.Lead_Status);
        if (p !== 0) return p;
        return (b.Modified_Time ?? "").localeCompare(a.Modified_Time ?? "");
      });
      setLeads(append ? [...leads, ...newLeads] : newLeads);
      setHasMore(Boolean(json.has_more));
      setOffset((append ? offset : 0) + newLeads.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile?.zoho_user_id) {
      load(false);
    } else if (profile && !profile.zoho_user_id) {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.zoho_user_id]);

  // Apply client-side search + status filter on top of the loaded set.
  const distinctStatuses = Array.from(new Set(leads.map((l) => l.Lead_Status).filter(Boolean))) as string[];
  const filtered = leads.filter((l) => {
    if (statusFilter !== "all" && l.Lead_Status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (l.First_Name ?? "").toLowerCase().includes(q) ||
      (l.Last_Name ?? "").toLowerCase().includes(q) ||
      (l.Phone ?? "").includes(q) ||
      (l.Email ?? "").toLowerCase().includes(q) ||
      (l.Description ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <PageShell
      eyebrow="DRILLDOWN"
      title={profile ? `${profile.full_name ?? profile.email ?? "Rep"} — Open Leads` : "Open Leads"}
      subtitle="Live Zoho lead pipeline for this rep. Modified within the last 90 days, status not closed/disqualified. Sorted by triage priority then recency."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/ops/workload" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Workload
          </Link>
          <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          {leads.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => downloadCsv(`${profile?.full_name ?? "rep"}-open-leads.csv`, filtered, [
                { key: "First_Name", label: "First" },
                { key: "Last_Name", label: "Last" },
                { key: "Phone", label: "Phone" },
                { key: "Email", label: "Email" },
                { key: "Lead_Status", label: "Status" },
                { key: "Source_Category", label: "Source" },
                { key: "Lead_Score_Rating", label: "Score" },
                { key: "Insurance_Type", label: "Insurance" },
                { key: "Level_of_Care_Requested", label: "LOC" },
                { key: "Generated_By", label: "Generated By" },
                { key: "Modified_Time", label: "Last Modified" },
                { key: "Created_Time", label: "Created" },
                { key: "Description", label: "Notes" },
              ])}
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        </div>
      }
    >
      {profile && !profile.zoho_user_id && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 text-sm">
            This rep doesn't have a Zoho user mapping yet — we can't pull their Zoho leads.
            Add their Zoho user_id to the profiles table or have them log into Zoho with the
            email <code className="text-xs">{profile.email ?? "(unknown)"}</code> to get auto-linked.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {profile?.zoho_user_id && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, email, notes…"
                className="pl-8 h-8 w-72"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 text-xs px-2 rounded border bg-background"
            >
              <option value="all">All statuses ({leads.length})</option>
              {distinctStatuses.sort((a, b) => statusPriority(a) - statusPriority(b)).map((s) => {
                const count = leads.filter((l) => l.Lead_Status === s).length;
                return <option key={s} value={s}>{s} ({count})</option>;
              })}
            </select>
            <span className="text-xs text-muted-foreground ml-2">
              Showing {filtered.length} of {leads.length} loaded
            </span>
          </div>

          {/* Lead cards */}
          {loading && leads.length === 0 ? (
            <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading leads from Zoho…
            </CardContent></Card>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
              {leads.length === 0 ? "No open leads in the last 90 days." : "No leads match your filter."}
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((lead) => {
                const score = scoreStars(lead.Lead_Score_Rating);
                const callerName = [lead.First_Name, lead.Last_Name].filter(Boolean).join(" ") || "(no name)";
                return (
                  <Card key={lead.id} className="hover:bg-accent/20 transition-colors">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {/* Top row: name + status + score */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-[15px]">{callerName}</span>
                            {lead.Lead_Status && (
                              <Badge variant="outline" className={`text-[10px] ${statusTone(lead.Lead_Status)}`}>
                                {lead.Lead_Status}
                              </Badge>
                            )}
                            {score.stars > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-xs">
                                {Array.from({ length: score.stars }).map((_, i) => (
                                  <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
                                ))}
                              </span>
                            )}
                          </div>
                          {/* Contact row */}
                          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            {lead.Phone && (
                              <span className="inline-flex items-center gap-1 font-mono"><Phone className="w-3 h-3" /> {lead.Phone}</span>
                            )}
                            {lead.Email && (
                              <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> {lead.Email}</span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> last touch {daysSince(lead.Modified_Time)} ago
                              <span className="opacity-60">· created {fmtDate(lead.Created_Time)}</span>
                            </span>
                          </div>
                          {/* Meta row: source + insurance + LOC + generator */}
                          <div className="flex items-center gap-2 flex-wrap text-[11px]">
                            {lead.Source_Category && (
                              <Badge variant="outline" className="text-[10px]">src: {lead.Source_Category}</Badge>
                            )}
                            {lead.Generated_By && lead.Generated_By !== lead.Source_Category && (
                              <Badge variant="outline" className="text-[10px]">gen: {lead.Generated_By}</Badge>
                            )}
                            {lead.Insurance_Type && (
                              <Badge variant="outline" className="text-[10px]">{lead.Insurance_Type}</Badge>
                            )}
                            {lead.Level_of_Care_Requested && (
                              <Badge variant="outline" className="text-[10px]">LOC: {lead.Level_of_Care_Requested}</Badge>
                            )}
                            {lead.Member_ID && (
                              <Badge variant="outline" className="text-[10px] font-mono">member {lead.Member_ID}</Badge>
                            )}
                          </div>
                          {/* Notes preview */}
                          {lead.Description && (
                            <div className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2 mt-1.5 line-clamp-2">
                              {lead.Description}
                            </div>
                          )}
                          {/* Lead-score detail (the text after the stars) */}
                          {score.label && (
                            <div className="text-[10px] text-muted-foreground/80">{score.label}</div>
                          )}
                        </div>
                        <a
                          href={`https://crm.zoho.com/crm/org${lead.id.slice(0, 7)}/tab/Leads/${lead.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                          title="Open in Zoho CRM"
                        >
                          Zoho <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
                {loading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
