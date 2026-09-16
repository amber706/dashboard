import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildJudgePrompt, buildJudgeSchema, ITEM_CRITERIA, itemsForModule, parseJudgeResponse } from "./notes-judge.ts";

Deno.test("prompt carries the note text and the items being judged", () => {
  const p = buildJudgePrompt("Left voicemail for Wayne.", ["CA7", "CA8"]);
  assertStringIncludes(p, "Left voicemail for Wayne.");
  assertStringIncludes(p, "CA7");
  assertStringIncludes(p, "CA8");
  assertStringIncludes(p, ITEM_CRITERIA.CA8);
});

Deno.test("parses a well-formed verdict", () => {
  const r = parseJudgeResponse(
    '{"CA7":{"score":1,"reason":"Describes the call."},"CA8":{"score":0,"reason":"No next step."}}',
  );
  assertEquals(r.CA7.score, 1);
  assertEquals(r.CA8.reason, "No next step.");
});

Deno.test("tolerates prose wrapped around the JSON", () => {
  const r = parseJudgeResponse('Here you go:\n{"M7":{"score":0,"reason":"No agenda."}}\nHope that helps.');
  assertEquals(r.M7.score, 0);
});

Deno.test("malformed output yields an empty verdict rather than throwing", () => {
  // A model outage must never cost a rep points — an empty verdict defers.
  assertEquals(Object.keys(parseJudgeResponse("not json")).length, 0);
  assertEquals(Object.keys(parseJudgeResponse("")).length, 0);
});

Deno.test("a score outside 1/0 is discarded", () => {
  assertEquals(Object.keys(parseJudgeResponse('{"CA7":{"score":7,"reason":"x"}}')).length, 0);
  assertEquals(Object.keys(parseJudgeResponse('{"CA7":{"score":"1","reason":"x"}}')).length, 0);
});

Deno.test("only the items asked for are kept", () => {
  // The model inventing an item id would write a score into the wrong cell.
  const r = parseJudgeResponse('{"CA7":{"score":1,"reason":"ok"},"ZZ9":{"score":0,"reason":"?"}}', ["CA7"]);
  assertEquals(Object.keys(r), ["CA7"]);
});

Deno.test("each module asks only for its own language items", () => {
  assertEquals(itemsForModule("Leads"), ["L26", "L27"]);
  assertEquals(itemsForModule("Calls"), ["CA7", "CA8"]);
  assertEquals(itemsForModule("Events"), ["M7", "M8"]);
  assertEquals(itemsForModule("Accounts"), []);
});

Deno.test("every judged item has criteria text", () => {
  for (const mod of ["Leads", "Contacts", "Deals", "Calls", "Events"]) {
    for (const item of itemsForModule(mod)) {
      assertEquals(typeof ITEM_CRITERIA[item], "string", `${item} has no criteria`);
    }
  }
});

Deno.test("the schema constrains the reply to exactly the items asked for", () => {
  const sch = buildJudgeSchema(["CA7", "CA8"]) as Record<string, any>;
  assertEquals(Object.keys(sch.properties), ["CA7", "CA8"]);
  assertEquals(sch.required, ["CA7", "CA8"]);
  // Required by the API for every object in a structured-output schema.
  assertEquals(sch.additionalProperties, false);
  assertEquals(sch.properties.CA7.properties.score.enum, [0, 1]);
  assertEquals(sch.properties.CA7.additionalProperties, false);
});

Deno.test("a truncated reply yields nothing rather than a half-scored record", () => {
  // max_tokens cut-off used to surface as a silent defer; it must not produce
  // a partial verdict that scores some items and drops others.
  assertEquals(Object.keys(parseJudgeResponse('{"CA7":{"score":1,"reason":"ok"},"CA8":{"sco')).length, 0);
});
