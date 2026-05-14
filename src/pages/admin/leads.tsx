// /admin/leads — 1:1 mirror of the Zoho Leads module. Reads live via
// /functions/v1/zoho-leads-list on every page load. No local sync
// layer; what you see is what's in Zoho right now.
//
// Filters: free-text search across name / email / phone, Lead Status,
// Lead Source, Owner. Pagination via offset cursor.
//
// Note: this replaces the older local-mirror version that read from
// public.leads. The route is still /admin/leads for backward-compat
// with deep links, but it lives under Admissions → Workflow in the
// sidebar now and is open to all roles.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, ExternalLink, User, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LeadRow {
  id: string;
  First_Name: string | null;
  Last_Name: string | null;
  Email: string | null;
  Phone: string | null;
  Mobile: string | null;
  Lead_Status: string | null;
  Lead_Source: string | null;
  Company: string | null;
  Created_Time: string | null;
  Modified_Time: string | null;
  "Owner.id": string | null;
}

interface LeadsListResponse {
  ok: boolean;
  rows: LeadRow[];
  users: Record<string, { full_name: string | null; email: string | null }>;
  total_returned: number;
  more_records: boolean;
  offset: number;
  limit: number;
  error?: string;
}

const PAGE_SIZE = 50;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export default function AdminLeads() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [users, setUsers] = useState<Record<string, { full_name: string | null; email: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moreRecords, setMoreRecords] = useState(false);

  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  // Debounce the free-text input so we don't fire a COQL on every
  // keystroke. 300ms feels responsive without thrashing Zoho.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setOffset(0);
  }, [qDebounced, statusFilter, sourceFilter, ownerFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoho-leads-list`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          q: qDebounced || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          source: sourceFilter === "all" ? undefined : sourceFilter,
          owner_id: ownerFilter === "all" ? undefined : ownerFilter,
          limit: PAGE_SIZE,
          offset,
        }),
      });
      const json = (await res.json()) as LeadsListResponse;
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setRows(json.rows);
      setUsers(json.users ?? {});
      setMoreRecords(json.more_records);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [qDebounced, statusFilter, sourceFilter, ownerFilter, offset]);

  useEffect(() => { load(); }, [load]);

  // Build filter option lists from what we see in the current page —
  // union across renders so they keep growing as the user paginates.
  const [knownStatuses, setKnownStatuses] = useState<Set<string>>(new Set());
  const [knownSources, setKnownSources] = useState<Set<string>>(new Set());
  useEffect(() => {
    setKnownStatuses((prev) => {
      const next = new Set(prev);
      for (const r of rows) if (r.Lead_Status) next.add(r.Lead_Status);
      return next;
    });
    setKnownSources((prev) => {
      const next = new Set(prev);
      for (const r of rows) if (r.Lead_Source) next.add(r.Lead_Source);
      return next;
    });
  }, [rows]);

  const ownerOptions = useMemo(() => {
    return Object.entries(users)
      .map(([id, u]) => ({ id, name: u.full_name ?? u.email ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  function ownerName(id: string | null): string {
    if (!id) return "—";
    return users[id]?.full_name ?? users[id]?.email ?? `(zoho ${id.slice(-6)})`;
  }

  function displayName(r: LeadRow): string {
    const n = [r.First_Name, r.Last_Name].filter(Boolean).join(" ").trim();
    return n || r.Email || r.Phone || r.Mobile || "(no name)";
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <User className="w-6 h-6" /> Leads
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Live mirror of Zoho's Leads module. Edits made in Zoho appear here on refresh.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-9 gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search name, email, or phone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All statuses</SelectItem>
              {Array.from(knownStatuses).sort().map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All sources</SelectItem>
              {Array.from(knownSources).sort().map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All owners</SelectItem>
              {ownerOptions.map((o) => (
                <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-rose-600 dark:text-rose-400">{error}</CardContent>
        </Card>
      )}

      {/* Results table */}
      <Card>
        <CardContent className="pt-0 pb-0">
          {loading && rows.length === 0 ? (
            <div className="py-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading leads…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No leads match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 px-3">Name</th>
                    <th className="text-left py-2 px-3">Contact</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Source</th>
                    <th className="text-left py-2 px-3">Owner</th>
                    <th className="text-left py-2 px-3">Modified</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-accent/30 transition-colors">
                      <td className="py-2 px-3">
                        <div className="font-medium text-sm">{displayName(r)}</div>
                        {r.Company && (
                          <div className="text-[11px] text-muted-foreground">{r.Company}</div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {r.Email && <div className="text-muted-foreground">{r.Email}</div>}
                        {(r.Phone || r.Mobile) && (
                          <div className="text-muted-foreground tabular-nums">{r.Phone ?? r.Mobile}</div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {r.Lead_Status ? (
                          <Badge variant="outline" className="text-[10px]">{r.Lead_Status}</Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{r.Lead_Source ?? "—"}</td>
                      <td className="py-2 px-3 text-xs">{ownerName(r["Owner.id"])}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.Modified_Time)}</td>
                      <td className="py-2 px-3 text-right">
                        <a
                          href={`https://crm.zoho.com/crm/tab/Leads/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
                          title="Open in Zoho"
                        >
                          Zoho <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          Showing {offset + 1}–{offset + rows.length}
          {moreRecords ? "" : ` of ${offset + rows.length}`}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="h-7 px-2 gap-1 text-[11px]"
          >
            <ChevronLeft className="w-3 h-3" /> Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!moreRecords || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="h-7 px-2 gap-1 text-[11px]"
          >
            Next <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
