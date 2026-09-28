import { assertEquals } from "jsr:@std/assert@1";
import { expectedEodDays, holidayOn, holidaysFor } from "./holidays.ts";

// The anchor: Amber flagged Labor Day 2026 as the day two BD reps were wrongly
// marked absent. First Monday in September.
Deno.test("Labor Day 2026 is 9/7, the day that exposed the missing rule", () => {
  assertEquals(holidayOn("2026-09-07")?.name, "Labor Day");
  assertEquals(holidayOn("2027-09-06")?.name, "Labor Day");
});

Deno.test("a fixed holiday on a weekend is observed on the nearest weekday", () => {
  // 4 July 2026 is a Saturday -> observed Friday the 3rd. Without this the
  // audit marks everyone absent on the day they actually had off.
  assertEquals(holidaysFor(2026).find((h) => h.name === "Independence Day")?.date, "2026-07-03");
  // 4 July 2027 is a Sunday -> observed Monday the 5th.
  assertEquals(holidaysFor(2027).find((h) => h.name === "Independence Day")?.date, "2027-07-05");
  // 25 Dec 2027 is a Saturday -> observed Friday the 24th.
  assertEquals(holidaysFor(2027).find((h) => h.name === "Christmas Day")?.date, "2027-12-24");
});

Deno.test("the floating holidays land on the right weekday every year", () => {
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    const hs = holidaysFor(y);
    const dow = (name: string) =>
      new Date(`${hs.find((h) => h.name === name)!.date}T00:00:00Z`).getUTCDay();
    assertEquals(dow("Memorial Day"), 1, `Memorial Day ${y} must be a Monday`);
    assertEquals(dow("Labor Day"), 1, `Labor Day ${y} must be a Monday`);
    assertEquals(dow("Thanksgiving"), 4, `Thanksgiving ${y} must be a Thursday`);
  }
});

Deno.test("a New Year's Day holiday is found across the year boundary", () => {
  assertEquals(holidayOn("2027-01-01")?.name, "New Year's Day");
  assertEquals(holidayOn("2026-12-25")?.name, "Christmas Day");
  assertEquals(holidayOn("2026-09-08"), null);
});

// The audited week. Mon 9/7 is Labor Day, so BD is expected on Tue-Fri only —
// scored naively, Joey and Kenny failed A2 for a public holiday.
Deno.test("BD expects weekdays minus holidays", () => {
  assertEquals(expectedEodDays("2026-09-07", "2026-09-13", true), [
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
  ]);
});

Deno.test("admissions covers weekends, so only holidays drop out", () => {
  assertEquals(expectedEodDays("2026-09-07", "2026-09-13", false), [
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
  ]);
});
