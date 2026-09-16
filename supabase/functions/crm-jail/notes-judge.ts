// Judges the language items — narrative, next step, agenda — that a presence
// check cannot.
//
// These are real discriminators in the manual audits: on Kenny Reitz's 8/31-9/4
// scorecard CA8 failed 2 of 5 and BC11 failed 2 of 5. A length check would
// have scored those 1 and materially overstated his result.
//
// PHI: note text can contain client information. This module is inert unless
// ANTHROPIC_API_KEY is set, and every judged rule degrades to DEFER rather
// than 0 when no verdict comes back — so leaving it off is safe.

const MODEL = "claude-sonnet-5";

export interface Verdict {
  score: 1 | 0;
  reason: string;
}

/** Item id -> the criterion text, taken verbatim from the scorecards. */
export const ITEM_CRITERIA: Record<string, string> = {
  L26: "The notes contain a clear narrative of what happened.",
  L27: "The notes contain a specific, actionable next step.",
  C12: "The notes contain a clear narrative plus a specific next step.",
  D22: "The notes contain a clear narrative plus a specific next step.",
  D23: "Any field that could not be completed is named in the notes with the reason.",
  D37: "The notes explain why the deal was lost and give the next step.",
  BC11: "The notes clearly describe this person's role and their relationship to us.",
  CA7: "The notes contain a clear narrative of the conversation.",
  CA8: "The notes contain a specific, actionable next step.",
  M7: "The meeting notes include the agenda.",
  M8: "The meeting notes include next steps.",
};

/**
 * Which language items apply to a module. Contacts serves both scorecards —
 * C12 for Admissions, BC11 for BD — so the caller passes the team-specific
 * module key where they differ.
 */
export function itemsForModule(module: string): string[] {
  switch (module) {
    case "Leads":
      return ["L26", "L27"];
    case "Contacts":
      return ["C12"];
    case "BusinessContacts":
      return ["BC11"];
    case "Deals":
      return ["D22", "D23", "D37"];
    case "Calls":
      return ["CA7", "CA8"];
    case "Events":
      return ["M7", "M8"];
    default:
      return [];
  }
}

/**
 * Schema the reply is constrained to. Structured outputs replace the assistant
 * prefill trick, which Sonnet 5 rejects outright ("This model does not support
 * assistant message prefill"). Constraining the schema is also stronger than
 * asking politely for JSON — it removes the parse failure mode rather than
 * making it rarer.
 */
export function buildJudgeSchema(items: string[]): Record<string, unknown> {
  const verdict = {
    type: "object",
    properties: {
      score: { type: "integer", enum: [0, 1] },
      reason: { type: "string" },
    },
    required: ["score", "reason"],
    additionalProperties: false,
  };
  const properties: Record<string, unknown> = {};
  for (const item of items) properties[item] = verdict;
  return {
    type: "object",
    properties,
    required: items,
    additionalProperties: false,
  };
}

export function buildJudgePrompt(notes: string, items: string[]): string {
  const criteria = items.map((i) => `${i}: ${ITEM_CRITERIA[i] ?? i}`).join("\n");
  return `You are auditing CRM notes written by an admissions or business development rep at a \
treatment center. Score each criterion 1 if the notes satisfy it, 0 if they do not.

Be strict but fair. A note that says only "called", "left message", or "spoke with client" has \
no narrative and no next step. A note is not required to be long — it is required to say what \
happened and what happens next.

Per the CRM Jail policy: a blank field is not automatically a failure if the note explains why \
it could not be filled. Credit that.

Criteria:
${criteria}

Notes:
"""
${notes}
"""

Score every criterion listed above. The reason is shown to the rep as coaching,
so say specifically what was missing.`;
}

/**
 * Returns {} on anything malformed. `allowed` restricts the result to the
 * items actually asked for — a model inventing an item id would otherwise
 * write a score into the wrong cell of someone's scorecard.
 */
export function parseJudgeResponse(raw: string, allowed?: string[]): Record<string, Verdict> {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const parsed = JSON.parse(match[0]) as Record<string, { score?: unknown; reason?: unknown }>;
    const out: Record<string, Verdict> = {};
    for (const [item, v] of Object.entries(parsed)) {
      if (v?.score !== 1 && v?.score !== 0) continue;
      if (allowed && !allowed.includes(item)) continue;
      out[item] = { score: v.score, reason: String(v.reason ?? "") };
    }
    return out;
  } catch {
    return {};
  }
}

/** Why a judge call produced nothing. Surfaced in dry runs so a silent no-op is visible. */
export const judgeDiagnostics = {
  calls: 0, ok: 0, noKey: 0, noNotes: 0, httpError: "" as string, parseEmpty: 0, threw: "" as string,
  /** First unparseable reply, so a parse failure can be diagnosed not guessed. */
  sampleBadReply: "" as string,
};

/** Returns {} on any failure. An outage must defer the items, never zero them. */
export async function judgeNotes(notes: string, items: string[]): Promise<Record<string, Verdict>> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) { judgeDiagnostics.noKey++; return {}; }
  if (items.length === 0) return {};
  if (notes.trim() === "") { judgeDiagnostics.noNotes++; return {}; }
  judgeDiagnostics.calls++;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildJudgePrompt(notes, items) }],
        output_config: {
          format: { type: "json_schema", schema: buildJudgeSchema(items) },
        },
      }),
    });
    if (!res.ok) {
      if (!judgeDiagnostics.httpError) {
        judgeDiagnostics.httpError = `${res.status}: ${(await res.text()).slice(0, 200)}`;
      }
      return {};
    }
    const json = await res.json();
    // Output is schema-constrained, so the text block is the JSON object.
    // Still parsed defensively: a max_tokens cut-off can truncate it.
    const raw = json.content?.find((b: { type?: string }) => b.type === "text")?.text ?? "";
    const out = parseJudgeResponse(raw, items);
    if (Object.keys(out).length === 0) {
      judgeDiagnostics.parseEmpty++;
      if (!judgeDiagnostics.sampleBadReply) {
        judgeDiagnostics.sampleBadReply = `stop=${json.stop_reason} :: ${raw.slice(0, 300)}`;
      }
    } else judgeDiagnostics.ok++;
    return out;
  } catch (e) {
    if (!judgeDiagnostics.threw) judgeDiagnostics.threw = String(e).slice(0, 200);
    return {};
  }
}
