import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildMessage, buildRows, type ComingBackDeal, DETAIL_HEADER, groupByFacility, isNew,
  NO_FACILITY, toDeal,
} from "./report.ts";

const deal = (over: Partial<ComingBackDeal>): ComingBackDeal => ({
  id: "1", client: "A", facility: "Vogue Recovery", referOutDate: "2026-09-20",
  referOutType: "Detox Attached", pipeline: "AHCCCS", bdRep: "Joey", owner: "Taylor Bertchie",
  admittedAtFacility: null, ...over,
});

Deno.test("COQL lookup subfields map onto the deal", () => {
  const d = toDeal({
    id: "9", Deal_Name: "Jo", "Referred_Out.Account_Name": "Hopess",
    "Owner.first_name": "Dana", "Owner.last_name": "Yazzie", Refer_Out_Date: "2026-09-02",
  });
  assertEquals(d.facility, "Hopess");
  assertEquals(d.owner, "Dana Yazzie");
  assertEquals(d.bdRep, null);
});

Deno.test("largest facility first, newest refer-out first inside it", () => {
  const groups = groupByFacility([
    deal({ id: "1", facility: "Hopess" }),
    deal({ id: "2", referOutDate: "2026-09-01" }),
    deal({ id: "3", referOutDate: "2026-09-24" }),
  ]);
  assertEquals(groups.map((g) => g.facility), ["Vogue Recovery", "Hopess"]);
  assertEquals(groups[0].deals.map((d) => d.id), ["3", "2"]);
});

Deno.test("a deal with no facility is grouped, not dropped", () => {
  const groups = groupByFacility([deal({ facility: null })]);
  assertEquals(groups[0].facility, NO_FACILITY);
});

Deno.test("new means referred out yesterday or today", () => {
  assertEquals(isNew(deal({ referOutDate: "2026-09-24" }), "2026-09-25"), true);
  assertEquals(isNew(deal({ referOutDate: "2026-09-23" }), "2026-09-25"), false);
  assertEquals(isNew(deal({ referOutDate: null }), "2026-09-25"), false);
});

Deno.test("every detail row carries its facility and a Zoho link", () => {
  const rows = buildRows("2026-09-25", groupByFacility([deal({ id: "77" })]));
  const h = rows.findIndex((r) => r[0] === DETAIL_HEADER[0] && r[1] === DETAIL_HEADER[1]);
  assertEquals(rows[h + 1][0], "Vogue Recovery");
  assertEquals(rows[h + 1][4], "5");
  assertStringIncludes(rows[h + 1][10], "/Potentials/77");
});

Deno.test("the email names new refer-outs and where they went", () => {
  const msg = buildMessage("2026-09-25", groupByFacility([
    deal({ client: "Brett Peterson", referOutDate: "2026-09-24" }),
    deal({ client: "Old One", referOutDate: "2026-08-01", facility: "Hopess" }),
  ]));
  assertStringIncludes(msg, "2 active");
  assertStringIncludes(msg, "• Brett Peterson → Vogue Recovery");
  assertEquals(msg.includes("Old One"), false);
  assertStringIncludes(msg, "• Hopess: 1");
});
