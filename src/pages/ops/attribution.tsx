import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { StatCard } from "@/components/ops/stat-card";
import { ReviewActions } from "@/components/ops/suggestion-actions";
import { StatusBadge } from "@/components/ops/priority-badge";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { useToast } from "@/hooks/use-toast";
import { useAttributionConflicts, resolveAttribution, type AttributionConflict } from "@/hooks/use-ops-api";
import {
  RefreshCw, AlertTriangle, CheckCircle2, ArrowRight,
  Activity, XCircle, Shield,
} from "lucide-react";

function OpsAttributionContent() {
  const { data, loading, error, refetch } = useAttributionConflicts({ interval: 30000 });
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const { toast } = useToast();

  const handleResolve = async (id: number, action: "approve" | "reject" | "preserve_first_touch") => {
    setActionLoading(id);
    try {
      await resolveAttribution(id, action);
      refetch();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "Could not complete the action. Please try again.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const conflicts = data?.conflicts || [];
  const pending = conflicts.filter((c) => c.status === "pending");
  const resolved = conflicts.filter((c) => c.status !== "pending");

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Attribution Review"
        subtitle="Resolve CTM vs Zoho source data conflicts before they impact reporting"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        <StatCard
          label="Pending Conflicts"
          value={pending.length}
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          changeType={pending.length > 0 ? "negative" : "neutral"}
          loading={loading && !data}
        />
        <StatCard
          label="Total Conflicts"
          value={conflicts.length}
          icon={<Activity className="w-4 h-4 text-blue-400" />}
          loading={loading && !data}
        />
        <StatCard
          label="Resolved"
          value={resolved.length}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          loading={loading && !data}
        />
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      ) : error && !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Unable to load attribution data. The operations API may not be configured yet.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : conflicts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-lg font-medium">All Clear</p>
            <p className="text-sm text-muted-foreground mt-1">No attribution conflicts pending review</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {conflicts.map((conflict: AttributionConflict) => (
            <Card key={conflict.id} className="overflow-hidden">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium">Attribution Conflict</span>
                    <Badge variant="outline" className="text-[10px] font-mono">Call {conflict.ctm_call_id}</Badge>
                    <StatusBadge status={conflict.status} />
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {conflict.created_at ? new Date(conflict.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/40 dark:border-blue-800/20 space-y-3">
                    <div className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider">CTM Source Data</div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground">Source</span>
                        <div className="font-medium mt-0.5">{conflict.ctm_source || "—"}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Medium</span>
                        <div className="font-medium mt-0.5">{conflict.ctm_medium || "—"}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Campaign</span>
                        <div className="font-medium mt-0.5">{conflict.ctm_campaign || "—"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200/40 dark:border-orange-800/20 space-y-3">
                    <div className="text-[10px] font-semibold text-orange-500 dark:text-orange-400 uppercase tracking-wider">Zoho Source Fields</div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground">Source</span>
                        <div className="font-medium mt-0.5">{conflict.zoho_source || "—"}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Medium</span>
                        <div className="font-medium mt-0.5">{conflict.zoho_medium || "—"}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Campaign</span>
                        <div className="font-medium mt-0.5">{conflict.zoho_campaign || "—"}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">Conflict Reason:</span>
                    <span className="text-muted-foreground">{conflict.conflict_reason}</span>
                  </div>
                  {conflict.proposed_correction && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground font-medium">Proposed Fix:</span>
                      <span className="text-emerald-400">{conflict.proposed_correction}</span>
                    </div>
                  )}
                </div>

                {conflict.status === "pending" && (
                  <div className="pt-2 border-t">
                    <ReviewActions
                      itemId={conflict.id}
                      onApprove={(id) => handleResolve(id, "approve")}
                      onReject={(id) => handleResolve(id, "reject")}
                      onPreserve={(id) => handleResolve(id, "preserve_first_touch")}
                      loading={actionLoading}
                      approveLabel="Apply CTM Data"
                      rejectLabel="Keep Zoho Data"
                      preserveLabel="Preserve First Touch"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsAttribution() {
  return <OpsRoleGuard><OpsAttributionContent /></OpsRoleGuard>;
}
