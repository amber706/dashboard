import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { sampleRecords, sampleRotating } from "./sampler.ts";

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

// Aaron, 2026-10-14: owned Companies and Business Contacts, five a week, and no
// record twice in a quarter when the rep owns enough — never twice in a month.

const owned = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(3, "0")}` }));
const idsOf = (rs: Array<{ id: string }>) => rs.map((r) => r.id).sort();

Deno.test("rotation never redraws a record sampled in the last 90 days when enough are fresh", () => {
  const pool = owned(40);
  const history = new Map<string, string>();
  let week = "2026-10-05";
  const seen = new Map<string, string>();
  for (let w = 0; w < 8; w++) {
    const drawn = sampleRotating(pool, 5, `s:${week}`, history, week);
    assertEquals(drawn.length, 5);
    for (const r of drawn) {
      assertEquals(seen.has(r.id), false, `${r.id} redrawn in week ${week}`);
      seen.set(r.id, week);
      history.set(r.id, week);
    }
    week = new Date(new Date(`${week}T00:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  }
});

Deno.test("a small pool refills from records last drawn 30-90 days ago, never from the last 30", () => {
  const pool = owned(7);
  const history = new Map<string, string>([
    ["r000", "2026-09-28"], ["r001", "2026-09-21"], // within 30 days of 10/05: never
    ["r002", "2026-08-24"], ["r003", "2026-08-17"], // 30-90 days: refill
  ]);
  const drawn = idsOf(sampleRotating(pool, 5, "s", history, "2026-10-05"));
  assertEquals(drawn.includes("r000") || drawn.includes("r001"), false);
  assertEquals(drawn, ["r002", "r003", "r004", "r005", "r006"]);
});

Deno.test("a pool with nothing eligible returns fewer than five rather than repeating", () => {
  const pool = owned(3);
  const history = new Map(pool.map((r) => [r.id, "2026-09-28"]));
  assertEquals(sampleRotating(pool, 5, "s", history, "2026-10-05").length, 0);
});

Deno.test("re-running the same week redraws the same records", () => {
  const pool = owned(30);
  const history = new Map<string, string>([["r001", "2026-10-05"]]); // this week's own draw
  const a = idsOf(sampleRotating(pool, 5, "s", history, "2026-10-05"));
  const b = idsOf(sampleRotating([...pool].reverse(), 5, "s", history, "2026-10-05"));
  assertEquals(a, b);
});
