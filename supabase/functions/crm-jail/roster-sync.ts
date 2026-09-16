// Derive the CRM Jail roster from Zoho CRM profiles.
//
// Which Zoho profile maps to which audit team is configuration, not code, so
// the mapping can be corrected without a deploy — set CRM_JAIL_PROFILE_MAP.
//
// A Zoho profile is a CANDIDATE POOL, not a roster. Confirmed by Amber
// 2026-09-15: admissions reps carry "TREATMENT Standard", but so does intake
// — which is exactly the problem the original spec named ("intake having the
// same roles and profiles"). Measured against 40 active users:
//   - "Business Development"  = 5 users, all 5 are BD reps. Exact.
//   - "TREATMENT Standard"   = 14 users, of whom 3 were audited. Includes
//                              Court Services and intake staff.
//   - Sabrina Johnson was audited as an admissions rep but carries
//     "Administrator" — so the pool does not even cover every rep.
//
// Therefore discovery PROPOSES; a human DISPOSES. New candidates are inserted
// with active = false and audit nobody until someone confirms them. Sync never
// removes anyone either: a rep silently dropping off the roster is a rep who
// is never audited again, and nobody would notice.

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
  /** Discovered candidates start inactive. Only a human activates a rep. */
  active: boolean;
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
  let raw: string | undefined;
  try {
    raw = Deno.env.get("CRM_JAIL_PROFILE_MAP");
  } catch {
    // No env permission (tests). Fall through to the default.
  }
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // Malformed override falls through to the default rather than syncing
      // an empty roster, which would skip everyone's audit silently.
    }
  }
  return {
    "Business Development": "bd",
    "TREATMENT Standard": "admissions",
  };
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
      // Never auto-activate. The profile is a candidate pool: TREATMENT
      // Standard carries intake and Court Services too, and auditing someone
      // who is not a rep would assign them real discipline.
      active: false,
      notes: `discovered via Zoho profile "${u.profileName}" — confirm before activating`,
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
