import { assertEquals } from "jsr:@std/assert@1";
import { auditWindowFor } from "./window.ts";

Deno.test("Wednesday run covers the previous Monday through Sunday", () => {
  // Wed 2026-09-16 09:00 Phoenix == 16:00 UTC
  const w = auditWindowFor(new Date("2026-09-16T16:00:00Z"));
  assertEquals(w.startISO, "2026-09-07");
  assertEquals(w.endISO, "2026-09-13");
});

Deno.test("window label matches the naming used on existing scorecards", () => {
  const w = auditWindowFor(new Date("2026-09-16T16:00:00Z"));
  assertEquals(w.label, "9/7-9/13/2026");
});

Deno.test("a run on any weekday resolves to the same previous week", () => {
  const wed = auditWindowFor(new Date("2026-09-16T16:00:00Z"));
  const fri = auditWindowFor(new Date("2026-09-18T16:00:00Z"));
  assertEquals(fri.startISO, wed.startISO);
  assertEquals(fri.endISO, wed.endISO);
});

Deno.test("late-evening Phoenix time does not roll into the next UTC day", () => {
  // Wed 2026-09-16 23:00 Phoenix == Thu 2026-09-17 06:00 UTC
  const w = auditWindowFor(new Date("2026-09-17T06:00:00Z"));
  assertEquals(w.startISO, "2026-09-07");
});
