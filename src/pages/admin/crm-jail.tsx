// /admin/crm-jail — who the CRM Jail audit bot audits.
//
// Why this page exists at all: the roster cannot be derived from a Zoho
// profile. Admissions reps carry "TREATMENT Standard", but so do intake and
// Court Services — 14 people hold it and only 3 were audited — and it misses
// Sabrina Johnson, who carries "Administrator". Supabase `profiles` is no
// better: its is_admissions_rep / is_bd_rep / team columns are unpopulated and
// it has no row at all for 4 of the 5 BD reps, who have no dashboard login.
//
// So the bot proposes candidates from mapped Zoho profiles as INACTIVE, and a
// human activates the ones who are really reps. Activating someone who is not
// a rep would assign them real discipline under policy OPS-CRM-001.

import { ShieldCheck, Users, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageShell } from "@/components/dashboard/PageShell";
import { useToast } from "@/hooks/use-toast";
import {
  TEAM_LABEL, partitionRoster, useRoster, useSetRepActive,
  type JailTeam, type RosterRep,
} from "@/lib/crm-jail-roster";

function RepRow({ rep, onToggle }: { rep: RosterRep; onToggle: (r: RosterRep, v: boolean) => void }) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
      data-testid={`roster-row-${rep.zoho_user_id}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{rep.full_name}</span>
          {!rep.active && <Badge variant="outline">Candidate</Badge>}
        </div>
        <div className="truncate text-sm text-muted-foreground">{rep.email}</div>
        {rep.notes && (
          <div className="truncate text-xs text-muted-foreground/80">{rep.notes}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right text-sm text-muted-foreground">
          <div className="text-xs uppercase tracking-wide">Auditor</div>
          <div>{rep.auditor_email}</div>
        </div>
        <Switch
          checked={rep.active}
          onCheckedChange={(v) => onToggle(rep, v)}
          aria-label={`Audit ${rep.full_name}`}
        />
      </div>
    </div>
  );
}

function TeamCard({
  team, reps, onToggle,
}: { team: JailTeam; reps: RosterRep[]; onToggle: (r: RosterRep, v: boolean) => void }) {
  const { active, candidates } = partitionRoster(reps);
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{TEAM_LABEL[team]}</h2>
          <Badge variant="secondary">{active.length} audited</Badge>
          {candidates.length > 0 && (
            <Badge variant="outline">{candidates.length} awaiting review</Badge>
          )}
        </div>

        {reps.length === 0 && (
          <p className="text-sm text-muted-foreground">No one on this team yet.</p>
        )}

        {active.map((r) => <RepRow key={r.id} rep={r} onToggle={onToggle} />)}

        {candidates.length > 0 && (
          <>
            <p className="mt-6 mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Discovered from Zoho — not audited until you turn them on
            </p>
            {candidates.map((r) => <RepRow key={r.id} rep={r} onToggle={onToggle} />)}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function CrmJailRoster() {
  const { data: reps, isLoading, error } = useRoster();
  const setActive = useSetRepActive();
  const { toast } = useToast();

  const onToggle = (rep: RosterRep, value: boolean) => {
    setActive.mutate(
      { id: rep.id, active: value },
      {
        onSuccess: () =>
          toast({
            title: value ? `${rep.full_name} will be audited` : `${rep.full_name} removed from audits`,
            description: value
              ? "They are included from the next Wednesday run."
              : "Their past scorecards are kept.",
          }),
        onError: (e) =>
          toast({ title: "Could not update", description: String(e), variant: "destructive" }),
      },
    );
  };

  const byTeam = (t: JailTeam) => (reps ?? []).filter((r) => r.team === t);

  return (
    <PageShell
      title="CRM Jail roster"
      subtitle="Who the weekly audit bot scores. Policy OPS-CRM-001."
    >
      <Alert className="mb-6">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This list is managed by hand on purpose. A Zoho profile is a candidate pool, not a
          roster — <strong>TREATMENT Standard</strong> also carries intake and Court Services,
          and it misses at least one real rep. Turning someone on here means the bot scores them
          and they can be assigned CRM Jail, so only activate people who are actually reps.
        </AlertDescription>
      </Alert>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Could not load the roster: {String(error)}</AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && (
        <div className="space-y-6">
          <TeamCard team="admissions" reps={byTeam("admissions")} onToggle={onToggle} />
          <TeamCard team="bd" reps={byTeam("bd")} onToggle={onToggle} />
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Turning someone off never deletes their history — past scorecards and jail events stay
            in the log.
          </p>
        </div>
      )}
    </PageShell>
  );
}
