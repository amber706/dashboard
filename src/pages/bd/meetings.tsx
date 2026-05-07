// /bd/meetings — read-only Zoho meetings list with filters.
//
// Filters:
//   - Date range: presets (Past 7 / 30 days, Next 7 / 30 / 90 days,
//     This month, Custom range) — sends start_iso / end_iso to the
//     edge function.
//   - BD rep (meeting owner): multi-select chips populated from the
//     Zoho users map embedded in the bd-meetings response.
//
// Owner resolution: the edge function fetches Zoho's active users and
// embeds a { zoho_user_id → full_name } map so we never have to render
// "(zoho 968001)" stubs again.
//
// Phase 2 (queued):
//   - Two-way write-back: schedule/edit from app pushes to Zoho
//   - Local meeting_records table mirroring Zoho with sync status
//   - Conflict resolution UI

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, Calendar, ArrowLeft, ExternalLink, RefreshCw, MapPin, Clock, X,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";
import { exportCsv, isoToDay } from "@/lib/bd-csv";

interface ZohoEvent {
  id: string;
  Event_Title: string | null;
  Description: string | null;
  Start_DateTime: string;
  End_DateTime: string | null;
  Venue: string | null;
  "Owner.id": string | null;
  // What_Id is the related record (typically Account / Deal / Lead).
  // Who_Id is the related Contact (the actual person met).
  What_Id?: { id?: string; name?: string } | string | null;
  Who_Id?: { id?: string; name?: string } | string | null;
}

interface BdMeetingsResponse {
  ok: boolean;
  upcoming: ZohoEvent[];
  recent: ZohoEvent[];
  users: Record<string, { full_name: string | null; email: string | null }>;
  window: { start: string; end: string; days_back: number; days_forward: number };
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function daysFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const d = Math.round(ms / (24 * 60 * 60 * 1000));
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 0) return `in ${d}d`;
  return `${Math.abs(d)}d ago`;
}
function isoDay(d: Date): string {
  // YYYY-MM-DD in local time, used as <input type="date"> value.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dayToZohoIso(yyyymmdd: string, endOfDay: boolean): string {
  // Convert <input type="date"> value to a UTC ISO timestamp Zoho accepts.
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, 0));
  return t.toISOString().slice(0, 19) + "+00:00";
}

type Preset = {
  key: string;
  label: string;
  // Returns absolute UTC ISO start/end for the window.
  range: () => { startIso: string; endIso: string };
};

const PRESETS: Preset[] = [
  {
    key: "past_7",
    label: "Past 7 days",
    range: () => ({
      startIso: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 19) + "+00:00",
      endIso: new Date().toISOString().slice(0, 19) + "+00:00",
    }),
  },
  {
    key: "past_30",
    label: "Past 30 days",
    range: () => ({
      startIso: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 19) + "+00:00",
      endIso: new Date().toISOString().slice(0, 19) + "+00:00",
    }),
  },
  {
    key: "next_7",
    label: "Next 7 days",
    range: () => ({
      startIso: new Date().toISOString().slice(0, 19) + "+00:00",
      endIso: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 19) + "+00:00",
    }),
  },
  {
    key: "next_30",
    label: "Next 30 days",
    range: () => ({
      startIso: new Date().toISOString().slice(0, 19) + "+00:00",
      endIso: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 19) + "+00:00",
    }),
  },
  {
    key: "next_90",
    label: "Next 90 days",
    range: () => ({
      startIso: new Date().toISOString().slice(0, 19) + "+00:00",
      endIso: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 19) + "+00:00",
    }),
  },
  {
    key: "spread",
    label: "−14 / +30",
    range: () => ({
      startIso: new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 19) + "+00:00",
      endIso: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 19) + "+00:00",
    }),
  },
  {
    key: "this_month",
    label: "This month",
    range: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59);
      return {
        startIso: start.toISOString().slice(0, 19) + "+00:00",
        endIso: end.toISOString().slice(0, 19) + "+00:00",
      };
    },
  },
];

