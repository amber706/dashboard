// The 16:30 BD stage-compliance report: what Aaron reads, and the one-line
// summary that arrives as the share email. Pure, so it is tested without Zoho.

import { zohoUrl } from "./rules/helpers.ts";
import type { StageVerdict } from "./stage.ts";

export interface StageReportRep {
  rep: string;
  owned: number;
  checked: Array<{ account: Record<string, unknown>; verdict: StageVerdict | null }>;
}

function tally(r: StageReportRep) {
  const scored = r.checked.filter((c) => c.verdict !== null);
  const wrong = scored.filter((c) => !c.verdict!.correct);
  const pct = scored.length === 0 ? null : (scored.length - wrong.length) / scored.length;
  return { scored: scored.length, wrong, pct };
}

const pctText = (p: number | null) => (p === null ? "—" : `${(p * 100).toFixed(1)}%`);

export function buildStageReportRows(dateISO: string, reps: StageReportRep[]): string[][] {
  const rows: string[][] = [
    [`BD company stage compliance — ${dateISO}`],
    ["Checked against the Zoho Company Staging Rules. Every Company must be in the right stage by 5:00 PM."],
    ["Referrals and admits come from Deals (Referring Company); Archive and Delete are not checked."],
    [],
    ["Rep", "Companies owned", "Checked", "Correct stage", "Wrong stage", "Compliance"],
  ];
  let all = 0, allWrong = 0;
  for (const r of reps) {
    const t = tally(r);
    all += t.scored;
    allWrong += t.wrong.length;
    rows.push([r.rep, String(r.owned), String(t.scored), String(t.scored - t.wrong.length), String(t.wrong.length), pctText(t.pct)]);
  }
  rows.push(["BD team", "", String(all), String(all - allWrong), String(allWrong), pctText(all === 0 ? null : (all - allWrong) / all)]);
  rows.push([], ["Companies in the wrong stage"], ["Rep", "Company", "Current stage", "Should be", "Why", "Open in Zoho"]);
  for (const r of reps) {
    for (const c of tally(r).wrong) {
      rows.push([
        r.rep,
        String(c.account.Account_Name ?? ""),
        c.verdict!.current,
        c.verdict!.expected,
        c.verdict!.reason,
        zohoUrl("Accounts", String(c.account.id)),
      ]);
    }
  }
  if (allWrong === 0) rows.push(["Every checked company is in the correct stage."]);
  return rows;
}

/** The email body: one line per rep, worst first. */
export function stageReportSummary(dateISO: string, reps: StageReportRep[]): string {
  const lines = reps
    .map((r) => ({ r, t: tally(r) }))
    .sort((a, b) => (a.t.pct ?? 1) - (b.t.pct ?? 1))
    .map(({ r, t }) => `${r.rep}: ${pctText(t.pct)} (${t.wrong.length} of ${t.scored} in the wrong stage)`);
  return [`BD company stage compliance for ${dateISO}, before the 5:00 PM deadline.`, "", ...lines].join("\n");
}
