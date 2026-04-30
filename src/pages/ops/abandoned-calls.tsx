import { useState, useCallback } from "react";
import { usePollingFetch } from "@/hooks/use-ops-api";
import { apiFetch } from "@/lib/api-client";
import { SectionHeader } from "@/components/section-header";
import { StatCard } from "@/components/ops/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  PhoneOff, Clock, AlertTriangle, CheckCircle2, Upload,
  Plus, Phone, Timer, ShieldAlert, TrendingDown, Users,
  X, FileUp, ChevronDown,
} from "lucide-react";

interface QueueItem {
  id: number;
  call_loss_type: string;
  severity_tier: string;
  label: string;
  caller_phone: string;
  call_datetime: string;
  ring_duration_seconds: number;
  source_campaign: string | null;
  elapsed_seconds: number;
  elapsed_display: string;
  followup_sla_minutes: number | null;
  sla_breached: boolean;
  sla_badge: string | null;
  assigned_rep_id: string | null;
  assigned_reason: string | null;
  no_available_agent: boolean;
  staffing_gap_flag: boolean;
  followup_completed: boolean;
  followup_completed_at: string | null;
  followup_notes: string | null;
  ctm_call_id: string | null;
  zoho_lead_id: string | null;
}

interface AbandonStats {
  answered: number;
  short_abandon: number;
  true_abandon: number;
  critical_abandon: number;
  voicemail: number;
  no_agent_losses: number;
  queue_pending: number;
  sla_breached: number;
  abandon_rate: number;
  total_calls: number;
}

