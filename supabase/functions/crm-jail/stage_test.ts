import { assertEquals } from "jsr:@std/assert@1";
import { daysSince, stageKey, stageVerdict } from "./stage.ts";

const today = "2026-10-26";
const v = (stage: string, f: Parameters<typeof stageVerdict>[1]) => stageVerdict(stage, f, today)!;
const none = { lastReferral: null, lastAdmit: null };

Deno.test("stageKey strips the probability from Zoho's picklist labels", () => {
  assertEquals(stageKey("Referring - 75%"), "referring");
  assertEquals(stageKey("New/Onboarding - 25%"), "new/onboarding");
  assertEquals(stageKey("Delete -0%"), "delete");
});

Deno.test("daysSince counts Phoenix calendar days", () => {
  assertEquals(daysSince("2026-09-26", today), 30);
  // 23:30 Phoenix on 9/25 is 9/26 in UTC, but 31 days ago in Phoenix.
  assertEquals(daysSince("2026-09-26T06:30:00Z", today), 31);
});

Deno.test("the ladder: admit, then referral 0-30, 31-89, then 90+", () => {
  assertEquals(v("Admitting - 100%", { lastReferral: "2026-10-20", lastAdmit: "2026-10-22" }).correct, true);
  assertEquals(v("Referring - 75%", { lastReferral: "2026-10-20", lastAdmit: "2026-10-22" }).expected, "Admitting");
  assertEquals(v("Referring - 75%", { lastReferral: "2026-09-26", lastAdmit: null }).correct, true); // day 30
  assertEquals(v("Referring - 75%", { lastReferral: "2026-09-25", lastAdmit: null }).expected, "Not Referring"); // day 31
  assertEquals(v("Not Referring - 50%", { lastReferral: "2026-07-29", lastAdmit: null }).correct, true); // day 89
  assertEquals(v("Not Referring - 50%", none).expected, "Dormant");
});

Deno.test("a referral after a closed admit window still reads Referring", () => {
  // Admit 31 days ago is outside the window; the referral governs.
  assertEquals(v("Admitting - 100%", { lastReferral: "2026-10-10", lastAdmit: null }).expected, "Referring");
});

Deno.test("first contact in the last 30 days with no referral means New / Onboarding", () => {
  const f = { ...none, firstContact: "2026-10-05" };
  assertEquals(v("New/Onboarding - 25%", f).correct, true);
  assertEquals(v("Leads - 10%", f).expected, "New / Onboarding");
});

// Aaron, 2026-10-26: "If we get a referral at any point, a company is
// considered referring."
Deno.test("a referral during onboarding makes the company Referring", () => {
  const f = { lastReferral: "2026-10-20", lastAdmit: null, firstContact: "2026-10-05" };
  assertEquals(v("New/Onboarding - 25%", f).expected, "Referring");
  assertEquals(v("Leads - 10%", { lastReferral: "2026-10-20", lastAdmit: null }).expected, "Referring");
});

Deno.test("an admit during onboarding makes the company Admitting", () => {
  const f = { lastReferral: "2026-10-20", lastAdmit: "2026-10-22", firstContact: "2026-10-05" };
  assertEquals(v("New/Onboarding - 25%", f).expected, "Admitting");
});

Deno.test("a company that has referred is on the ladder, not onboarding", () => {
  // Referral 40 days ago; first logged meeting 10 days ago.
  const f = { lastReferral: "2026-09-16", lastAdmit: null, firstContact: "2026-10-16" };
  assertEquals(v("New/Onboarding - 25%", f).expected, "Not Referring");
});

Deno.test("onboarding ends at day 30 and the ladder takes over", () => {
  assertEquals(v("New/Onboarding - 25%", { ...none, firstContact: "older" }).expected, "Dormant");
  assertEquals(v("Leads - 10%", { ...none, firstContact: "older" }).correct, false);
});

Deno.test("with no referrals and unknown contact history, Lead and Dormant are both accepted", () => {
  assertEquals(v("Leads - 10%", none).correct, true);
  assertEquals(v("Dormant - 5%", none).correct, true);
  assertEquals(v("Referring - 75%", none).correct, false);
});

Deno.test("Archive and Delete are not scored", () => {
  assertEquals(stageVerdict("Archive - 0%", none, today), null);
  assertEquals(stageVerdict("Delete -0%", none, today), null);
});

Deno.test("a blank stage is wrong", () => {
  const r = v("", { lastReferral: "2026-10-20", lastAdmit: null });
  assertEquals([r.correct, r.current, r.expected], [false, "(blank)", "Referring"]);
});

// Mesa Family Therapy (Ben Coulter): New/Onboarding, note "Trying to make
// contact with this company", nothing linked in 30 days.
Deno.test("New / Onboarding with no recent contact and no referrals is Lead or Dormant", () => {
  const r = v("New/Onboarding - 25%", none);
  assertEquals([r.correct, r.expected], [false, "Lead or Dormant"]);
});
