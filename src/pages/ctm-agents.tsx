import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Users,
  RefreshCw,
  UserCheck,
  UserX,
  Shield,
  Phone,
  Mail,
  Save,
  Loader2,
  Link2,
} from "lucide-react";

interface CTMAgent {
  ctm_user_id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  zoho_owner_id: string | null;
  internal_rep_id: string | null;
  last_synced_at: string;
}

export default function CTMAgents() {
  const [agents, setAgents] = useState<CTMAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ zoho_owner_id: "", internal_rep_id: "" });
  const [saving, setSaving] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [mapResult, setMapResult] = useState<any>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/ctm-admin/agents?active_only=${activeOnly}`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch("/ctm-admin/sync-agents", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Synced ${data.total_fetched} agents: ${data.created} new, ${data.updated} updated`);
        fetchAgents();
      }
    } catch {
    } finally {
      setSyncing(false);
    }
  };

  const handleZohoMap = async () => {
    setMapping(true);
    setMapResult(null);
    try {
      const res = await apiFetch("/ctm-admin/map-agents-zoho", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMapResult(data);
        fetchAgents();
      }
    } catch {
    } finally {
      setMapping(false);
    }
  };

  const startEdit = (agent: CTMAgent) => {
    setEditingId(agent.ctm_user_id);
    setEditForm({
      zoho_owner_id: agent.zoho_owner_id || "",
      internal_rep_id: agent.internal_rep_id || "",
    });
  };

  const saveMapping = async (ctmUserId: string) => {
    setSaving(true);
    try {
      const params = new URLSearchParams();
      if (editForm.zoho_owner_id) params.set("zoho_owner_id", editForm.zoho_owner_id);
      if (editForm.internal_rep_id) params.set("internal_rep_id", editForm.internal_rep_id);
      const res = await apiFetch(`/ctm-admin/agents/${ctmUserId}/mapping?${params}`, { method: "PUT" });
      if (res.ok) {
        setEditingId(null);
        fetchAgents();
      }
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const filtered = agents.filter((a) =>
    !search || a.full_name.toLowerCase().includes(search.toLowerCase()) || a.email.toLowerCase().includes(search.toLowerCase())
  );

  const roleColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-purple-600/20 text-purple-400 border-purple-600/30";
      case "call_manager": return "bg-blue-600/20 text-blue-400 border-blue-600/30";
      case "agent": return "bg-emerald-600/20 text-emerald-400 border-emerald-600/30";
      default: return "bg-slate-600/20 text-slate-400 border-slate-600/30";
    }
  };

  return (
    <div className="p-5 md:p-8 lg:p-10 space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">CTM Agent Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">{agents.length} agents synced from CallTrackingMetrics</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={handleZohoMap} disabled={mapping}>
            {mapping ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
            {mapping ? "Mapping..." : "Auto-Map to Zoho"}
          </Button>
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            {syncing ? "Syncing..." : "Sync from CTM"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">{agents.length}</div>
          <div className="text-xs text-muted-foreground">Total Agents</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{agents.filter(a => a.status === "available").length}</div>
          <div className="text-xs text-muted-foreground">Available</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{agents.filter(a => a.zoho_owner_id).length}</div>
          <div className="text-xs text-muted-foreground">Mapped to Zoho</div>
        </CardContent></Card>
      </div>

      {mapResult && (
        <Card className="border-blue-600/30 bg-blue-600/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Zoho Mapping Results</div>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setMapResult(null)}>Dismiss</Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground">Zoho Users:</span> {mapResult.zoho_users_fetched}</div>
              <div><span className="text-emerald-400">{mapResult.matched} matched</span></div>
              <div><span className="text-muted-foreground">{mapResult.already_mapped} already mapped</span></div>
              <div><span className="text-amber-400">{mapResult.unmatched_count} unmatched</span></div>
            </div>
            {mapResult.unmatched?.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium">Unmatched agents: </span>
                {mapResult.unmatched.slice(0, 10).map((u: any) => `${u.name} (${u.email})`).join(", ")}
                {mapResult.unmatched.length > 10 && ` +${mapResult.unmatched.length - 10} more`}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
          <Users className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
          <span className="text-muted-foreground">Active only</span>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
        <ScrollArea className="h-[600px]">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (
            <div className="divide-y divide-border min-w-[700px]">
              <div className="grid grid-cols-6 gap-3 px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-accent/20">
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
                <span>Status</span>
                <span>Zoho Owner ID</span>
                <span>Actions</span>
              </div>
              {filtered.map((agent) => (
                <div key={agent.ctm_user_id} className="grid grid-cols-6 gap-3 px-4 py-3 items-center hover:bg-accent/20 transition-colors min-h-[44px]">
                  <div>
                    <div className="text-sm font-medium">{agent.full_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">ID: {agent.ctm_user_id}</div>
                  </div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <Mail className="w-3 h-3 shrink-0" /> {agent.email}
                  </div>
                  <div>
                    <Badge className={`${roleColor(agent.role)} text-[10px]`}>{agent.role}</Badge>
                  </div>
                  <div>
                    {agent.status === "available" ? (
                      <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 text-[10px]">
                        <UserCheck className="w-3 h-3 mr-1" /> Online
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        <UserX className="w-3 h-3 mr-1" /> {agent.status}
                      </Badge>
                    )}
                  </div>
                  <div>
                    {editingId === agent.ctm_user_id ? (
                      <div className="flex gap-1">
                        <Input
                          value={editForm.zoho_owner_id}
                          onChange={(e) => setEditForm({ ...editForm, zoho_owner_id: e.target.value })}
                          placeholder="Zoho ID"
                          className="h-7 text-xs"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">{agent.zoho_owner_id || "—"}</span>
                    )}
                  </div>
                  <div>
                    {editingId === agent.ctm_user_id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => saveMapping(agent.ctm_user_id)} disabled={saving}>
                          <Save className="w-3 h-3 mr-1" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startEdit(agent)}>Map</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        </div>
      </Card>
    </div>
  );
}
