import { assertEquals } from "jsr:@std/assert@1";
import { planSync, profileMap, rosterRowsFromUsers } from "./roster-sync.ts";

// A realistic slice of the live directory.
const users = [
  { id: "1", full_name: "Kenny Reitz", email: "k@x.com", profileName: "Business Development" },
  { id: "2", full_name: "Eric Wade", email: "e@x.com", profileName: "TREATMENT Standard" },
  { id: "3", full_name: "Sabrina Johnson", email: "s@x.com", profileName: "Administrator" },
  { id: "4", full_name: "Robert Dallessandro", email: "r@x.com", profileName: "TREATMENT Standard" },
  { id: "5", full_name: "Gerardo Vera", email: "g@x.com", profileName: "Call Center AHCCCS" },
];

Deno.test("both mapped profiles contribute candidates", () => {
  const rows = rosterRowsFromUsers(users);
  assertEquals(rows.map((r) => r.full_name).sort(), ["Eric Wade", "Kenny Reitz", "Robert Dallessandro"]);
});

Deno.test("unmapped profiles contribute nobody", () => {
  const rows = rosterRowsFromUsers(users);
  assertEquals(rows.some((r) => r.full_name === "Gerardo Vera"), false);
});

Deno.test("discovered candidates are NEVER auto-activated", () => {
  // TREATMENT Standard carries intake and Court Services too. Auditing
  // someone who is not a rep would assign them real discipline.
  const rows = rosterRowsFromUsers(users);
  assertEquals(rows.every((r) => r.active === false), true);
});

Deno.test("the pool includes people who are not reps — this is expected, not a bug", () => {
  const rows = rosterRowsFromUsers(users);
  // Robert Dallessandro is Court Services, surfaced for review, inactive.
  const robert = rows.find((r) => r.full_name === "Robert Dallessandro");
  assertEquals(robert?.team, "admissions");
  assertEquals(robert?.active, false);
});

Deno.test("the pool also MISSES a real rep — Sabrina carries Administrator", () => {
  // Which is why the roster table stays the source of truth and discovery
  // can only ever add to it.
  const rows = rosterRowsFromUsers(users);
  assertEquals(rows.some((r) => r.full_name === "Sabrina Johnson"), false);
});

Deno.test("sync is additive — it never removes or deactivates a rep", () => {
  const discovered = rosterRowsFromUsers(users);
  const plan = planSync(discovered, ["3"]); // Sabrina is on the roster, matches no profile
  assertEquals(plan.toInsert.map((r) => r.zoho_user_id).sort(), ["1", "2", "4"]);
  assertEquals(plan.unmatched, ["3"]);
});

Deno.test("re-running proposes nothing new", () => {
  const discovered = rosterRowsFromUsers(users);
  const ids = discovered.map((r) => r.zoho_user_id);
  assertEquals(planSync(discovered, ids).toInsert.length, 0);
});

Deno.test("the default map covers both teams", () => {
  const m = profileMap();
  assertEquals(m["Business Development"], "bd");
  assertEquals(m["TREATMENT Standard"], "admissions");
});
