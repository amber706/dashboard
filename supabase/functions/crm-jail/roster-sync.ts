// Derive the CRM Jail roster from Zoho CRM profiles.
//
// Which Zoho profile maps to which audit team is configuration, not code, so
// the mapping can be corrected without a deploy — set CRM_JAIL_PROFILE_MAP.
//
// Reality check as of 2026-09-15 (verified twice against 40 active users):
//   - "Business Development" is exactly the 5 BD reps. Derivation works today.
//   - There is NO "Admissions Rep" profile. The 4 reps Megan audited split
//     across "TREATMENT Standard" (3) and "Administrator" (Sabrina Johnson),
//     and TREATMENT Standard holds 14 people of whom only 3 were audited.
//
// So sync is additive, never destructive: it can ADD a rep it discovers, but
// it never deactivates one. A profile that silently stops matching must not
// quietly empty the roster and skip everyone's audit.

export interface ZohoUserLite {
  id: string;
  full_name: string;
  email: string;
  profileName: string;
}

export interface RosterRow {
  zoho_user_id: string;
  full_name: string;
  email: string;
  team: "admissions" | "bd";
  auditor_email: string;
  notes: string;
}

export const DEFAULT_AUDITOR: Record<string, string> = {
  admissions: "megan@cornerstonehealingcenter.com",
  bd: "aaron@cornerstonehealingcenter.com",
};

/**
 * Zoho profile name -> audit team. Override with CRM_JAIL_PROFILE_MAP, e.g.
 *   {"Business Development":"bd","Admissions Rep":"admissions"}
 * A profile absent from the map contributes nobody.
 */
export function profileMap(): Record<string, "admissions" | "bd"> {
  const raw = Deno.env.get("CRM_JAIL_PROFILE_MAP");
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through to the default rather than syncing an empty roster.
    }
  }
  return { "Business Development": "bd" };
}

/** Users whose profile maps to a team, shaped as roster rows. */
export function rosterRowsFromUsers(
  users: ZohoUserLite[],
  map: Record<string, "admissions" | "bd"> = profileMap(),
): RosterRow[] {
  return users
    .filter((u) => map[u.profileName] !== undefined)
    .map((u) => ({
      zoho_user_id: u.id,
      full_name: u.full_name,
      email: u.email,
      team: map[u.profileName],
      auditor_email: DEFAULT_AUDITOR[map[u.profileName]],
      notes: `synced from Zoho profile "${u.profileName}"`,
    }));
}

export interface SyncPlan {
  toInsert: RosterRow[];
  /** On the roster but no longer matched by any mapped profile. Reported, never auto-removed. */
  unmatched: string[];
}

/**
 * Additive by design. `unmatched` is surfaced for a human to act on rather
 * than deactivated automatically: a rep dropping off the roster silently means
 * a rep who is never audited again, and nobody would notice.
 */
export function planSync(discovered: RosterRow[], existingZohoIds: string[]): SyncPlan {
  const existing = new Set(existingZohoIds);
  const discoveredIds = new Set(discovered.map((r) => r.zoho_user_id));
  return {
    toInsert: discovered.filter((r) => !existing.has(r.zoho_user_id)),
    unmatched: existingZohoIds.filter((id) => !discoveredIds.has(id)),
  };
}
