import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  ShieldCheck, Loader2, Search, Eye, Edit3, Download, Trash2,
  CheckCircle2, XCircle, ChevronRight, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user: { full_name: string | null; email: string | null } | null;
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  view: <Eye className="w-3.5 h-3.5 text-blue-500" />,
  edit: <Edit3 className="w-3.5 h-3.5 text-amber-500" />,
  export: <Download className="w-3.5 h-3.5 text-violet-500" />,
  delete: <Trash2 className="w-3.5 h-3.5 text-rose-500" />,
  approve: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  reject: <XCircle className="w-3.5 h-3.5 text-rose-500" />,
};

function fmtTime(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

// Build the in-app deep link for a resource so an auditor can pivot
// straight to the thing that was accessed.
function resourceLink(type: string, id: string | null): string | null {
  if (!id) return null;
  switch (type) {
    case "lead": return `/leads/${id}`;
    case "call_session": return `/live/${id}`;
    case "transcript": return `/live/${id}`;
    case "kb_document": return `/kb`;
    case "training_assignment": return `/ops/training-assignments`;
    default: return null;
  }
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resourceFilter, setResourceFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("audit_log")
      .select(`*, user:profiles!audit_log_user_id_fkey(full_name, email)`)
      .order("created_at", { ascending: false })
      .limit(500);
    if (actionFilter !== "all") q = q.eq("action", actionFilter);
    if (resourceFilter !== "all") q = q.eq("resource_type", resourceFilter);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as AuditRow[]);
    setLoading(false);
  }, [actionFilter, resourceFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      const userName = (r.user?.full_name ?? r.user?.email ?? "").toLowerCase();
      return userName.includes(s)
        || r.resource_type.toLowerCase().includes(s)
        || (r.resource_id ?? "").toLowerCase().includes(s)
        || JSON.stringify(r.details ?? {}).toLowerCase().includes(s);
    });
  }, [rows, search]);

  const distinctActions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);
  const distinctResources = useMemo(() => Array.from(new Set(rows.map((r) => r.resource_type))).sort(), [rows]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6" /> Audit log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            PHI access trail. Every view, edit, and export of caller / call data shows here.
            Required for HIPAA review.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, resource type, ID, or details…"
            className="pl-9"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-9 px-2 rounded-md border bg-background text-sm"
        >
          <option value="all">All actions</option>
          {distinctActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
          className="h-9 px-2 rounded-md border bg-background text-sm"
        >
          <option value="all">All resources</option>
          {distinctResources.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading audit trail…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && filtered.length === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          No audit entries match these filters.
        </CardContent></Card>
      )}

      {!loading && filtered.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b text-left">
                  <tr>
                    <th className="p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">When</th>
                    <th className="p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                    <th className="p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                    <th className="p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Resource</th>
                    <th className="p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Details</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((r) => {
                    const link = resourceLink(r.resource_type, r.resource_id);
                    return (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="p-2 text-xs whitespace-nowrap">{fmtTime(r.created_at)}</td>
                        <td className="p-2">
                          <div className="text-sm font-medium truncate max-w-[140px]">
                            {r.user?.full_name ?? r.user?.email ?? "—"}
                          </div>
                        </td>
                        <td className="p-2">
                          <span className="inline-flex items-center gap-1.5">
                            {ACTION_ICON[r.action] ?? <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className="text-xs">{r.action}</span>
                          </span>
                        </td>
                        <td className="p-2 text-xs">
                          <Badge variant="outline" className="text-[10px]">{r.resource_type}</Badge>
                          {r.resource_id && (
                            <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate max-w-[200px]">
                              {r.resource_id}
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-[11px] text-muted-foreground max-w-[280px] truncate">
                          {r.details ? Object.entries(r.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ") : "—"}
                        </td>
                        <td className="p-2 text-right">
                          {link && (
                            <Link href={link} className="text-muted-foreground hover:text-foreground">
                              <ChevronRight className="w-4 h-4" />
                            </Link>
                          )}
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

      <Card className="border-muted">
        <CardContent className="pt-4 pb-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Note:</strong> this is access logging at the application
          layer. For full HIPAA compliance, also enable Postgres-level auditing (pgaudit), ship logs
          to an off-platform store with retention controls, and ensure the BAA covers the storage
          backend. The audit_log table itself has no automatic redaction — if details include PHI,
          treat this page as PHI access.
        </CardContent>
      </Card>
    </div>
  );
}
