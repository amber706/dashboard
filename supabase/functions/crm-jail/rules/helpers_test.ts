import { assertEquals } from "jsr:@std/assert@1";
import { isPresent, isProperCase, loggedSameDay, noteText, zohoUrl, inWindow, lookupPresent } from "./helpers.ts";

Deno.test("isPresent rejects blank, whitespace and Zoho's null shapes", () => {
  assertEquals(isPresent("Wayne"), true);
  assertEquals(isPresent(0), true); // a real zero is a value
  assertEquals(isPresent(false), true);
  assertEquals(isPresent(""), false);
  assertEquals(isPresent("   "), false);
  assertEquals(isPresent(null), false);
  assertEquals(isPresent(undefined), false);
  assertEquals(isPresent([]), false);
});

Deno.test("isProperCase catches the all-caps and all-lower cases the template targets", () => {
  assertEquals(isProperCase("Wayne Jackson"), true);
  assertEquals(isProperCase("Aiyana McGarry Fairley"), true);
  assertEquals(isProperCase("O'Brien"), true);
  assertEquals(isProperCase("WAYNE JACKSON"), false);
  assertEquals(isProperCase("wayne jackson"), false);
  assertEquals(isProperCase("wayne Jackson"), false);
});

Deno.test("loggedSameDay compares Phoenix calendar days, not UTC instants", () => {
  // Occurred Fri 4 Sep 10:20 Phoenix; logged Fri 4 Sep 10:47 Phoenix.
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", "2026-09-04T17:47:00Z"), true);
  // Occurred Fri 4 Sep; logged Mon 7 Sep — this is the CA1 failure on Kenny's sheet.
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", "2026-09-07T15:45:00Z"), false);
  // 23:30 Phoenix is still the same Phoenix day even though UTC has rolled over.
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", "2026-09-05T06:30:00Z"), true);
});

Deno.test("loggedSameDay is false when either timestamp is missing", () => {
  assertEquals(loggedSameDay("", "2026-09-04T17:47:00Z"), false);
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", ""), false);
});

Deno.test("inWindow uses Phoenix calendar days inclusive of both ends", () => {
  const w = { startISO: "2026-08-31", endISO: "2026-09-04" };
  assertEquals(inWindow("2026-08-31T14:00:00Z", w), true);
  assertEquals(inWindow("2026-09-05T02:00:00Z", w), true); // 7pm Phoenix on 9/4
  assertEquals(inWindow("2026-09-05T14:00:00Z", w), false);
});

Deno.test("noteText concatenates title and content across all notes", () => {
  const t = noteText([
    { Note_Title: "Call", Note_Content: "Left voicemail." },
    { Note_Content: "Will retry Tuesday." },
  ]);
  assertEquals(t.includes("Left voicemail."), true);
  assertEquals(t.includes("Will retry Tuesday."), true);
});

Deno.test("lookupPresent requires an actual linked record, not just a truthy value", () => {
  assertEquals(lookupPresent({ id: "9", name: "Jacob's Hope" }), true);
  assertEquals(lookupPresent(null), false);
  assertEquals(lookupPresent("Jacob's Hope"), false); // a bare string is not a link
});

Deno.test("zohoUrl builds the tab links the templates use", () => {
  assertEquals(
    zohoUrl("Contacts", "5162065000397907018"),
    "https://crm.zoho.com/crm/cornerstone/tab/Contacts/5162065000397907018",
  );
});
