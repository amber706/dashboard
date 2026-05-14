// DrillDownSheet — slides in from the right whenever any KPI on the
// SpecialistOverview grid is clicked. Loads the underlying records
// from /functions/v1/specialist-drilldown and renders a table whose
// column set matches the metric "kind":
//
//   kind = "calls"            → call_sessions table (inbound / outbound
//                               / missed / callbacks_waiting)
//   kind = "callback_elapsed" → callback timing breakdown
//   kind = "scores"           → call_scores table (QA)
//   kind = "deals"            → Zoho Deals table (admits, scheduled,
//                               leads, vobs, pipeline)
//   kind = "tasks"            → Zoho Tasks table
//
// Each row is a deep link where useful — call rows go to /leads/:id or
// the live-call view, deals open in Zoho, tasks open in Zoho.

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, ExternalLink, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export type DrillMetric =
  | "inbound_today" | "outbound_today" | "missed_today" | "callbacks_waiting"
  | "admits_today" | "scheduled_24h" | "admits_mtd"
  | "open_leads_mtd" | "vobs_mtd"
  | "open_tasks" | "avg_callback_time" | "avg_qa_score"
  | "pipeline_stage";

export interface DrillTarget {
  metric: DrillMetric;
  title: string;
  subtitle?: string;
  loc?: string;
  stage?: string;
}

