import { assertEquals } from "jsr:@std/assert@1";
import adminMap from "./template-map.admissions.json" with { type: "json" };
import bdMap from "./template-map.bd.json" with { type: "json" };

// The harness reads manual scorecards through the same maps the writer uses.
// If those drift, the replay silently compares the wrong cells — so the
// invariants it depends on are pinned here rather than assumed.

Deno.test("both maps pin their sheet name", () => {
  assertEquals((adminMap as Record<string, unknown>).sheetName, "Admissions Scorecard");
  assertEquals((bdMap as Record<string, unknown>).sheetName, "BD Scorecard");
});

Deno.test("identity link rows exist for every section", () => {
  assertEquals((adminMap.identity as { link: number[] }).link.length, 3);
  assertEquals((bdMap.identity as { link: number[] }).link.length, 4);
});

Deno.test("every item carries the criterion text the excuse judge needs", () => {
  for (const [name, map] of [["admissions", adminMap], ["bd", bdMap]] as const) {
    const items = map.items as Record<string, { label?: string }>;
    const unlabelled = Object.entries(items).filter(([, v]) => !v.label).map(([k]) => k);
    assertEquals(unlabelled, [], `${name} has unlabelled items`);
  }
});

Deno.test("section prefixes resolve to the expected item counts", () => {
  const count = (map: typeof adminMap, p: string) =>
    Object.keys(map.items).filter((k) => new RegExp(`^${p}\\d+$`).test(k)).length;
  assertEquals(count(adminMap, "L"), 28);
  assertEquals(count(adminMap, "C"), 13);
  assertEquals(count(adminMap, "D"), 41);
  assertEquals(count(bdMap, "BC"), 10);  // BC3 does not exist
  assertEquals(count(bdMap, "CA"), 9);
  assertEquals(count(bdMap, "CO"), 18);
  assertEquals(count(bdMap, "M"), 9);
});

Deno.test("the C prefix does not swallow CA or CO items", () => {
  // "C" must not match "CA1"/"CO1" — a sloppy prefix test would compare
  // Contacts items against Calls cells and produce nonsense disagreements.
  const cItems = Object.keys(adminMap.items).filter((k) => /^C\d+$/.test(k));
  assertEquals(cItems.some((k) => k.startsWith("CA") || k.startsWith("CO")), false);
});
