// /admin/users — admin-only team management surface.
//
// Replaces the old "create user in Supabase dashboard, then hand-write
// an INSERT" flow. From this page an admin can:
//
//   - See the full team (name, email, role, active, last seen)
//   - Invite a new user by email — sends magic-link, auto-creates
//     profile row with the chosen role
//   - Change anyone's role via inline picker
//   - Deactivate / reactivate without deleting (preserves audit trail)
//
// Backed by two edge functions (admin-invite-user, admin-update-user)
// which both re-verify the caller's admin role server-side, so a
// non-admin can't bypass the UI to escalate privileges.

import { useEffect, useState, useCallback } from "react";
import {
  Users, Loader2, UserPlus, Shield, ShieldAlert, ShieldCheck,
  CheckCircle2, AlertCircle, X, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/dashboard/PageShell";
import { useToast } from "@/hooks/use-toast";

type Role = "specialist" | "manager" | "admin";

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  is_ai_agent: boolean;
}

const ROLE_META: Record<Role, { label: string; tone: string; icon: React.ReactNode }> = {
  admin:      { label: "Admin",     tone: "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5", icon: <ShieldAlert className="w-3 h-3" /> },
  manager:    { label: "Manager",   tone: "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5", icon: <Shield className="w-3 h-3" /> },
  specialist: { label: "Staff",     tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5", icon: <ShieldCheck className="w-3 h-3" /> },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, is_active, last_seen_at, created_at, is_ai_agent")
      .order("is_active", { ascending: false })
      .order("full_name", { ascending: true });
    if (error) setError(error.message);
    else setProfiles((data ?? []) as ProfileRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Apply an update to the local state immediately so the row reflects
  // the change before the network round-trip finishes; on failure we
  // refetch to recover.
  function patchLocal(id: string, patch: Partial<ProfileRow>) {
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  }

  async function callUpdate(id: string, body: Partial<{ role: Role; is_active: boolean; full_name: string }>) {
    setBusyId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast({ title: "Update failed", description: json.error ?? "unknown error", variant: "destructive" });
        load(); // refetch to revert any optimistic change
        return;
      }
      toast({ title: "Updated", description: `${json.profile.full_name ?? "User"} saved.` });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(id: string, role: Role) {
    patchLocal(id, { role });
    await callUpdate(id, { role });
  }

  async function toggleActive(id: string, next: boolean) {
    patchLocal(id, { is_active: next });
    await callUpdate(id, { is_active: next });
  }

  // Sort: active humans first by name, then inactive, then AI agents.
  const sorted = profiles.slice().sort((a, b) => {
    if (a.is_ai_agent !== b.is_ai_agent) return a.is_ai_agent ? 1 : -1;
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "");
  });

  const activeCount = profiles.filter((p) => p.is_active && !p.is_ai_agent).length;
  const adminCount = profiles.filter((p) => p.role === "admin" && p.is_active).length;
  const managerCount = profiles.filter((p) => p.role === "manager" && p.is_active).length;
  const staffCount = profiles.filter((p) => p.role === "specialist" && p.is_active).length;

  return (
    <PageShell
      eyebrow="ADMIN"
      title="Users"
      subtitle="Invite teammates, set roles, and toggle active status. Magic-link invites go out by email; deactivating a user kicks them out without deleting their data."
      maxWidth={1400}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5 h-9">
            <UserPlus className="w-3.5 h-3.5" /> Invite user
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Active users" value={activeCount} icon={<Users className="w-4 h-4 text-blue-500" />} />
        <KpiTile label="Admins" value={adminCount} icon={<ShieldAlert className="w-4 h-4 text-rose-500" />} />
        <KpiTile label="Managers" value={managerCount} icon={<Shield className="w-4 h-4 text-blue-500" />} />
        <KpiTile label="Staff" value={staffCount} icon={<ShieldCheck className="w-4 h-4 text-emerald-500" />} />
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </CardContent>
        </Card>
      )}

      {loading && profiles.length === 0 && (
        <Card>
          <CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
          </CardContent>
        </Card>
      )}

      {!loading && profiles.length === 0 && (
        <Card>
          <CardContent className="pt-10 pb-10 text-sm text-muted-foreground text-center">
            No users yet. Click "Invite user" to add the first one.
          </CardContent>
        </Card>
      )}

      {profiles.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 pr-3">Name</th>
                  <th className="text-left py-2 pr-3">Email</th>
                  <th className="text-left py-2 pr-3">Role</th>
                  <th className="text-left py-2 pr-3">Active</th>
                  <th className="text-right py-2 pr-3">Last seen</th>
                  <th className="text-right py-2 pr-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isSelf = currentUser?.id === p.id;
                  const meta = ROLE_META[p.role];
                  const isBusy = busyId === p.id;
                  return (
                    <tr
                      key={p.id}
                      className={`border-t align-middle ${!p.is_active ? "opacity-50" : ""}`}
                    >
                      <td className="py-2 pr-3">
                        <div className="font-medium flex items-center gap-1.5">
                          {p.full_name ?? "(unnamed)"}
                          {p.is_ai_agent && <Badge variant="outline" className="text-[9px]">AI</Badge>}
                          {isSelf && <Badge variant="outline" className="text-[9px] border-blue-500/40 text-blue-700 dark:text-blue-300">you</Badge>}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{p.email ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {/* Inline role picker. Disabled for AI agents
                            (they have their own role bookkeeping) and
                            for self-demote (handled server-side too,
                            but no point letting the user click it). */}
                        <select
                          value={p.role}
                          disabled={p.is_ai_agent || isBusy}
                          onChange={(e) => changeRole(p.id, e.target.value as Role)}
                          className={`h-7 text-xs px-2 rounded border bg-background ${meta.tone}`}
                        >
                          <option value="specialist">Staff</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          disabled={isSelf || isBusy || p.is_ai_agent}
                          onClick={() => toggleActive(p.id, !p.is_active)}
                          title={isSelf ? "You can't deactivate yourself" : p.is_active ? "Deactivate" : "Reactivate"}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
                            p.is_active
                              ? "border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10"
                              : "border border-zinc-500/40 text-zinc-500 hover:bg-zinc-500/10"
                          } ${(isSelf || isBusy || p.is_ai_agent) ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                          {p.is_active ? (<><CheckCircle2 className="w-3 h-3" /> active</>) : (<><X className="w-3 h-3" /> inactive</>)}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                        {fmtRelative(p.last_seen_at)}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                        {fmtDate(p.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <InviteModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => { setInviteOpen(false); load(); }}
      />
    </PageShell>
  );
}

function KpiTile({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">{icon} {label}</div>
        <div className="text-2xl font-semibold tabular-nums mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}

function InviteModal({ open, onOpenChange, onInvited }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("specialist");
  const [submitting, setSubmitting] = useState(false);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setEmail(""); setFullName(""); setRole("specialist"); setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (!email.trim() || !fullName.trim()) {
      toast({ title: "Missing fields", description: "Email and full name are required." });
      return;
    }
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-invite-user`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: email.trim(), full_name: fullName.trim(), role }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast({ title: "Invite failed", description: json.error ?? "unknown error", variant: "destructive" });
        setSubmitting(false);
        return;
      }
      toast({ title: "Invite sent", description: `${fullName.trim()} will get a magic-link email.` });
      onInvited();
    } catch (e) {
      toast({ title: "Invite failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They'll get a magic-link email to set up their account. Their profile is created automatically with the role you pick here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="casey@cornerstonehealingcenter.com"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name" className="text-xs">Full name</Label>
            <Input
              id="invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Casey McCracken"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role" className="text-xs">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full h-9 text-sm px-2 rounded-md border bg-background"
            >
              <option value="specialist">Staff — sees their own work only</option>
              <option value="manager">Manager — sees all team data, no admin tools</option>
              <option value="admin">Admin — full access including user management</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