interface DrillResponse {
  ok: boolean;
  kind: "calls" | "callback_elapsed" | "scores" | "deals" | "tasks";
  rows: any[];
  total: number;
  error?: string;
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString();
}
function fmtDur(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r === 0 ? `${m}m` : `${m}m ${r}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}
function scoreTone(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (n >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function DrillDownSheet({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const open = target !== null;
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/specialist-drilldown`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            metric: target.metric,
            loc: target.loc,
            stage: target.stage,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error ?? "drilldown failed");
        setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target]);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader className="space-y-1">
          <SheetTitle className="flex items-center gap-2">
            {target?.title ?? "Detail"}
            {data && <Badge variant="outline" className="text-[10px]">{data.total} {data.total === 1 ? "row" : "rows"}</Badge>}
          </SheetTitle>
          {target?.subtitle && (
            <SheetDescription className="text-xs">{target.subtitle}</SheetDescription>
          )}
        </SheetHeader>

        <div className="mt-4">
          {loading && (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading rows…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}
          {data && data.rows.length === 0 && (
            <div className="rounded-md border bg-muted/30 px-3 py-4 text-sm text-muted-foreground text-center">
              No records.
            </div>
          )}
          {data && data.rows.length > 0 && (
            <>
              {data.kind === "calls" && <CallsTable rows={data.rows} />}
              {data.kind === "callback_elapsed" && <CallbackElapsedTable rows={data.rows} />}
              {data.kind === "scores" && <ScoresTable rows={data.rows} />}
              {data.kind === "deals" && <DealsTable rows={data.rows} />}
              {data.kind === "tasks" && <TasksTable rows={data.rows} />}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Per-kind tables ────────────────────────────────────────────────

function CallsTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 pr-3">When</th>
            <th className="text-left py-1.5 pr-3">Caller</th>
            <th className="text-left py-1.5 pr-3">Direction</th>
            <th className="text-left py-1.5 pr-3">Status</th>
            <th className="text-right py-1.5 pr-3">Talk</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-accent/20 transition-colors">
              <td className="py-1.5 pr-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
              <td className="py-1.5 pr-3 text-xs">
                <div className="font-medium">{r.caller_name ?? "Unknown"}</div>
                {r.caller_phone && <div className="text-muted-foreground">{r.caller_phone}</div>}
              </td>
              <td className="py-1.5 pr-3 text-xs">
                <Badge variant="outline" className="text-[10px] capitalize">{r.direction}</Badge>
              </td>
              <td className="py-1.5 pr-3 text-xs">
                <Badge variant="outline" className={`text-[10px] capitalize ${r.status === "missed" ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : ""}`}>
                  {r.status}
                </Badge>
                {r.callback_status === "pending" && (
                  <Badge variant="outline" className="ml-1 text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">
                    callback pending
                  </Badge>
                )}
              </td>
              <td className="py-1.5 pr-3 text-xs text-right tabular-nums">{fmtDur(r.talk_seconds)}</td>
              <td className="py-1.5 pr-3 text-right">
                <Link href={`/wrap-up/${r.id}`}>
                  <button className="text-primary hover:underline text-xs">Open</button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallbackElapsedTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 pr-3">Missed at</th>
            <th className="text-left py-1.5 pr-3">Caller</th>
            <th className="text-left py-1.5 pr-3">Returned at</th>
            <th className="text-right py-1.5 pr-3">Elapsed</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
              <td className="py-1.5 pr-3 text-xs">
                <div className="font-medium">{r.caller_name ?? "Unknown"}</div>
                {r.caller_phone && <div className="text-muted-foreground">{r.caller_phone}</div>}
              </td>
              <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.callback_completed_at)}</td>
              <td className="py-1.5 pr-3 text-xs text-right tabular-nums font-medium">
                {fmtDur(r.callback_elapsed_seconds)}
              </td>
              <td className="py-1.5 pr-3 text-right">
                <Link href={`/wrap-up/${r.id}`}>
                  <button className="text-primary hover:underline text-xs">Open</button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoresTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 pr-3">Call</th>
            <th className="text-left py-1.5 pr-3">Caller</th>
            <th className="text-right py-1.5 pr-3">Composite</th>
            <th className="text-right py-1.5 pr-3">Quality</th>
            <th className="text-right py-1.5 pr-3">Compliance</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
              <td className="py-1.5 pr-3 text-xs">
                <div className="font-medium">{r.caller_name ?? "Unknown"}</div>
                {r.caller_phone && <div className="text-muted-foreground">{r.caller_phone}</div>}
              </td>
              <td className={`py-1.5 pr-3 text-sm text-right tabular-nums font-semibold ${scoreTone(r.composite_score)}`}>
                {r.composite_score?.toFixed(1) ?? "—"}
              </td>
              <td className="py-1.5 pr-3 text-xs text-right tabular-nums">{r.overall_quality?.toFixed(1) ?? "—"}</td>
              <td className="py-1.5 pr-3 text-xs text-right tabular-nums">{r.compliance?.toFixed(1) ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right">
                <Link href={`/wrap-up/${r.call_session_id}`}>
                  <button className="text-primary hover:underline text-xs">Open</button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealsTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 pr-3">Deal</th>
            <th className="text-left py-1.5 pr-3">Pipeline</th>
            <th className="text-left py-1.5 pr-3">Stage</th>
            <th className="text-left py-1.5 pr-3">LOC</th>
            <th className="text-left py-1.5 pr-3">Date</th>
            <th className="text-left py-1.5 pr-3">Owner</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Pick the most relevant date for the visible column based
            // on which fields the COQL pulled. Admit_Date wins for
            // admit-themed metrics; otherwise Potential_Admit_Date or
            // VOB or Created_Time fills in.
            const dateValue = r.Admit_Date ?? r.Potential_Admit_Date ?? r.VOB_Submitted_Date ?? r.Created_Time;
            const loc = r.Admitted_Level_of_Care ?? r.Level_of_Care_Requested ?? "—";
            return (
              <tr key={r.id} className="border-t">
                <td className="py-1.5 pr-3 text-xs font-medium">{r.Deal_Name ?? "(no name)"}</td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.Pipeline ?? "—"}</td>
                <td className="py-1.5 pr-3 text-xs">
                  <Badge variant="outline" className="text-[10px]">{r.Stage ?? "—"}</Badge>
                </td>
                <td className="py-1.5 pr-3 text-xs">{loc}</td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(dateValue)}</td>
                <td className="py-1.5 pr-3 text-xs">{r.owner_name ?? r.BD_Rep ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right">
                  <a
                    href={`https://crm.zoho.com/crm/tab/Potentials/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
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

function TasksTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 pr-3">Subject</th>
            <th className="text-left py-1.5 pr-3">Status</th>
            <th className="text-left py-1.5 pr-3">Priority</th>
            <th className="text-left py-1.5 pr-3">Due</th>
            <th className="text-left py-1.5 pr-3">Owner</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1.5 pr-3 text-xs font-medium">{r.Subject ?? "(no subject)"}</td>
              <td className="py-1.5 pr-3 text-xs">
                <Badge variant="outline" className="text-[10px]">{r.Status ?? "—"}</Badge>
              </td>
              <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.Priority ?? "—"}</td>
              <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.Due_Date)}</td>
              <td className="py-1.5 pr-3 text-xs">{r.owner_name ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right">
                <a
                  href={`https://crm.zoho.com/crm/tab/Tasks/${r.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-xs inline-flex items-center gap-0.5"
                >
                  Zoho <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
