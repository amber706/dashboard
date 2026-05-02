// VOB (Verification of Benefits) queue.
//
// Surfaces leads needing insurance verification. Cornerstone admissions
// can't quote a copay, confirm in-network status, or pull the trigger
// on intake without a clean VOB. This page is where that happens.
//
// Status flow:
//   pending           -> commercial insurance needs human verification
//   in_progress       -> rep is on hold with the carrier or waiting on a callback
//   verified_in_network    -> intake proceeds; copay/deductible captured
//   verified_out_of_network -> needs Cornerstone leadership decision
//   self_pay          -> no insurance to verify
//   not_required      -> AHCCCS plan, Cornerstone is in-network by default
//   unable_to_verify  -> couldn't reach carrier / member ID invalid

import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  ShieldCheck, Loader2, Phone, ChevronRight, User as UserIcon,
  CheckCircle2, AlertCircle, Clock, Download, Filter,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { PageShell } from "@/components/dashboard/PageShell";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";

type VobStatus =
  | "pending"
  | "in_progress"
  | "verified_in_network"
  | "verified_out_of_network"
  | "self_pay"
  | "not_required"
  | "unable_to_verify";

const STATUS_LABEL: Record<VobStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  verified_in_network: "Verified — in network",
  verified_out_of_network: "Verified — out of network",
  self_pay: "Self pay",
  not_required: "Not required (AHCCCS)",
  unable_to_verify: "Unable to verify",
};

const STATUS_TONE: Record<VobStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  verified_in_network: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  verified_out_of_network: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  self_pay: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
  not_required: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  unable_to_verify: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const URGENCY_TONE: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
};

