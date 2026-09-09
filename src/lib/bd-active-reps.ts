// Active BD reps — the roster the BD module reports on.
//
// Values are Zoho `Deal.BD_Rep` picklist values (bare first names), NOT
// profile / user ids: the BD edge functions group by that raw string, so
// the strings here have to match Zoho exactly.
//
// Reps who left (Casey, Mindy, Jacob, and further back Farah, Sean, Dane,
// Amber, Kimberly, Gene, Nico, Zac) keep their historical deals in Zoho,
// so the per-rep views filter against this list rather than showing every
// picklist value ever used. Legacy rows still count toward team totals —
// only the per-rep breakdown and pacing are scoped to the active roster.
//
// Last confirmed by Amber 2026-08-26. Small enough to live in code; if it
// starts changing more than once a quarter, move it to a config row
// (public.bd_team_roster already exists for that).
export const ACTIVE_BD_REPS = ["Joey", "Ben", "Mike", "Kenny", "Andy"] as const;

export type ActiveBdRep = (typeof ACTIVE_BD_REPS)[number];

export function isActiveBdRep(name: string): boolean {
  return (ACTIVE_BD_REPS as readonly string[]).includes(name);
}
