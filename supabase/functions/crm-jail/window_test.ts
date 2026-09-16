import { assertEquals } from "jsr:@std/assert@1";
import { auditWindowFor, windowFrom } from "./window.ts";

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

// The dispatcher fans out one invocation per rep. It used to pass a timestamp
// inside the target window and let each child call auditWindowFor again — but
// that function counts back from the week CONTAINING its argument, so every
// child silently audited one week too early. The live 9/7-9/13 run reported
// 9/7-9/13 and built all nine scorecards from 8/31-9/6. windowFrom is the
// round trip that has to hold.
Deno.test("a window survives the trip to a fanned-out child unchanged", () => {
  const parent = auditWindowFor(new Date("2026-09-16T16:33:00Z")); // Wed, Phoenix
  assertEquals(parent.startISO, "2026-09-07");
  assertEquals(parent.endISO, "2026-09-13");

  const child = windowFrom(parent.startISO);
  assertEquals(child, parent);
});

Deno.test("re-deriving a child window from a date inside it is the old bug", () => {
  const parent = auditWindowFor(new Date("2026-09-16T16:33:00Z"));
  const reDerived = auditWindowFor(new Date(`${parent.endISO}T12:00:00Z`));
  // Documents why the timestamp hand-off could not work: it lands a week early.
  assertEquals(reDerived.startISO, "2026-08-31");
  assertEquals(windowFrom(parent.startISO).startISO, "2026-09-07");
});
