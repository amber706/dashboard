// /bd/meetings — Phase 1 read-only Zoho meetings list.
//
// Scope:
//   - Upcoming meetings (next 30 days) grouped by owner
//   - Recently completed meetings (last 14 days)
//   - Filter by BD rep
//   - Click a row → opens the meeting in Zoho CRM
//
// Phase 2 (queued):
//   - Two-way write-back: schedule/edit from app pushes to Zoho
//   - Local meeting_records table mirroring Zoho with sync status
//   - Conflict resolution UI (kept-mine / kept-theirs / merge)
//   - Linked referral/admit
//   - Notes editor with auto-push
//   - Meeting outcome + follow-up tasks

import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, Calendar, ArrowLeft, ExternalLink, RefreshCw, MapPin, User, Clock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

interface ZohoEvent {
  id: string;
  Event_Title: string | null;
  Description: string | null;
  Start_DateTime: string;
  End_DateTime: string | null;
  Venue: string | null;
  "Owner.id": string | null;
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

export default function BdMeetings() {
  const [upcoming, setUpcoming] = useState<ZohoEvent[]>([]);
  const [recent, setRecent] = useState<ZohoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string | null; email: string | null; zoho_user_id: string | null }>>([]);
  const [repFilter, setRepFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("is_active", true)
        .not("zoho_user_id", "is", null)
        .order("full_name");
      setProfiles((data ?? []) as any);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const repProfile = profiles.find((p) => p.id === repFilter);
      const repZoho = repProfile?.zoho_user_id ?? null;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-meetings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...(repZoho ? { rep_id: repZoho } : {}),
          days_back: 14,
          days_forward: 30,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setUpcoming(json.upcoming ?? []);
      setRecent(json.recent ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repFilter, profiles]);

  useEffect(() => { load(); }, [load]);

  function repName(zohoId: string | null | undefined): string {
    if (!zohoId) return "—";
    const p = profiles.find((p) => p.zoho_user_id === zohoId);
    return p?.full_name ?? p?.email ?? `(zoho ${zohoId.slice(-6)})`;
  }

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Meetings"
      subtitle="Upcoming and recently-completed BD meetings from Zoho. Phase 1 is read-only — two-way sync (create / edit / notes) ships next."
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
        </div>
      }
    >
      {/* Rep filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rep</span>
        <select
          value={repFilter}
          onChange={(e) => setRepFilter(e.target.value)}
          className="h-8 text-xs px-2 rounded border bg-background"
        >
          <option value="all">All BD reps</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-2">
          {loading ? "loading…" : `${upcoming.length} upcoming · ${recent.length} recent`}
        </span>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* Upcoming */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" /> Upcoming · next 30 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && upcoming.length === 0 ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading from Zoho…
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming meetings.</p>
          ) : (
            <MeetingList rows={upcoming} repName={repName} />
          )}
        </CardContent>
      </Card>

      {/* Recent */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-violet-500" /> Recent · last 14 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent meetings.</p>
          ) : (
            <MeetingList rows={recent} repName={repName} />
          )}
        </CardContent>
      </Card>

      {/* Phase 2 */}
      <Card className="border-dashed">
        <CardContent className="pt-3 pb-3 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold uppercase tracking-wider">Coming next (Phase 2)</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Schedule a meeting in-app with two-way push to Zoho</li>
            <li>Edit notes / agenda / outcome → auto-syncs back to Zoho</li>
            <li>Link a meeting to a specific referral or admit</li>
            <li>Sync status indicator (Synced / Pending / Failed / Conflict)</li>
            <li>Conflict resolution (Keep mine / Keep Zoho / Merge)</li>
            <li>Follow-up tasks created in Zoho Tasks module</li>
          </ul>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function MeetingList({ rows, repName }: { rows: ZohoEvent[]; repName: (z: string | null | undefined) => string }) {
  return (
    <div className="space-y-2">
      {rows.map((m) => (
        <div key={m.id} className="border rounded-md p-3 hover:bg-accent/20 transition-colors">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{m.Event_Title ?? "(untitled)"}</span>
                <Badge variant="outline" className="text-[10px]">{daysFromNow(m.Start_DateTime)}</Badge>
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
      ))}
    </div>
  );
}