export default function AbandonedCalls() {
  const { toast } = useToast();
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: stats, loading: statsLoading } = usePollingFetch<AbandonStats>(
    `/abandoned-calls/stats?days=30&_r=${refreshKey}`,
    { interval: 30000 }
  );

  const { data: queue, loading: queueLoading } = usePollingFetch<{ items: QueueItem[]; total: number }>(
    `/abandoned-calls/queue?per_page=100&include_completed=${showCompleted}&_r=${refreshKey}`,
    { interval: 15000 }
  );

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleFollowUp = async (eventId: number, completed: boolean) => {
    try {
      await apiFetch(`/abandoned-calls/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followup_completed: completed }),
      });
      toast({ title: completed ? "Follow-up marked complete" : "Follow-up reopened" });
      refresh();
    } catch {
      toast({ title: "Error updating follow-up", variant: "destructive" });
    }
  };

  const handleClassifyCTM = async () => {
    try {
      const res = await apiFetch("/abandoned-calls/classify-ctm?days=30", { method: "POST" });
      const data = await res.json();
      toast({ title: `Classified ${data.created} CTM calls (${data.skipped} already done)` });
      refresh();
    } catch {
      toast({ title: "Error classifying CTM calls", variant: "destructive" });
    }
  };

  if (statsLoading && !stats) {
    return (
      <div className="p-5 md:p-8 lg:p-10 space-y-6 md:space-y-8 max-w-7xl mx-auto">
        <SectionHeader title="Abandoned Calls" subtitle="Loading..." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8 lg:p-10 space-y-6 md:space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <SectionHeader
          title="Abandoned Calls"
          subtitle="Track abandoned calls, classify urgency, and manage follow-ups"
        />
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowManualEntry(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Manual Entry
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCsvUpload(true)}>
            <Upload className="w-4 h-4 mr-1.5" />
            CSV Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleClassifyCTM}>
            <Phone className="w-4 h-4 mr-1.5" />
            Sync CTM
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Answered"
            value={stats.answered}
            icon={<Phone className="w-5 h-5 text-emerald-600" />}
          />
          <StatCard
            label="Short Abandons"
            value={stats.short_abandon}
            change="< 10s — Likely misdials"
            icon={<Clock className="w-5 h-5 text-gray-400" />}
          />
          <StatCard
            label="True Abandons"
            value={stats.true_abandon}
            change="10–45s — Missed opportunities"
            changeType={stats.true_abandon > 0 ? "negative" : "neutral"}
            icon={<AlertTriangle className="w-5 h-5 text-yellow-500" />}
          />
          <StatCard
            label="Critical Abandons"
            value={stats.critical_abandon}
            change="45s+ — Urgent follow-up"
            changeType={stats.critical_abandon > 0 ? "negative" : "neutral"}
            icon={<ShieldAlert className="w-5 h-5 text-red-500" />}
          />
          <StatCard
            label="Queue Pending"
            value={stats.queue_pending}
            icon={<PhoneOff className="w-5 h-5 text-orange-500" />}
          />
          <StatCard
            label="SLA Breaches"
            value={stats.sla_breached}
            changeType={stats.sla_breached > 0 ? "negative" : "neutral"}
            icon={<Timer className="w-5 h-5 text-red-500" />}
          />
          <StatCard
            label="Abandon Rate"
            value={`${stats.abandon_rate}%`}
            change="Excluding short abandons"
            icon={<TrendingDown className="w-5 h-5 text-blue-500" />}
          />
          <StatCard
            label="No-Agent Losses"
            value={stats.no_agent_losses}
            change="Coverage gaps"
            icon={<Users className="w-5 h-5 text-purple-500" />}
          />
        </div>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Urgent Follow-Up Queue</CardTitle>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                  className="rounded border-border"
                />
                Show completed
              </label>
              {queue && (
                <Badge variant="secondary" className="text-xs">
                  {queue.total} {queue.total === 1 ? "item" : "items"}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {queueLoading && !queue ? (
            <div className="p-8 text-center text-muted-foreground">Loading queue...</div>
          ) : !queue?.items?.length ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">All follow-ups complete</p>
              <p className="text-sm text-muted-foreground/70 mt-1">No urgent abandoned calls pending</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Urgency</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Caller</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date/Time</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ring</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Elapsed</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Owner</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((item) => (
                    <QueueRow key={item.id} item={item} onFollowUp={handleFollowUp} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showManualEntry && (
        <ManualEntryDialog onClose={() => setShowManualEntry(false)} onSuccess={refresh} />
      )}
      {showCsvUpload && (
        <CsvUploadDialog onClose={() => setShowCsvUpload(false)} onSuccess={refresh} />
      )}
    </div>
  );
}


function QueueRow({ item, onFollowUp }: { item: QueueItem; onFollowUp: (id: number, done: boolean) => void }) {
  const tierColors: Record<string, string> = {
    red: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
    yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300",
    gray: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400",
  };

  const badgeColors: Record<string, string> = {
    "CALL BACK WITHIN 15 MIN": "bg-red-500 text-white animate-pulse",
    "CALL BACK WITHIN 1 HOUR": "bg-yellow-500 text-yellow-950",
  };

  return (
    <tr className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${item.followup_completed ? "opacity-50" : ""}`}>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <Badge className={`text-[10px] px-2 py-0.5 w-fit ${tierColors[item.severity_tier] || tierColors.gray}`}>
            {item.label}
          </Badge>
          {item.sla_badge && !item.followup_completed && (
            <Badge className={`text-[10px] px-2 py-0.5 w-fit ${badgeColors[item.sla_badge] || ""}`}>
              {item.sla_badge}
            </Badge>
          )}
          {item.sla_breached && !item.followup_completed && (
            <span className="text-[10px] text-red-500 font-semibold">SLA BREACHED</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="font-medium">{item.caller_phone}</span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {item.call_datetime ? new Date(item.call_datetime).toLocaleString() : "—"}
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs">{item.ring_duration_seconds}s</span>
      </td>
      <td className="px-4 py-3">
        <span className={`font-semibold text-base ${item.sla_breached ? "text-red-500" : "text-foreground"}`}>
          {item.elapsed_display}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate">
        {item.source_campaign || "—"}
      </td>
      <td className="px-4 py-3">
        {item.assigned_rep_id ? (
          <span className="text-xs">{item.assigned_rep_id}</span>
        ) : item.no_available_agent ? (
          <Badge variant="outline" className="text-[10px] text-orange-500 border-orange-300">
            No agent available
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Button
          variant={item.followup_completed ? "ghost" : "default"}
          size="sm"
          className="text-xs"
          onClick={() => onFollowUp(item.id, !item.followup_completed)}
        >
          {item.followup_completed ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Done
            </>
          ) : (
            <>
              <Phone className="w-3.5 h-3.5 mr-1" />
              Follow Up
            </>
          )}
        </Button>
      </td>
    </tr>
  );
}


function ManualEntryDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    call_datetime: new Date().toISOString().slice(0, 16),
    caller_phone: "",
    ring_duration_seconds: "0",
    outcome: "abandoned",
    source_campaign: "",
    notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/abandoned-calls/manual-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ring_duration_seconds: parseInt(form.ring_duration_seconds) || 0,
        }),
      });
      toast({ title: "Call record added" });
      onSuccess();
      onClose();
    } catch {
      toast({ title: "Error adding record", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Manual Call Entry</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Date/Time</Label>
                <Input
                  type="datetime-local"
                  value={form.call_datetime}
                  onChange={(e) => setForm({ ...form, call_datetime: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Caller Phone</Label>
                <Input
                  placeholder="+15551234567"
                  value={form.caller_phone}
                  onChange={(e) => setForm({ ...form, caller_phone: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Ring Duration (seconds)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.ring_duration_seconds}
                  onChange={(e) => setForm({ ...form, ring_duration_seconds: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Outcome</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.outcome}
                  onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                >
                  <option value="answered">Answered</option>
                  <option value="abandoned">Abandoned</option>
                  <option value="missed">Missed</option>
                  <option value="voicemail">Voicemail</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Source / Campaign (optional)</Label>
              <Input
                value={form.source_campaign}
                onChange={(e) => setForm({ ...form, source_campaign: e.target.value })}
                placeholder="e.g., Google Ads, Website"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Add Call Record"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}


function CsvUploadDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleValidate = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/abandoned-calls/csv-validate", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setPreview(data);
    } catch {
      toast({ title: "Error validating CSV", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("deduplicate", "true");
      const res = await apiFetch("/abandoned-calls/csv-upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        toast({ title: `Imported ${data.imported} records (${data.skipped} skipped)` });
        onSuccess();
      } else {
        toast({ title: "Import failed", description: data.errors?.[0], variant: "destructive" });
      }
    } catch {
      toast({ title: "Error importing CSV", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>CSV Import</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-border/60 rounded-xl p-8 text-center">
            <FileUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              Upload a CSV with columns: <span className="font-mono text-xs">call_datetime, caller_phone, ring_duration_seconds, outcome</span>
            </p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              Optional: <span className="font-mono text-xs">source_campaign, notes</span>
            </p>
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setResult(null);
              }}
              className="max-w-xs mx-auto"
            />
          </div>

          {file && !preview && !result && (
            <div className="flex justify-center">
              <Button onClick={handleValidate} disabled={loading}>
                {loading ? "Validating..." : "Validate CSV"}
              </Button>
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className={`p-3 rounded-lg text-sm ${preview.valid ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"}`}>
                {preview.valid ? `✓ Valid — ${preview.row_count} rows ready to import` : `✗ Invalid — ${preview.errors?.length || 0} errors`}
              </div>
              {preview.errors?.length > 0 && (
                <div className="text-xs text-red-500 space-y-1 max-h-32 overflow-y-auto">
                  {preview.errors.map((err: string, i: number) => <div key={i}>{err}</div>)}
                </div>
              )}
              {preview.preview?.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border/50">
                        {Object.keys(preview.preview[0]).map((k) => (
                          <th key={k} className="text-left px-3 py-2 font-medium">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.slice(0, 5).map((row: any, i: number) => (
                        <tr key={i} className="border-b border-border/30">
                          {Object.values(row).map((v: any, j: number) => (
                            <td key={j} className="px-3 py-1.5 text-muted-foreground">{String(v || "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.valid && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose}>Cancel</Button>
                  <Button onClick={handleImport} disabled={loading}>
                    {loading ? "Importing..." : `Import ${preview.row_count} Records`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="p-4 rounded-lg bg-muted/30 space-y-2 text-sm">
              <p className="font-medium">Import Complete</p>
              <p>Imported: {result.imported} | Skipped: {result.skipped}</p>
              {result.errors?.length > 0 && (
                <p className="text-yellow-500 text-xs">{result.errors.length} warnings</p>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
