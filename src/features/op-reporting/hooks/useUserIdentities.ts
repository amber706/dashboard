// useUserIdentities — fetches the active rep list for the Sales Rep
// multi-select in the FilterBar. ~37 rows, cached aggressively.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface UserIdentity {
  id: string;
  full_name: string | null;
  role_derived: "admissions_rep" | "bd_rep" | null;
  active: boolean;
}

export function useUserIdentities() {
  return useQuery({
    queryKey: ["op-user-identities"],
    queryFn: async (): Promise<UserIdentity[]> => {
      const { data, error } = await supabase.rpc("reporting_user_identity_list");
      if (error) throw new Error(`reporting_user_identity_list: ${error.message}`);
      return (data ?? []) as UserIdentity[];
    },
    staleTime: 30 * 60 * 1000, // 30 minutes — rep roster changes rarely
  });
}
