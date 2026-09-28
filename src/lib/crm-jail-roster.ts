// Roster data for the CRM Jail audit bot.
//
// A Zoho profile is a candidate pool, not the roster: "TREATMENT Standard"
// carries intake and Court Services as well as admissions reps, and it misses
// Sabrina Johnson, who carries "Administrator". So the bot discovers
// candidates inactive and a human activates the real reps here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type JailTeam = "admissions" | "bd";

export interface RosterRep {
  id: string;
  zoho_user_id: string;
  full_name: string;
  email: string;
  team: JailTeam;
  auditor_email: string;
  active: boolean;
  notes: string | null;
}

export const TEAM_LABEL: Record<JailTeam, string> = {
  admissions: "Admissions",
  bd: "Business Development",
};

export function useRoster() {
  return useQuery({
    queryKey: ["crm-jail-roster"],
    queryFn: async (): Promise<RosterRep[]> => {
      const { data, error } = await supabase
        .from("crm_jail_roster")
        .select("id,zoho_user_id,full_name,email,team,auditor_email,active,notes")
        .order("team")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as RosterRep[];
    },
  });
}

export function useSetRepActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("crm_jail_roster")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-jail-roster"] }),
  });
}

/** Split for display: who is audited, and who is only a candidate. */
export function partitionRoster(reps: RosterRep[]) {
  return {
    active: reps.filter((r) => r.active),
    candidates: reps.filter((r) => !r.active),
  };
}
