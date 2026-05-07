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
  Loader2, Calendar, ArrowLeft, ExternalLink, RefreshCw, MapPin, User, Clock, X,
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

  // Build the rep filter list — every Zoho user who appears in the
  // current result PLUS every user in the cached map. Sort by name.
  const allOwners = useMemo(() => {
    if (!data) return [];
    const ownerSet = new Set<string>();
    for (const m of data.upcoming) if (m["Owner.id"]) ownerSet.add(m["Owner.id"]);
    for (const m of data.recent) if (m["Owner.id"]) ownerSet.add(m["Owner.id"]);
    // Also include selected reps that may have zero matches under the
    // current window so they don't disappear from the chip row.
    for (const id of repIds) ownerSet.add(id);
    const list = Array.from(ownerSet).map((id) => ({
      id,
      name: data.users?.[id]?.full_name ?? data.users?.[id]?.email ?? `(zoho ${id.slice(-6)})`,
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, repIds]);

  const upcoming = data?.upcoming ?? [];
  const recent = data?.recent ?? [];

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

      {/* Rep filter */}
      {allOwners.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rep</span>
          <Button
            size="sm"
            variant={repIds.size === 0 ? "default" : "outline"}
            onClick={() => setRepIds(new Set())}
            className="h-7 text-[11px] px-2"
          >
            All ({allOwners.length})
          </Button>
          {allOwners.map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant={repIds.has(o.id) ? "default" : "outline"}
              onClick={() => toggleRep(o.id)}
              className="h-7 text-[11px] px-2 gap-1"
              title={`Owner.id ${o.id}`}
            >
              {o.name}
              {repIds.has(o.id) && <X className="w-3 h-3" />}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground ml-2">
            {loading ? "loading…" : `${upcoming.length} upcoming · ${recent.length} recent`}
          </span>
        </div>
      )}

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* Upcoming — only meaningful when window includes the future. */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-500" /> Upcoming · {upcoming.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MeetingList rows={upcoming} repName={repName} />
          </CardContent>
        </Card>
      )}

      {/* Recent — only meaningful when window includes the past. */}
      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-500" /> Recent · {recent.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MeetingList rows={recent} repName={repName} />
          </CardContent>
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

function MeetingList({ rows, repName }: { rows: ZohoEvent[]; repName: (z: string | null | undefined) => string }) {
  return (
    <div className="space-y-2">
      {rows.map((m) => {
        const what = m.What_Id;
        const who = m.Who_Id;
        const companyName = typeof what === "string" ? what : (what?.name ?? null);
        const contactName = typeof who === "string" ? who : (who?.name ?? null);
        return (
          <div key={m.id} className="border rounded-md p-3 hover:bg-accent/20 transition-colors">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{m.Event_Title ?? "(untitled)"}</span>
                  <Badge variant="outline" className="text-[10px]">{daysFromNow(m.Start_DateTime)}</Badge>
                  {companyName && (
                    <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-700 dark:text-blue-300">
                      {companyName}
                    </Badge>
                  )}
                  {contactName && (
                    <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-700 dark:text-violet-300">
                      with {contactName}
                    </Badge>
                  )}
                  {!companyName && !contactName && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground" title="No related record set in Zoho — link this meeting to a company or contact for better attribution">
                      no link
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {fmtDateTime(m.Start_DateTime)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3 h-3" /> {repName(m["Owner.id"])}
                  </span>
                  {m.Venue && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {m.Venue}
                    </span>
                  )}
                </div>
                {m.Description && (
                  <p className="text-xs text-muted-foreground italic line-clamp-2 mt-1">{m.Description}</p>
                )}
              </div>
              <a
                href={`https://crm.zoho.com/crm/tab/Events/${m.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0"
              >
                Zoho <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