interface VobLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  insurance_provider: string | null;
  urgency: string | null;
  stage: string | null;
  vob_status: VobStatus | null;
  vob_notes: string | null;
  vob_completed_at: string | null;
  vob_authorization_required: boolean | null;
  vob_plan_name: string | null;
  vob_member_id_verified: string | null;
  vob_copay_cents: number | null;
  vob_deductible_cents: number | null;
  vob_deductible_remaining_cents: number | null;
  vob_oop_max_cents: number | null;
  member_id: string | null;
  created_at: string;
  owner: { id: string; full_name: string | null; email: string | null } | null;
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function OpsVOB() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<VobLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<VobStatus | "all" | "open">("open");
  const [editing, setEditing] = useState<VobLead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("leads")
      .select(`
        id, first_name, last_name, primary_phone_normalized, insurance_provider,
        urgency, stage, vob_status, vob_notes, vob_completed_at,
        vob_authorization_required, vob_plan_name, vob_member_id_verified,
        vob_copay_cents, vob_deductible_cents, vob_deductible_remaining_cents, vob_oop_max_cents,
        member_id, created_at,
        owner:profiles!leads_owner_id_fkey(id, full_name, email)
      `)
      .not("vob_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter === "open") {
      q = q.in("vob_status", ["pending", "in_progress"]);
    } else if (filter !== "all") {
      q = q.eq("vob_status", filter);
    }

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setLeads((data ?? []) as unknown as VobLead[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    if (!l.vob_status) return acc;
    acc[l.vob_status] = (acc[l.vob_status] ?? 0) + 1;
    return acc;
  }, {});

  function exportCsv() {
    if (leads.length === 0) return;
    const rows = leads.map((l) => ({
      name: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "(unnamed)",
      phone: l.primary_phone_normalized ?? "",
      insurance: l.insurance_provider ?? "",
      vob_status: l.vob_status ?? "",
      plan: l.vob_plan_name ?? "",
      member_id: l.vob_member_id_verified ?? l.member_id ?? "",
      copay: fmtMoney(l.vob_copay_cents),
      deductible: fmtMoney(l.vob_deductible_cents),
      deductible_remaining: fmtMoney(l.vob_deductible_remaining_cents),
      oop_max: fmtMoney(l.vob_oop_max_cents),
      auth_required: l.vob_authorization_required == null ? "" : l.vob_authorization_required ? "yes" : "no",
      verified_at: l.vob_completed_at ?? "",
      owner: l.owner?.full_name ?? l.owner?.email ?? "",
    }));
    downloadCsv(`vob-${filter}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    logAudit("export.vob", { filter, count: leads.length });
  }

  return (
    <PageShell
      number="04"
      eyebrow="VERIFICATION"
      title="VOB queue"
      eyebrowAccent="coral"
      subtitle="Insurance verification before intake. Leads with commercial insurance default to pending; AHCCCS rolls in-network automatically. Work pending verifications, capture plan + benefits, mark verified."
      maxWidth={1400}
      actions={
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={leads.length === 0} className="gap-1.5 h-9">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      }
    >
      <div className="flex gap-2 flex-wrap items-center">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(["open", "pending", "in_progress", "verified_in_network", "verified_out_of_network", "self_pay", "not_required", "unable_to_verify", "all"] as const).map((f) => {
          const c = f === "open" ? (counts.pending ?? 0) + (counts.in_progress ?? 0)
            : f === "all" ? leads.length
            : counts[f] ?? 0;
          return (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} className="h-8">
              {f === "open" ? "Open" : f === "all" ? "All" : STATUS_LABEL[f as VobStatus]}
              {filter === f && <span className="ml-1.5 opacity-70">{c}</span>}
            </Button>
          );
        })}
      </div>

      {loading && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading VOB queue…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && leads.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <div>No VOBs in this filter — nothing to chase.</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {leads.map((l) => (
          <VobRow key={l.id} lead={l} onEdit={() => setEditing(l)} />
        ))}
      </div>

      {editing && (
        <VobEditor
          lead={editing}
          currentUserId={user?.id ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </PageShell>
  );
}

function VobRow({ lead, onEdit }: { lead: VobLead; onEdit: () => void }) {
  const status = lead.vob_status ?? "pending";
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "(unnamed)";
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <ShieldCheck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/leads/${lead.id}`} className="font-medium truncate hover:underline">{name}</Link>
                <Badge variant="secondary" className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                {lead.urgency && (
                  <Badge variant="secondary" className={URGENCY_TONE[lead.urgency] ?? URGENCY_TONE.low}>
                    {lead.urgency}
                  </Badge>
                )}
                {lead.vob_authorization_required && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <AlertCircle className="w-3 h-3" /> auth required
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                {lead.primary_phone_normalized && (
                  <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {lead.primary_phone_normalized}</span>
                )}
                {lead.insurance_provider && <span>· {lead.insurance_provider}{lead.vob_plan_name ? ` (${lead.vob_plan_name})` : ""}</span>}
                {lead.owner && (
                  <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> {lead.owner.full_name ?? lead.owner.email ?? "specialist"}</span>
                )}
                {lead.vob_completed_at && (
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> verified {fmtTime(lead.vob_completed_at)}</span>
                )}
              </div>
              {(lead.vob_copay_cents != null || lead.vob_deductible_cents != null) && (
                <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                  {lead.vob_copay_cents != null && <span>Copay {fmtMoney(lead.vob_copay_cents)}</span>}
                  {lead.vob_deductible_cents != null && (
                    <span>
                      Ded {fmtMoney(lead.vob_deductible_cents)}
                      {lead.vob_deductible_remaining_cents != null && ` (${fmtMoney(lead.vob_deductible_remaining_cents)} left)`}
                    </span>
                  )}
                  {lead.vob_oop_max_cents != null && <span>OOP max {fmtMoney(lead.vob_oop_max_cents)}</span>}
                </div>
              )}
              {lead.vob_notes && <div className="text-xs mt-1 line-clamp-2">{lead.vob_notes}</div>}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Button size="sm" variant="outline" onClick={onEdit}>
              {status === "pending" ? "Start" : status === "in_progress" ? "Update" : "Edit"}
            </Button>
            <Link href={`/leads/${lead.id}`}>
              <Button size="sm" variant="ghost" className="gap-1">
                Lead <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VobEditor({
  lead, currentUserId, onClose, onSaved,
}: {
  lead: VobLead;
  currentUserId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<VobStatus>(lead.vob_status ?? "pending");
  const [planName, setPlanName] = useState(lead.vob_plan_name ?? "");
  const [memberId, setMemberId] = useState(lead.vob_member_id_verified ?? lead.member_id ?? "");
  const [copay, setCopay] = useState(lead.vob_copay_cents != null ? String(lead.vob_copay_cents / 100) : "");
  const [deductible, setDeductible] = useState(lead.vob_deductible_cents != null ? String(lead.vob_deductible_cents / 100) : "");
  const [deductibleRemaining, setDeductibleRemaining] = useState(lead.vob_deductible_remaining_cents != null ? String(lead.vob_deductible_remaining_cents / 100) : "");
  const [oopMax, setOopMax] = useState(lead.vob_oop_max_cents != null ? String(lead.vob_oop_max_cents / 100) : "");
  const [authRequired, setAuthRequired] = useState<"" | "yes" | "no">(lead.vob_authorization_required == null ? "" : lead.vob_authorization_required ? "yes" : "no");
  const [notes, setNotes] = useState(lead.vob_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isVerified = status === "verified_in_network" || status === "verified_out_of_network";

  function dollarsToCents(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v.trim());
    if (Number.isNaN(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const update: Record<string, unknown> = {
      vob_status: status,
      vob_plan_name: planName.trim() || null,
      vob_member_id_verified: memberId.trim() || null,
      vob_copay_cents: dollarsToCents(copay),
      vob_deductible_cents: dollarsToCents(deductible),
      vob_deductible_remaining_cents: dollarsToCents(deductibleRemaining),
      vob_oop_max_cents: dollarsToCents(oopMax),
      vob_authorization_required: authRequired === "" ? null : authRequired === "yes",
      vob_notes: notes.trim() || null,
    };

    if (isVerified || status === "unable_to_verify") {
      update.vob_completed_at = new Date().toISOString();
      update.vob_completed_by = currentUserId;
    }

    const { error } = await supabase.from("leads").update(update).eq("id", lead.id);
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    logAudit("vob.update", { lead_id: lead.id, status });
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>VOB — {`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "(unnamed)"}</DialogTitle>
          <DialogDescription>
            {lead.insurance_provider ? `Carrier on file: ${lead.insurance_provider}` : "No insurance on file."}
            {lead.primary_phone_normalized && ` · ${lead.primary_phone_normalized}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {(["pending", "in_progress", "verified_in_network", "verified_out_of_network", "unable_to_verify", "self_pay", "not_required"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={status === s ? "default" : "outline"}
                  onClick={() => setStatus(s)}
                  className="h-8 text-xs justify-start"
                >
                  {STATUS_LABEL[s]}
                </Button>
              ))}
            </div>
          </div>

          {(isVerified || status === "in_progress") && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan">Plan name</Label>
                  <Input id="plan" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Aetna PPO Choice POS II" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memberId">Member ID</Label>
                  <Input id="memberId" value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="W123456789" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="copay">Copay ($)</Label>
                  <Input id="copay" inputMode="decimal" value={copay} onChange={(e) => setCopay(e.target.value)} placeholder="50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ded">Deductible ($)</Label>
                  <Input id="ded" inputMode="decimal" value={deductible} onChange={(e) => setDeductible(e.target.value)} placeholder="3000" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dedrem">Ded remaining ($)</Label>
                  <Input id="dedrem" inputMode="decimal" value={deductibleRemaining} onChange={(e) => setDeductibleRemaining(e.target.value)} placeholder="1200" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="oop">OOP max ($)</Label>
                  <Input id="oop" inputMode="decimal" value={oopMax} onChange={(e) => setOopMax(e.target.value)} placeholder="6000" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Prior authorization required?</Label>
                <div className="flex gap-2">
                  {(["", "yes", "no"] as const).map((v) => (
                    <Button
                      key={v || "unknown"}
                      size="sm"
                      variant={authRequired === v ? "default" : "outline"}
                      onClick={() => setAuthRequired(v)}
                      className="h-8"
                    >
                      {v === "" ? "Unknown" : v === "yes" ? "Yes" : "No"}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">VOB notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Carrier rep name, reference number, what was confirmed, anything that doesn't fit elsewhere."
            />
          </div>

          {err && <div className="text-sm text-destructive">{err}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save VOB
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
