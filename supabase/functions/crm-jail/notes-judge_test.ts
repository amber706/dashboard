import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildExcusePrompt, buildJudgePrompt, buildJudgeSchema, ITEM_CRITERIA, itemsForModule, parseExcuseResponse, parseJudgeResponse } from "./notes-judge.ts";

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

Deno.test("the excuse prompt names each blank field by its template wording", () => {
  const p = buildExcusePrompt("Client hung up before I got insurance details.", [
    { item: "L21", label: "Insurance Type" },
    { item: "L5", label: "Emergency Contact" },
  ]);
  assertStringIncludes(p, "L21: Insurance Type");
  assertStringIncludes(p, "L5: Emergency Contact");
  // The instruction that stops one excuse covering the whole record.
  assertStringIncludes(p, "THAT SPECIFIC field");
});

Deno.test("excuse parsing keeps only booleans, and only for items asked about", () => {
  const r = parseExcuseResponse(
    '{"L21":{"excused":true,"reason":"note explains it"},"L5":{"excused":"yes","reason":"x"},"ZZ1":{"excused":true,"reason":"y"}}',
    ["L21", "L5"],
  );
  assertEquals(Object.keys(r), ["L21"]);
  assertEquals(r.L21.excused, true);
});

Deno.test("a failed excuse call excuses nothing rather than everything", () => {
  // Erring the other way would forgive every blank on a judge outage.
  assertEquals(Object.keys(parseExcuseResponse("not json")).length, 0);
});

// Sabrina Johnson, 2026-09-30: "He said he already had another place picking
// him up, hung up" and "Caller refused to give insurance" were not read as
// explaining the blank client fields.
Deno.test("excuse prompt treats an unreachable or refusing client as explaining client fields", () => {
  const p = buildExcusePrompt("Caller refused to give insurance. UNABLE TO OBTAIN INSURANCE INFO", [
    { item: "L21", label: "Insurance Type" },
  ]);
  assertStringIncludes(p, "hung up, refused");
  assertStringIncludes(p, "excuses the insurance fields");
  assertStringIncludes(p, "never excuses what the rep sets themselves");
});
