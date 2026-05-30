import { describe, it, expect } from "vitest";
import { resolveDateRange } from "./useDateRange";

// Regression guard for the UTC off-by-one bug: isoDate must format from LOCAL
// date components, not toISOString() (which serializes in UTC and rolls the
// date forward by a day for negative UTC offsets like Phoenix's UTC-7).
//
// We construct `today` as an evening local time. If isoDate were UTC-based,
// these would shift forward a day and the assertions below would fail.
describe("resolveDateRange (local-date formatting)", () => {
  // Fri 2026-05-29, 21:00 local — the scenario from the bug report.
  const evening = new Date(2026, 4, 29, 21, 0, 0);

  it("TODAY resolves to the local calendar day", () => {
    expect(resolveDateRange("TODAY", undefined, evening)).toEqual({
      from: "2026-05-29",
      to: "2026-05-29",
    });
  });

  it("YESTERDAY resolves to the prior local calendar day", () => {
    expect(resolveDateRange("YESTERDAY", undefined, evening)).toEqual({
      from: "2026-05-28",
      to: "2026-05-28",
    });
  });

  it("MTD spans start-of-month through the local today", () => {
    expect(resolveDateRange("MTD", undefined, evening)).toEqual({
      from: "2026-05-01",
      to: "2026-05-29",
    });
  });

  it("L30D ends on the local today", () => {
    expect(resolveDateRange("L30D", undefined, evening).to).toBe("2026-05-29");
  });
});
