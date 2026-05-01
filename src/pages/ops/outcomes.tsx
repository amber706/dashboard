import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  TrendingUp, Loader2, Trophy, XCircle, Clock,
  Users, Activity, ChevronDown, ChevronRight, Phone, Calendar,
  Settings, Plus, Trash2, Save, AlertTriangle, Download,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Category = "won" | "lost" | "in_progress";

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  stage: string | null;
  outcome_category: Category | null;
  outcome_set_at: string | null;
  first_touch_source_category: string | null;
  insurance_provider: string | null;
  last_touch_call_id: string | null;
  first_touch_call_id: string | null;
  owner_id: string | null;
  created_at: string;
  last_touch_call: { id: string; ctm_call_id: string; started_at: string | null; ctm_raw_payload: any; specialist_id: string | null } | null;
  owner: { id: string; full_name: string | null; email: string | null } | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  won: "Admitted",
  lost: "Churned",
  in_progress: "In progress",
};

const CATEGORY_CLASS: Record<Category, string> = {
  won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  lost: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function OpsOutcomes() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [expandedSection, setExpandedSection] = useState<"specialist" | "source" | "insurance" | null>("specialist");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from("leads")
      .select(`
        id, first_name, last_name, primary_phone_normalized, stage,
        outcome_category, outcome_set_at, first_touch_source_category, insurance_provider,
        last_touch_call_id, first_touch_call_id, owner_id, created_at,
        last_touch_call:call_sessions!leads_last_touch_call_id_fkey(id, ctm_call_id, started_at, ctm_raw_payload, specialist_id),
        owner:profiles!leads_owner_id_fkey(id, full_name, email)
      `)
      .gte("created_at", since)
      .order("outcome_set_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (filter !== "all") q = q.eq("outcome_category", filter);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setLeads((data ?? []) as unknown as LeadRow[]);
    setLoading(false);
  }, [filter, windowDays]);

  useEffect(() => { load(); }, [load]);

  // Audit: viewing the outcomes lead list exposes lead PHI + stage info.
  useEffect(() => {
    logAudit("view", "outcomes", null, { window_days: windowDays, filter, surface: "ops_outcomes" });
  }, [windowDays, filter]);

  // Rollups across the loaded leads.
  const { totals, conversionPct, bySpecialist, bySource, byInsurance } = useMemo(() => {
    const t: Record<Category, number> = { won: 0, lost: 0, in_progress: 0 };
    const spec = new Map<string, { name: string; won: number; lost: number; in_progress: number }>();
    const src = new Map<string, { won: number; lost: number; in_progress: number }>();
    const ins = new Map<string, { won: number; lost: number; in_progress: number }>();

    for (const l of leads) {
      const cat = l.outcome_category ?? "in_progress";
      t[cat]++;

      // Specialist credit goes to the last_touch_call's specialist (if any),
      // else the lead owner. Reps with neither are bucketed as "Unattributed".
      const callSpecialist = l.last_touch_call?.specialist_id ?? null;
      const ownerSpecialist = l.owner?.id ?? null;
      const specId = callSpecialist ?? ownerSpecialist ?? "__unattributed__";
      const specName = specId === "__unattributed__"
        ? "Unattributed"
        : (l.owner?.full_name ?? l.owner?.email ?? "Unknown");
      const cur = spec.get(specId) ?? { name: specName, won: 0, lost: 0, in_progress: 0 };
      cur[cat]++;
      spec.set(specId, cur);

      const source = l.first_touch_source_category ?? "Unknown";
      const sCur = src.get(source) ?? { won: 0, lost: 0, in_progress: 0 };
      sCur[cat]++;
      src.set(source, sCur);

      const insurance = l.insurance_provider?.trim() || "Unknown";
      const iCur = ins.get(insurance) ?? { won: 0, lost: 0, in_progress: 0 };
      iCur[cat]++;
      ins.set(insurance, iCur);
    }

    const closed = t.won + t.lost;
    const pct = closed > 0 ? Math.round((t.won / closed) * 100) : null;
    return {
      totals: t,
      conversionPct: pct,
      bySpecialist: [...spec.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
      bySource: [...src.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
      byInsurance: [...ins.entries()].map(([insurance, v]) => ({ insurance, ...v })).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
    };
  }, [leads]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <TrendingUp className="w-6 h-6" /> Outcome attribution
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Which calls, specialists, and sources actually drove patients into treatment.
          Outcomes pull from Zoho lead stages; mappings are editable and additions are
          treated as in-progress until classified.
        </p>
      </div>

      {/* Top rollup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Last {windowDays} days</span>
            <div className="flex gap-1">
              {[7, 30, 90, 365].map((d) => (
                <Button key={d} size="sm" variant={windowDays === d ? "default" : "outline"} onClick={() => setWindowDays(d)}>
                  {d === 365 ? "1y" : `${d}d`}
                </Button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <RollupTile icon={<Trophy className="w-4 h-4" />} label="Admitted" value={totals.won} accent="emerald"
              active={filter === "won"} onClick={() => setFilter(filter === "won" ? "all" : "won")} />
            <RollupTile icon={<XCircle className="w-4 h-4" />} label="Churned" value={totals.lost} accent="rose"
              active={filter === "lost"} onClick={() => setFilter(filter === "lost" ? "all" : "lost")} />
            <RollupTile icon={<Clock className="w-4 h-4" />} label="In progress" value={totals.in_progress}
              active={filter === "in_progress"} onClick={() => setFilter(filter === "in_progress" ? "all" : "in_progress")} />
            <RollupTile icon={<Activity className="w-4 h-4" />} label="Conversion rate" value={conversionPct == null ? "—" : `${conversionPct}%`}
              sub={`${totals.won}/${totals.won + totals.lost} closed`} />
          </div>
        </CardContent>
      </Card>

      {/* Per-specialist + per-source + per-insurance breakdowns */}
      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <BreakdownCard
          title="By specialist (last-touch credit)"
          icon={<Users className="w-4 h-4" />}
          rows={bySpecialist.map((r) => ({ id: r.id, label: r.name, won: r.won, lost: r.lost, in_progress: r.in_progress }))}
          expanded={expandedSection === "specialist"}
          onToggle={() => setExpandedSection(expandedSection === "specialist" ? null : "specialist")}
        />
        <BreakdownCard
          title="By marketing source (first-touch)"
          icon={<TrendingUp className="w-4 h-4" />}
          rows={bySource.map((r) => ({ id: r.source, label: r.source, ...r }))}
          expanded={expandedSection === "source"}
          onToggle={() => setExpandedSection(expandedSection === "source" ? null : "source")}
        />
        <BreakdownCard
          title="By insurance provider"
          icon={<Activity className="w-4 h-4" />}
          rows={byInsurance.map((r) => ({ id: r.insurance, label: r.insurance, ...r }))}
          expanded={expandedSection === "insurance"}
          onToggle={() => setExpandedSection(expandedSection === "insurance" ? null : "insurance")}
        />
      </div>

      {/* Stage mapping editor */}
      <StageMappingEditor onChanged={load} />

      {/* Lead list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Leads {filter !== "all" && <Badge className={`${CATEGORY_CLASS[filter as Category]} ml-2 text-[10px]`} variant="outline">filter: {CATEGORY_LABEL[filter as Category]}</Badge>}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={leads.length === 0}
                onClick={() => { logAudit("export", "outcomes", null, { format: "csv", count: leads.length, window_days: windowDays, filter }); downloadCsv(`outcomes-${new Date().toISOString().slice(0, 10)}.csv`, leads, [
                  { key: "first_name", label: "First name" },
                  { key: "last_name", label: "Last name" },
                  { key: "primary_phone_normalized", label: "Phone" },
                  { key: "stage", label: "Zoho stage" },
                  { key: "outcome_category", label: "Outcome" },
                  { key: "outcome_set_at", label: "Outcome set at", format: (v) => v ? new Date(v).toISOString() : "" },
                  { key: "first_touch_source_category", label: "Source" },
                  { key: "owner", label: "Owner", format: (v) => v?.full_name ?? v?.email ?? "" },
                  { key: "last_touch_call", label: "Last-touch agent", format: (v) => v?.ctm_raw_payload?.agent?.name ?? v?.ctm_raw_payload?.agent?.email ?? "" },
                  { key: "created_at", label: "Created", format: (v) => v ? new Date(v).toISOString() : "" },
                ]); }}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              {filter !== "all" && (
                <Button size="sm" variant="ghost" onClick={() => setFilter("all")}>Clear</Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}
          {!loading && !error && leads.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No leads in this window. Outcomes appear here once Zoho stages have been pulled and classified.
            </div>
          )}
          <div className="divide-y">
            {leads.map((l) => {
              const cat = l.outcome_category ?? "in_progress";
              const agent = l.last_touch_call?.ctm_raw_payload?.agent;
              const agentName = agent?.name ?? agent?.email ?? null;
              return (
                <div key={l.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                  <Badge className={`${CATEGORY_CLASS[cat]} border text-[10px] uppercase shrink-0`} variant="outline">
                    {CATEGORY_LABEL[cat]}
                  </Badge>
                  <Link href={`/leads/${l.id}`} className="flex-1 min-w-0 hover:underline">
                    <div className="text-sm font-medium truncate">
                      {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown lead"}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                      {l.stage && <span>stage: {l.stage}</span>}
                      {l.first_touch_source_category && <span>source: {l.first_touch_source_category}</span>}
                      {agentName && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {agentName}</span>}
                      {l.outcome_set_at && (
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDate(l.outcome_set_at)}</span>
                      )}
                    </div>
                  </Link>
                  {l.last_touch_call_id && (
                    <Link href={`/live/${l.last_touch_call_id}`} className="text-xs text-primary hover:underline shrink-0 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Last call
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RollupTile({ icon, label, value, sub, accent, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  accent?: "emerald" | "rose";
  active?: boolean;
  onClick?: () => void;
}) {
  const accentClass = accent === "emerald"
    ? "border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/15"
    : accent === "rose"
      ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
      : "";
  const interactive = onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : "";
  const activeClass = active ? "ring-2 ring-primary" : "";
  const Wrapper: any = onClick ? "button" : "div";
  return (
    <Wrapper onClick={onClick} className={`text-left border rounded-lg p-3 ${accentClass} ${interactive} ${activeClass}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Wrapper>
  );
}

function BreakdownCard({ title, icon, rows, expanded, onToggle }: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ id: string; label: string; won: number; lost: number; in_progress: number }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visibleRows = expanded ? rows : rows.slice(0, 5);
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">{icon} {title}</span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">No data in window.</div>
        ) : (
          <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left py-1.5 pr-2">Name</th>
                <th className="text-right py-1.5 px-2">Admitted</th>
                <th className="text-right py-1.5 px-2">Churned</th>
                <th className="text-right py-1.5 px-2">In prog</th>
                <th className="text-right py-1.5 pl-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const closed = r.won + r.lost;
                const pct = closed > 0 ? Math.round((r.won / closed) * 100) : null;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5 pr-2 truncate max-w-[180px]">{r.label}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.won}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-rose-700 dark:text-rose-400">{r.lost}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.in_progress}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums font-medium">{pct == null ? "—" : `${pct}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        {!expanded && rows.length > 5 && (
          <div className="text-[11px] text-muted-foreground mt-2 text-center">+{rows.length - 5} more — click to expand</div>
        )}
      </CardContent>
    </Card>
  );
}

interface MappingRow {
  stage_label: string;
  category: Category;
  notes: string | null;
  updated_at: string;
}

function StageMappingEditor({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [unmapped, setUnmapped] = useState<Array<{ stage: string; n: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("in_progress");

  const load = useCallback(async () => {
    setLoading(true);
    const [mapRes, leadsRes] = await Promise.all([
      supabase.from("stage_outcome_mapping").select("stage_label, category, notes, updated_at").order("category").order("stage_label"),
      supabase.from("leads").select("stage").not("stage", "is", null),
    ]);
    setMappings((mapRes.data ?? []) as MappingRow[]);

    // Find lead stages that don't have a mapping (case-insensitive).
    const knownLabels = new Set((mapRes.data ?? []).map((m: any) => String(m.stage_label).toLowerCase()));
    const stageCounts = new Map<string, number>();
    for (const r of (leadsRes.data ?? []) as Array<{ stage: string }>) {
      const s = (r.stage ?? "").trim();
      if (!s) continue;
      if (knownLabels.has(s.toLowerCase())) continue;
      stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1);
    }
    setUnmapped([...stageCounts.entries()].map(([stage, n]) => ({ stage, n })).sort((a, b) => b.n - a.n));
    setLoading(false);
  }, []);

  useEffect(() => { if (expanded) load(); }, [expanded, load]);

  async function recompute() {
    const { error } = await supabase.rpc("recompute_lead_outcomes");
    if (error) toast({ title: "Recompute failed", description: error.message, variant: "destructive" });
    onChanged();
    load();
  }

  async function saveMapping(label: string, category: Category, notes: string | null) {
    setSavingLabel(label);
    const { error } = await supabase.from("stage_outcome_mapping").upsert({
      stage_label: label,
      category,
      notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stage_label" });
    setSavingLabel(null);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    await recompute();
    toast({ title: "Mapping saved", description: `"${label}" → ${category}` });
  }

  async function deleteMapping(label: string) {
    setSavingLabel(label);
    const { error } = await supabase.from("stage_outcome_mapping").delete().eq("stage_label", label);
    setSavingLabel(null);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    await recompute();
    toast({ title: "Mapping removed", description: `"${label}" now defaults to in-progress` });
  }

  async function addNew() {
    const label = newStage.trim();
    if (!label) return;
    await saveMapping(label, newCategory, null);
    setNewStage("");
    setNewCategory("in_progress");
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4" /> Stage mapping
            {unmapped.length > 0 && (
              <Badge variant="outline" className="ml-1 gap-1 text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3 h-3" /> {unmapped.length} unclassified
              </Badge>
            )}
          </span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Each Zoho lead stage maps to a category. Anything not classified here defaults to "in progress."
            Edits trigger a recompute so existing leads pick up the new classification immediately.
          </p>

          {loading && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading mappings…
            </div>
          )}

          {!loading && unmapped.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15 rounded-md p-3 space-y-2">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Unclassified stages found in your lead data ({unmapped.length})
              </div>
              <div className="space-y-1.5">
                {unmapped.map((u) => (
                  <UnmappedRow
                    key={u.stage}
                    stage={u.stage}
                    count={u.n}
                    saving={savingLabel === u.stage}
                    onClassify={(cat) => saveMapping(u.stage, cat, null)}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && (
            <div className="border rounded-md overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 px-3">Stage label</th>
                    <th className="text-left py-2 px-3 w-40">Category</th>
                    <th className="text-left py-2 px-3">Notes</th>
                    <th className="py-2 px-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <MappingEditRow
                      key={m.stage_label}
                      mapping={m}
                      saving={savingLabel === m.stage_label}
                      onSave={saveMapping}
                      onDelete={deleteMapping}
                    />
                  ))}
                  <tr className="border-t bg-muted/20">
                    <td className="py-2 px-3">
                      <Input
                        value={newStage}
                        onChange={(e) => setNewStage(e.target.value)}
                        placeholder="Add a new stage label (exact Zoho text)"
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <Select value={newCategory} onValueChange={(v) => setNewCategory(v as Category)}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="won">Won (admitted)</SelectItem>
                          <SelectItem value="lost">Lost (churned)</SelectItem>
                          <SelectItem value="in_progress">In progress</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">Notes can be edited after adding</td>
                    <td className="py-2 px-3 text-right">
                      <Button size="sm" onClick={addNew} disabled={!newStage.trim() || !!savingLabel} className="h-8 gap-1">
                        <Plus className="w-3.5 h-3.5" /> Add
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={recompute} className="gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Recompute lead outcomes now
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function UnmappedRow({ stage, count, saving, onClassify }: {
  stage: string;
  count: number;
  saving: boolean;
  onClassify: (cat: Category) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <code className="bg-background border rounded px-1.5 py-0.5 text-xs">{stage}</code>
      <span className="text-xs text-muted-foreground">{count} lead{count > 1 ? "s" : ""}</span>
      <span className="text-xs text-muted-foreground ml-auto mr-2">classify as:</span>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => onClassify("won")} className="h-7 gap-1 text-xs">
        <Trophy className="w-3 h-3" /> Won
      </Button>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => onClassify("lost")} className="h-7 gap-1 text-xs">
        <XCircle className="w-3 h-3" /> Lost
      </Button>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => onClassify("in_progress")} className="h-7 gap-1 text-xs">
        <Clock className="w-3 h-3" /> In progress
      </Button>
    </div>
  );
}

function MappingEditRow({ mapping, saving, onSave, onDelete }: {
  mapping: MappingRow;
  saving: boolean;
  onSave: (label: string, category: Category, notes: string | null) => void;
  onDelete: (label: string) => void;
}) {
  const [category, setCategory] = useState<Category>(mapping.category);
  const [notes, setNotes] = useState<string>(mapping.notes ?? "");
  const dirty = category !== mapping.category || notes !== (mapping.notes ?? "");

  return (
    <tr className="border-t">
      <td className="py-2 px-3 font-mono text-xs">{mapping.stage_label}</td>
      <td className="py-2 px-3">
        <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 px-3">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why this mapping?"
          className="h-8 text-sm"
        />
      </td>
      <td className="py-2 px-3 text-right">
        <div className="flex gap-1 justify-end">
          {dirty && (
            <Button size="sm" variant="default" disabled={saving} onClick={() => onSave(mapping.stage_label, category, notes.trim() || null)} className="h-8 px-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => { if (confirm(`Remove mapping for "${mapping.stage_label}"? It will default to in-progress.`)) onDelete(mapping.stage_label); }} className="h-8 px-2 text-rose-600 hover:text-rose-700">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
