import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { sampleRecords } from "./sampler.ts";

const ids = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}` }));

Deno.test("same seed draws the same records", () => {
  const a = sampleRecords(ids, 5, "2026-09-07:4402:Leads");
  const b = sampleRecords(ids, 5, "2026-09-07:4402:Leads");
  assertEquals(a.map((r) => r.id), b.map((r) => r.id));
});

Deno.test("different rep draws a different sample", () => {
  const a = sampleRecords(ids, 5, "2026-09-07:4402:Leads");
  const b = sampleRecords(ids, 5, "2026-09-07:9911:Leads");
  assertNotEquals(a.map((r) => r.id).join(), b.map((r) => r.id).join());
});

Deno.test("draws exactly n and never repeats a record", () => {
  const s = sampleRecords(ids, 5, "seed");
  assertEquals(s.length, 5);
  assertEquals(new Set(s.map((r) => r.id)).size, 5);
});

Deno.test("fewer records than n returns all of them", () => {
  // Kenny's Meetings section had 1 record and scored 3/9, not 3/45.
  const s = sampleRecords(ids.slice(0, 1), 5, "seed");
  assertEquals(s.length, 1);
});

Deno.test("empty input returns empty, does not throw", () => {
  assertEquals(sampleRecords([], 5, "seed").length, 0);
});

Deno.test("does not mutate the caller's array", () => {
  const pool = ids.slice(0, 10);
  const before = pool.map((r) => r.id).join();
  sampleRecords(pool, 5, "seed");
  assertEquals(pool.map((r) => r.id).join(), before);
});