export default function BdMeetings() {
  const [data, setData] = useState<BdMeetingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [presetKey, setPresetKey] = useState<string>("spread"); // default −14 / +30
  const [customStart, setCustomStart] = useState<string>(isoDay(new Date(Date.now() - 14 * 86400_000)));
  const [customEnd, setCustomEnd] = useState<string>(isoDay(new Date(Date.now() + 30 * 86400_000)));
  const [repIds, setRepIds] = useState<Set<string>>(new Set());

  const range = useMemo(() => {
    if (presetKey === "custom") {
      return { startIso: dayToZohoIso(customStart, false), endIso: dayToZohoIso(customEnd, true) };
    }
    const p = PRESETS.find((p) => p.key === presetKey);
    return p ? p.range() : PRESETS[5].range();
  }, [presetKey, customStart, customEnd]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-meetings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          start_iso: range.startIso,
          end_iso: range.endIso,
          rep_ids: repIds.size > 0 ? Array.from(repIds) : undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range, repIds]);

  useEffect(() => { load(); }, [load]);

  function repName(zohoId: string | null | undefined): string {
    if (!zohoId) return "—";
    const u = data?.users?.[zohoId];
    if (u?.full_name) return u.full_name;
    if (u?.email) return u.email;
    return `(zoho ${zohoId.slice(-6)})`;
  }
  function toggleRep(id: string) {
    setRepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const upcoming = data?.upcoming ?? [];
  const recent = data?.recent ?? [];

  // Per-rep summary — drives both the summary table at the top of the
  // page AND the rep selector. Each row carries upcoming / today /
  // recent counts. Sorted by total desc so the busiest reps surface
  // first; ties broken by name.
  interface RepSummary {
    id: string;
    name: string;
    upcoming: number;
    today: number;
    recent: number;
    total: number;
  }
  const repSummary = useMemo((): RepSummary[] => {
    if (!data) return [];
    const map = new Map<string, RepSummary>();
    const todayKey = isoDay(new Date());
    const upsert = (id: string | null) => {
      if (!id) return null;
      let r = map.get(id);
      if (!r) {
        r = {
          id,
          name: data.users?.[id]?.full_name ?? data.users?.[id]?.email ?? `(zoho ${id.slice(-6)})`,
          upcoming: 0, today: 0, recent: 0, total: 0,
        };
        map.set(id, r);
      }
      return r;
    };
    for (const m of data.upcoming) {
      const r = upsert(m["Owner.id"]);
      if (!r) continue;
      r.upcoming++; r.total++;
      if (m.Start_DateTime && isoDay(new Date(m.Start_DateTime)) === todayKey) r.today++;
    }
    for (const m of data.recent) {
      const r = upsert(m["Owner.id"]);
      if (!r) continue;
      r.recent++; r.total++;
    }
    // Make sure selected reps stay visible even when their counts are 0
    // under the current window — otherwise the user can't deselect them.
    for (const id of repIds) {
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: data.users?.[id]?.full_name ?? data.users?.[id]?.email ?? `(zoho ${id.slice(-6)})`,
          upcoming: 0, today: 0, recent: 0, total: 0,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name),
    );
  }, [data, repIds]);

  // Group meetings by Owner.id — feeds the collapsible per-rep cards
  // inside Upcoming / Recent. Unassigned (Owner.id null) is bucketed
  // under a special "(unassigned)" key.
  function groupByRep(rows: ZohoEvent[]): Map<string, ZohoEvent[]> {
    const out = new Map<string, ZohoEvent[]>();
    for (const m of rows) {
      const id = m["Owner.id"] ?? "(unassigned)";
      if (!out.has(id)) out.set(id, []);
      out.get(id)!.push(m);
    }
    // Sort meetings within each rep by start time. Upcoming = soonest
    // first; recent stays as Zoho returned (already most-recent first).
    return out;
  }
  const upcomingByRep = useMemo(() => {
    const m = groupByRep(upcoming);
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.Start_DateTime ?? "").localeCompare(b.Start_DateTime ?? ""));
    }
    return m;
  }, [upcoming]);
  const recentByRep = useMemo(() => groupByRep(recent), [recent]);

  // Collapse state — top-level Upcoming / Recent + each per-rep group.
  // openReps keys are namespaced "up:<id>" / "re:<id>" so the same rep
  // can be expanded in one bucket and collapsed in the other.
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [showRecent, setShowRecent] = useState(false);
  const [openReps, setOpenReps] = useState<Set<string>>(new Set());
  function toggleRepOpen(key: string) {
    setOpenReps((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }
  function expandAllReps() {
    const all = new Set<string>();
    for (const id of upcomingByRep.keys()) all.add(`up:${id}`);
    for (const id of recentByRep.keys()) all.add(`re:${id}`);
    setOpenReps(all);
  }
  function collapseAllReps() {
    setOpenReps(new Set());
  }

  function downloadCsv() {
    if (!data) return;
    const all: Array<ZohoEvent & { _bucket: "upcoming" | "recent" }> = [
      ...upcoming.map((m) => ({ ...m, _bucket: "upcoming" as const })),
      ...recent.map((m) => ({ ...m, _bucket: "recent" as const })),
    ];
    const companyName = (m: ZohoEvent) => {
      const w = m.What_Id;
      return typeof w === "string" ? w : (w?.name ?? "");
    };
    const contactName = (m: ZohoEvent) => {
      const w = m.Who_Id;
      return typeof w === "string" ? w : (w?.name ?? "");
    };
    exportCsv<ZohoEvent & { _bucket: "upcoming" | "recent" }>(
      `bd-meetings-${isoToDay(range.startIso)}-to-${isoToDay(range.endIso)}.csv`,
      [
        { header: "Bucket", value: (m) => m._bucket },
        { header: "Title", value: (m) => m.Event_Title ?? "" },
        { header: "Start", value: (m) => m.Start_DateTime ?? "" },
        { header: "End", value: (m) => m.End_DateTime ?? "" },
        { header: "Company (What_Id)", value: (m) => companyName(m) },
        { header: "Contact (Who_Id)", value: (m) => contactName(m) },
        { header: "Owner (BD rep)", value: (m) => repName(m["Owner.id"]) },
        { header: "Owner Zoho ID", value: (m) => m["Owner.id"] ?? "" },
        { header: "Venue", value: (m) => m.Venue ?? "" },
        { header: "Description", value: (m) => m.Description ?? "" },
        { header: "Zoho ID", value: (m) => m.id },
      ],
      all,
    );
  }

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Meetings"
      subtitle="Zoho meetings for any window — upcoming, recent, or custom range. Phase 1 read-only; two-way sync ships next."
      maxWidth={1400}
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
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!data || (upcoming.length === 0 && recent.length === 0)} className="h-9 text-xs">
            Download CSV
          </Button>
        </div>
      }
    >
      {/* Date filter */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={presetKey === p.key ? "default" : "outline"}
              onClick={() => setPresetKey(p.key)}
              className="h-8 text-xs"
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={presetKey === "custom" ? "default" : "outline"}
            onClick={() => setPresetKey("custom")}
            className="h-8 text-xs"
          >
            Custom
          </Button>
        </div>
        {presetKey === "custom" && (
          <div className="flex items-center gap-2 flex-wrap pl-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">From</span>
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 text-xs w-40"
            />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">To</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 text-xs w-40"
            />
          </div>
        )}
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* Per-rep summary table — also acts as the rep selector. Click a
          row to toggle that rep into the filter; click the All chip to
          clear. The visual emphasis (today count colored when > 0) is
          deliberate so a manager scanning this can spot reps with no
          customer-facing time today. */}
      {data && repSummary.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                By BD rep
              </span>
              <Button
                size="sm"
                variant={repIds.size === 0 ? "default" : "outline"}
                onClick={() => setRepIds(new Set())}
                className="h-7 text-[11px] px-2"
              >
                All ({repSummary.length})
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Click a row to filter · {loading ? "loading…" : `${upcoming.length} upcoming · ${recent.length} recent`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-1.5 pr-3">Rep</th>
                    <th className="text-right py-1.5 pr-3">Today</th>
                    <th className="text-right py-1.5 pr-3">Upcoming</th>
                    <th className="text-right py-1.5 pr-3">Recent</th>
                    <th className="text-right py-1.5 pr-3">Total</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {repSummary.map((r) => {
                    const selected = repIds.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => toggleRep(r.id)}
                        className={`border-t cursor-pointer transition-colors ${selected ? "bg-primary/10" : "hover:bg-accent/30"}`}
                      >
                        <td className="py-1.5 pr-3 font-medium text-sm">{r.name}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums text-sm ${r.today > 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-muted-foreground"}`}>
                          {r.today}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sm">{r.upcoming}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sm text-muted-foreground">{r.recent}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sm font-semibold">{r.total}</td>
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

      {/* Expand / collapse-all controls for the per-rep groups below. */}
      {(upcoming.length > 0 || recent.length > 0) && (
        <div className="flex items-center justify-end gap-2 -mt-2">
          <button
            onClick={expandAllReps}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Expand all
          </button>
          <span className="text-[10px] text-muted-foreground">·</span>
          <button
            onClick={collapseAllReps}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Collapse all
          </button>
        </div>
      )}

      {/* Upcoming — collapsible from the top, then each rep is its own
          collapsible inside. Closed-by-default for Recent (which is
          historical noise) and open-by-default for Upcoming (the live
          schedule a manager actually needs to see). */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader
            className="pb-3 cursor-pointer select-none"
            onClick={() => setShowUpcoming((v) => !v)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              {showUpcoming ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <Calendar className="w-4 h-4 text-blue-500" />
              <span>Upcoming</span>
              <Badge variant="outline" className="text-[10px] ml-1">{upcoming.length}</Badge>
            </CardTitle>
          </CardHeader>
          {showUpcoming && (
            <CardContent className="space-y-2 pt-0">
              {Array.from(upcomingByRep.entries())
                .sort((a, b) => b[1].length - a[1].length)
                .map(([repId, rows]) => {
                  const key = `up:${repId}`;
                  const open = openReps.has(key);
                  return (
                    <RepGroup
                      key={key}
                      open={open}
                      onToggle={() => toggleRepOpen(key)}
                      title={repName(repId === "(unassigned)" ? null : repId)}
                      count={rows.length}
                      rows={rows}
                    />
                  );
                })}
            </CardContent>
          )}
        </Card>
      )}

      {/* Recent — same shape, closed by default. */}
      {recent.length > 0 && (
        <Card>
          <CardHeader
            className="pb-3 cursor-pointer select-none"
            onClick={() => setShowRecent((v) => !v)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              {showRecent ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <Clock className="w-4 h-4 text-violet-500" />
              <span>Recent</span>
              <Badge variant="outline" className="text-[10px] ml-1">{recent.length}</Badge>
            </CardTitle>
          </CardHeader>
          {showRecent && (
            <CardContent className="space-y-2 pt-0">
              {Array.from(recentByRep.entries())
                .sort((a, b) => b[1].length - a[1].length)
                .map(([repId, rows]) => {
                  const key = `re:${repId}`;
                  const open = openReps.has(key);
                  return (
                    <RepGroup
                      key={key}
                      open={open}
                      onToggle={() => toggleRepOpen(key)}
                      title={repName(repId === "(unassigned)" ? null : repId)}
                      count={rows.length}
                      rows={rows}
                    />
                  );
                })}
            </CardContent>
          )}
        </Card>
      )}

      {!loading && upcoming.length === 0 && recent.length === 0 && (
        <Card>
          <CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">
            No meetings in this window.
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

// One rep's group inside Upcoming / Recent. Collapsed shows just the
// header row; expanded reveals the dense list of meetings.
function RepGroup({ open, onToggle, title, count, rows }: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number;
  rows: ZohoEvent[];
}) {
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
          <span className="font-medium truncate">{title}</span>
          <Badge variant="outline" className="text-[10px]">{count}</Badge>
        </div>
      </button>
      {open && (
        <div className="border-t">
          <DenseMeetingList rows={rows} />
        </div>
      )}
    </div>
  );
}

// Dense per-row meeting list inside an expanded rep group. Tabular,
// one row per meeting — each row includes when, title, company,
// contact, venue, and a Zoho deep link. Description is dropped from
// the list view (too noisy in dense mode); it's still in CSV export.
function DenseMeetingList({ rows }: { rows: ZohoEvent[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 px-3 w-28">When</th>
            <th className="text-left py-1.5 px-3 w-20">Relative</th>
            <th className="text-left py-1.5 px-3">Title</th>
            <th className="text-left py-1.5 px-3">Company</th>
            <th className="text-left py-1.5 px-3">Contact</th>
            <th className="text-left py-1.5 px-3">Venue</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const what = m.What_Id;
            const who = m.Who_Id;
            const companyName = typeof what === "string" ? what : (what?.name ?? null);
            const contactName = typeof who === "string" ? who : (who?.name ?? null);
            return (
              <tr key={m.id} className="border-t hover:bg-accent/20 transition-colors align-top">
                <td className="py-1.5 px-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtDateTime(m.Start_DateTime)}
                </td>
                <td className="py-1.5 px-3 text-[11px]">
                  <Badge variant="outline" className="text-[10px]">{daysFromNow(m.Start_DateTime)}</Badge>
                </td>
                <td className="py-1.5 px-3 text-sm font-medium">{m.Event_Title ?? "(untitled)"}</td>
                <td className="py-1.5 px-3 text-xs">
                  {companyName ? (
                    <span className="text-blue-700 dark:text-blue-300">{companyName}</span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-1.5 px-3 text-xs">
                  {contactName ? (
                    <span className="text-violet-700 dark:text-violet-300">{contactName}</span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-1.5 px-3 text-xs text-muted-foreground">
                  {m.Venue ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[20ch]" title={m.Venue}>{m.Venue}</span>
                    </span>
                  ) : "—"}
                </td>
                <td className="py-1.5 px-3 text-right">
                  <a
                    href={`https://crm.zoho.com/crm/tab/Events/${m.id}`}
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
    </div>
  );
}
