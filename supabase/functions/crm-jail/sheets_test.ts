import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  cellFor, dailyCellFor, explanationCellFor, headerCell, identityCellsFor,
  isComputedCell, scorecardTitle, writeCells,
} from "./sheets.ts";

Deno.test("maps an item and record index to the right cell", () => {
  // Admissions: L1 is row 38, records run E..I.
  assertEquals(cellFor("admissions", "L1", 0), "E38");
  assertEquals(cellFor("admissions", "L1", 4), "I38");
  assertEquals(cellFor("admissions", "D41", 0), "E137");
  // BD: BC1 is row 40, CO18 is row 94.
  assertEquals(cellFor("bd", "BC1", 0), "E40");
  assertEquals(cellFor("bd", "CO18", 2), "G94");
});

Deno.test("BD has no BC3 and asking for it fails loudly", () => {
  assertThrows(() => cellFor("bd", "BC3", 0), Error, "No template row for item BC3");
});

Deno.test("an out-of-range record index fails rather than writing somewhere wrong", () => {
  assertThrows(() => cellFor("admissions", "L1", 5), Error, "out of range");
});

Deno.test("identity cells follow section order", () => {
  // Admissions sections: Leads, Contacts, Deals -> name rows 35, 72, 94.
  assertEquals(identityCellsFor("admissions", "Leads", 0).name, "E35");
  assertEquals(identityCellsFor("admissions", "Deals", 0).name, "E94");
  assertEquals(identityCellsFor("admissions", "Contacts", 1).link, "F73");
  // BD sections: BusinessContacts, Calls, Companies, Meetings -> 37, 56, 74, 101.
  assertEquals(identityCellsFor("bd", "BusinessContacts", 0).name, "E37");
  assertEquals(identityCellsFor("bd", "Meetings", 0).date, "E103");
});

Deno.test("daily items are scored once, in the first record column", () => {
  assertEquals(dailyCellFor("admissions", "A1"), "E25");
  assertEquals(dailyCellFor("bd", "A7"), "E32");
});

Deno.test("explanations go to column K", () => {
  assertEquals(explanationCellFor("admissions", "L26"), "K63");
  assertEquals(explanationCellFor("bd", "CA8"), "K66");
});

Deno.test("header cells are known for both teams", () => {
  assertEquals(headerCell("admissions", "rep"), "C6");
  assertEquals(headerCell("bd", "windowTo"), "E8");
});

Deno.test("titles match the naming already used on each team", () => {
  assertEquals(scorecardTitle("admissions", "Sabrina Johnson", "8/31-9/4/2026"), "SJ: CRM Audit 8/31-9/4/2026");
  assertEquals(scorecardTitle("bd", "Kenny Reitz", "8/31-9/4/2026"), "BD CRM Jail Audit: Kenny Reitz 8/31-9/4/2026");
});

Deno.test("formula cells are recognised on both teams", () => {
  // Admissions "Leads — points earned" row 66; BD "Calls — score" row 70.
  assertEquals(isComputedCell("admissions", "E66"), true);
  assertEquals(isComputedCell("bd", "E70"), true);
  assertEquals(isComputedCell("admissions", "E38"), false);
});

Deno.test("writeCells refuses to overwrite a formula", async () => {
  // This is the guard that stops the bot silently breaking the score that
  // decides whether a rep goes to jail.
  let called = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => { called = true; return Promise.resolve(new Response("{}")); }) as typeof fetch;
  try {
    await writeCells("tok", "admissions", "sheet1", [
      { a1: "E38", value: 1 },
      { a1: "E66", value: 999 },
    ]);
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals(String(e).includes("Refusing to overwrite computed cells: E66"), true);
    assertEquals(called, false); // nothing was sent to Google
  } finally {
    globalThis.fetch = origFetch;
  }
});
