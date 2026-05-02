import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  CheckCircle2, Loader2, AlertTriangle, Filter,
} from "lucide-react";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";

const WINDOW_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
];

const DISPOSITION_TONES: Record<string, "positive" | "neutral" | "negative" | "warning"> = {
  interested_followup: "positive",
  booked_intake: "positive",
  transferred: "positive",
  qualified_pending_vob: "neutral",
  voicemail_left: "neutral",
  no_answer: "neutral",
  needs_callback: "warning",
  not_qualified: "negative",
  wrong_number: "negative",
  do_not_call: "negative",
  other: "neutral",
};

const DISPOSITION_LABELS: Record<string, string> = {
  interested_followup: "Interested",
  booked_intake: "Booked",
  transferred: "Transferred",
  qualified_pending_vob: "Pending VOB",
  voicemail_left: "VM left",
  no_answer: "No answer",
  needs_callback: "Needs cb",
  not_qualified: "Not qualified",
  wrong_number: "Wrong #",
  do_not_call: "DNC",
  other: "Other",
};

const TONE_BG: Record<string, string> = {
  positive: "bg-emerald-500",
  neutral: "bg-blue-500",
  warning: "bg-amber-500",
  negative: "bg-rose-500",
};

interface DispositionedCall {
  id: string;
  specialist_disposition: string;
  disposition_set_at: string;
  call: {
    id: string;
    started_at: string | null;
    specialist: { id: string; full_name: string | null; email: string | null } | null;
  } | null;
}

