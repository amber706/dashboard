import { assertEquals } from "jsr:@std/assert@1";
import { planSync, rosterRowsFromUsers } from "./roster-sync.ts";

const users = [
  { id: "1", full_name: "Kenny Reitz", email: "k@x.com", profileName: "Business Development" },
  { id: "2", full_name: "Eric Wade", email: "e@x.com", profileName: "TREATMENT Standard" },
  { id: "3", full_name: "Sabrina Johnson", email: "s@x.com", profileName: "Administrator" },
  { id: "4", full_name: "Robert Dallessandro", email: "r@x.com", profileName: "TREATMENT Standard" },
];

Deno.test("the default map derives BD only — it is the one profile that is exact", () => {
  const rows = rosterRowsFromUsers(users, { "Business Development": "bd" });
  assertEquals(rows.map((r) => r.full_name), ["Kenny Reitz"]);
  assertEquals(rows[0].team, "bd");
  assertEquals(rows[0].auditor_email, "aaron@cornerstonehealingcenter.com");
});

Deno.test("an admissions profile is picked up the moment it is mapped", () => {
  const rows = rosterRowsFromUsers(users, { "Admissions Rep": "admissions" });
  assertEquals(rows.length, 0); // nobody carries it yet
  const withIt = rosterRowsFromUsers(
    [...users, { id: "9", full_name: "New Rep", email: "n@x.com", profileName: "Admissions Rep" }],
    { "Admissions Rep": "admissions" },
  );
  assertEquals(withIt.map((r) => r.full_name), ["New Rep"]);
  assertEquals(withIt[0].team, "admissions");
});

Deno.test("mapping TREATMENT Standard would pull in people who are not audited", () => {
  // Documents why this profile is NOT mapped by default: Robert Dallessandro
  // is Court Services, not an admissions rep.
  const rows = rosterRowsFromUsers(users, { "TREATMENT Standard": "admissions" });
  assertEquals(rows.map((r) => r.full_name), ["Eric Wade", "Robert Dallessandro"]);
});

Deno.test("sync is additive — it never removes a rep", () => {
  const discovered = rosterRowsFromUsers(users, { "Business Development": "bd" });
  const plan = planSync(discovered, ["99"]); // 99 is on the roster, matches nothing
  assertEquals(plan.toInsert.map((r) => r.zoho_user_id), ["1"]);
  // Reported for a human, not deactivated: a rep silently dropping off the
  // roster is a rep who is never audited again.
  assertEquals(plan.unmatched, ["99"]);
});

Deno.test("re-running finds nothing new", () => {
  const discovered = rosterRowsFromUsers(users, { "Business Development": "bd" });
  assertEquals(planSync(discovered, ["1"]).toInsert.length, 0);
});