export default function OpsDispositions() {
  const [rows, setRows] = useState<DispositionedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);
  const [unset, setUnset] = useState<{ total: number; today: number }>({ total: 0, today: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sinceISO = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error: err } = await supabase
      .from("call_sessions")
      .select(`id, specialist_disposition, disposition_set_at,
        specialist:profiles!call_sessions_specialist_id_fkey(id, full_name, email),
        started_at`)
      .not("specialist_disposition", "is", null)
      .gte("disposition_set_at", sinceISO)
      .order("disposition_set_at", { ascending: false })
      .limit(2000);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      specialist_disposition: r.specialist_disposition,
      disposition_set_at: r.disposition_set_at,
      call: { id: r.id, started_at: r.started_at, specialist: Array.isArray(r.specialist) ? r.specialist[0] : r.specialist },
    })) as DispositionedCall[];
    setRows(mapped);

    // Also count answered calls in window with NO disposition — that's the gap.
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const [unsetTotal, unsetToday] = await Promise.all([
      supabase.from("call_sessions").select("id", { count: "exact", head: true })
        .eq("status", "answered")
        .gte("started_at", sinceISO)
        .is("specialist_disposition", null),
      supabase.from("call_sessions").select("id", { count: "exact", head: true })
        .eq("status", "answered")
        .gte("started_at", startOfDay.toISOString())
        .is("specialist_disposition", null),
    ]);
    setUnset({ total: unsetTotal.count ?? 0, today: unsetToday.count ?? 0 });
    setLoading(false);
  }, [windowDays]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { logAudit("view", "calls", null, { surface: "ops_dispositions", window_days: windowDays }); }, [windowDays]);

  // Aggregate by specialist + by disposition.
  const { bySpecialist, byDisposition, total } = useMemo(() => {
    const spec = new Map<string, { name: string; total: number; counts: Record<string, number> }>();
    const disp = new Map<string, number>();
    for (const r of rows) {
      const sp = r.call?.specialist;
      const id = sp?.id ?? "__unknown__";
      const name = sp?.full_name ?? sp?.email ?? "Unknown";
      const cur = spec.get(id) ?? { name, total: 0, counts: {} };
      cur.total++;
      cur.counts[r.specialist_disposition] = (cur.counts[r.specialist_disposition] ?? 0) + 1;
      spec.set(id, cur);
      disp.set(r.specialist_disposition, (disp.get(r.specialist_disposition) ?? 0) + 1);
    }
    return {
      bySpecialist: [...spec.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total),
      byDisposition: [...disp.entries()].sort((a, b) => b[1] - a[1]),
      total: rows.length,
    };
  }, [rows]);

  return (
    <PageShell
      number="03"
      eyebrow="WRAP-UP"
      title="Call dispositions"
      subtitle="Specialist-set business outcomes for calls. Distinct from CTM technical status."
    >

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label={`Dispositioned (${windowDays}d)`} value={total} />
        <Tile label="Specialists with dispositions" value={bySpecialist.length} />
        <Tile label="Distinct dispositions used" value={byDisposition.length} />
        <Tile
          label="Unset (answered calls)"
          value={unset.total}
          accent={unset.today > 5 ? "amber" : undefined}
          sub={`${unset.today} today`}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Filter className="w-3 h-3" /> Window
        </span>
        {WINDOW_OPTIONS.map((w) => (
          <Button key={w.days} size="sm" variant={windowDays === w.days ? "default" : "outline"} onClick={() => setWindowDays(w.days)}>
            {w.label}
          </Button>
        ))}
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {!loading && !error && total === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          No dispositioned calls in this window. Specialists set dispositions on /live/[id] after wrap-up.
        </CardContent></Card>
      )}

      {!loading && !error && total > 0 && (
        <>
          {/* Distribution bar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Disposition mix ({windowDays}d)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-7 rounded overflow-hidden border">
                {byDisposition.map(([disp, count]) => {
                  const tone = DISPOSITION_TONES[disp] ?? "neutral";
                  const pct = (count / total) * 100;
                  return (
                    <div
                      key={disp}
                      className={`${TONE_BG[tone]} text-white text-[10px] flex items-center justify-center overflow-hidden whitespace-nowrap`}
                      style={{ width: `${pct}%` }}
                      title={`${DISPOSITION_LABELS[disp] ?? disp}: ${count} (${pct.toFixed(1)}%)`}
                    >
                      {pct >= 8 ? `${DISPOSITION_LABELS[disp] ?? disp} ${Math.round(pct)}%` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-3 text-xs">
                {byDisposition.map(([disp, count]) => {
                  const tone = DISPOSITION_TONES[disp] ?? "neutral";
                  return (
                    <div key={disp} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${TONE_BG[tone]}`} />
                      <span className="flex-1 truncate">{DISPOSITION_LABELS[disp] ?? disp}</span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Per-specialist breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By specialist</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                    <tr>
                      <th className="text-left py-2 pr-3">Specialist</th>
                      <th className="text-right py-2 pr-3">Total</th>
                      {byDisposition.slice(0, 6).map(([disp]) => (
                        <th key={disp} className="text-right py-2 pr-3 text-[10px]">{DISPOSITION_LABELS[disp] ?? disp}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bySpecialist.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="py-2 pr-3">
                          {s.id === "__unknown__"
                            ? <span className="text-muted-foreground">Unknown</span>
                            : <Link href={`/ops/specialist/${s.id}`} className="font-medium hover:underline">{s.name}</Link>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold">{s.total}</td>
                        {byDisposition.slice(0, 6).map(([disp]) => {
                          const n = s.counts[disp] ?? 0;
                          return (
                            <td key={disp} className="py-2 pr-3 text-right tabular-nums">
                              {n === 0 ? <span className="text-muted-foreground">—</span> : n}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Answered-but-undispositioned warning */}
          {unset.today > 5 && (
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="flex-1 text-sm">
                  <span className="font-semibold">{unset.today}</span> answered calls today haven't been dispositioned.
                  Remind specialists to wrap up calls on <code className="bg-muted px-1 rounded text-xs">/live/[id]</code> after each conversation.
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}

function Tile({ label, value, accent, sub }: { label: string; value: number; accent?: "amber"; sub?: string }) {
  const accentClass = accent === "amber" ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15" : "";
  return (
    <div className={`border rounded-lg p-3 ${accentClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
