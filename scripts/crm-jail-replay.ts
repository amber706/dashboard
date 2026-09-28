// CRM Jail replay harness — the Phase 1 acceptance gate.
//
// Scores the EXACT records Aaron and Megan sampled by hand for 8/31-9/4, and
// diffs the bot item by item against what they wrote.
//
// Why the exact records: the manual samples were not seeded, so scoring a
// different draw would measure sampling noise rather than rule agreement.
//
// Every other check in this project verifies the bot against my reading of the
// scorecards. This is the only one that verifies it against a human auditor's
// judgement — the class of error the unit tests are structurally blind to,
// because the same misreading produced both the rule and its test.
//
// Usage:
//   deno run --allow-net --allow-read --allow-env --allow-write \
//     scripts/crm-jail-replay.ts <path-to-service-account.json>

import { mintGoogleToken } from "../supabase/functions/crm-jail/google-auth.ts";
import adminMap from "../supabase/functions/crm-jail/template-map.admissions.json" with { type: "json" };
import bdMap from "../supabase/functions/crm-jail/template-map.bd.json" with { type: "json" };

const FN = "https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail";
const WINDOW = { startISO: "2026-08-31", endISO: "2026-09-04" };

interface Manual { rep: string; team: "admissions" | "bd"; sheet: string }

const MANUAL: Manual[] = [
  { rep: "Sabrina Johnson", team: "admissions", sheet: "1NDCgAmZ-KDXiYJ87oCs37S1ulytvQRisd2IsuI1URxg" },
  { rep: "Eric Wade",       team: "admissions", sheet: "1hlno-mbcl-xuk-T00PIlXXr65OSXqgw2unTJ2lr7hCo" },
  { rep: "Michael Mendez",  team: "admissions", sheet: "1GzMw_tJvSxVYKv2RYy_HTiGy8a-wkIZwWKwn3ww9bAM" },
  { rep: "Taylor Bertchie", team: "admissions", sheet: "1nQDND0LE90VjWzeuBoaVQ0JqhfcHGEVbv7wdG_WIskM" },
  { rep: "Kenny Reitz",     team: "bd",         sheet: "16gBNt4LANkFnWxYSKM0AtbIkPFLoAo0t6dkr9EG3dw8" },
];

const SECTIONS: Record<string, string[]> = {
  admissions: ["Leads", "Contacts", "Deals"],
  bd: ["BusinessContacts", "Calls", "Companies", "Meetings"],
};
const COLS = ["E", "F", "G", "H", "I"];

type Cell = "1" | "0" | "N/A" | "";

function mapFor(team: string) {
  return (team === "admissions" ? adminMap : bdMap) as unknown as {
    sheetName: string;
    identity: { link: number[] };
    items: Record<string, { row: number; label?: string }>;
  };
}

/** Item ids belonging to a section, in template order. */
function sectionItems(team: string, section: string): string[] {
  const m = mapFor(team);
  const prefix: Record<string, string> = {
    Leads: "L", Contacts: "C", Deals: "D",
    BusinessContacts: "BC", Calls: "CA", Companies: "CO", Meetings: "M",
  };
  const p = prefix[section];
  return Object.keys(m.items)
    .filter((k) => new RegExp(`^${p}\\d+$`).test(k))
    .sort((a, b) => Number(a.slice(p.length)) - Number(b.slice(p.length)));
}

async function sheetValues(token: string, id: string, ranges: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // batchGet caps out; chunk generously.
  for (let i = 0; i < ranges.length; i += 100) {
    const chunk = ranges.slice(i, i + 100);
    const q = chunk.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`sheet read failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const vrs = (await res.json()).valueRanges ?? [];
    vrs.forEach((vr: { values?: string[][] }, j: number) => {
      out[chunk[j]] = String(vr.values?.[0]?.[0] ?? "").trim();
    });
  }
  return out;
}

/** Reads a completed manual scorecard: which records were sampled, and how each item was scored. */
async function readManual(token: string, m: Manual) {
  const map = mapFor(m.team);
  const tab = map.sheetName;
  const ranges: string[] = [];
  const linkCells: Record<string, string[]> = {};

  SECTIONS[m.team].forEach((section, si) => {
    const linkRow = map.identity.link[si];
    linkCells[section] = COLS.map((c) => `'${tab}'!${c}${linkRow}`);
    ranges.push(...linkCells[section]);
    for (const item of sectionItems(m.team, section)) {
      for (const c of COLS) ranges.push(`'${tab}'!${c}${map.items[item].row}`);
    }
  });

  const vals = await sheetValues(token, m.sheet, ranges);

  const records: Record<string, string[]> = {};
  const recordCols: Record<string, Array<{ id: string; col: number }>> = {};
  const scores: Record<string, Record<string, Cell>> = {}; // section -> `${item}#${idx}` -> cell

  for (const section of SECTIONS[m.team]) {
    const ids: string[] = [];
    linkCells[section].forEach((cell) => {
      const url = vals[cell] ?? "";
      const mm = url.match(/\/tab\/[A-Za-z]+\/(\d+)/);
      ids.push(mm ? mm[1] : "");
    });
    // Blank link cells are sections the auditor did not fill. Passing "" into
    // `where id in (...)` makes Zoho reject the whole query as a bad bigint,
    // which cost two of five reps on the first run.
    records[section] = ids.filter((x) => x !== "");
    recordCols[section] = ids.map((id, col) => ({ id, col }));
    scores[section] = {};
    for (const item of sectionItems(m.team, section)) {
      COLS.forEach((c, idx) => {
        const raw = vals[`'${tab}'!${c}${map.items[item].row}`] ?? "";
        scores[section][`${item}#${idx}`] = (raw === "1" || raw === "0" || raw === "N/A" ? raw : "") as Cell;
      });
    }
  }
  return { records, recordCols, scores };
}

function norm(v: unknown): Cell {
  if (v === 1 || v === "1") return "1";
  if (v === 0 || v === "0") return "0";
  if (v === "N/A") return "N/A";
  return ""; // DEFER or absent — the bot is not claiming a verdict
}

async function main() {
  const keyPath = Deno.args[0];
  if (!keyPath) { console.error("usage: crm-jail-replay.ts <service-account.json>"); Deno.exit(1); }
  const sa = JSON.parse(await Deno.readTextFile(keyPath));
  const gToken = await mintGoogleToken(sa.client_email, sa.private_key);
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!svc) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); Deno.exit(1); }

  const lines: string[] = [
    "# CRM Jail — replay against the manual audits",
    "",
    `Window **${WINDOW.startISO} to ${WINDOW.endISO}**, scoring the exact records each auditor sampled.`,
    "",
    "`agree` = same verdict. `bot stricter` = auditor passed it, bot failed it.",
    "`bot softer` = auditor failed it, bot passed it. `no verdict` = bot deferred (Phase 2 or judge unavailable).",
    "",
  ];

  const totals = { agree: 0, stricter: 0, softer: 0, none: 0, manualBlank: 0 };
  const byItem: Record<string, { stricter: number; softer: number; agree: number }> = {};

  for (const m of MANUAL) {
    const manual = await readManual(gToken, m);
    const sampled = Object.values(manual.records).flat().filter(Boolean).length;
    if (sampled === 0) { lines.push(`## ${m.rep}\n\nNo sampled record links found — skipped.\n`); continue; }

    const res = await fetch(FN, {
      method: "POST",
      headers: { Authorization: `Bearer ${svc}`, "content-type": "application/json" },
      body: JSON.stringify({
        replay: { team: m.team, records: manual.records },
        run_at: `${WINDOW.endISO}T12:00:00Z`,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.scored) {
      lines.push(`## ${m.rep}\n\n**replay failed:** ${body.detail ?? body.error ?? res.status}\n`);
      continue;
    }

    let a = 0, st = 0, so = 0, nv = 0;
    const rows: string[] = [];
    for (const [section, recs] of Object.entries(body.scored as Record<string, Array<{ id: string; items: Array<{ item: string; score: unknown; explanation?: string }> }>>)) {
      // Index against the auditor's original column, not the filtered array,
      // or every score after a blank compares against the wrong record.
      const originalIdx = (manual.recordCols[section] ?? []).filter((c) => c.id !== "");
      recs.forEach((rec, i) => {
        const idx = originalIdx[i]?.col ?? i;
        for (const r of rec.items) {
          const man = manual.scores[section]?.[`${r.item}#${idx}`] ?? "";
          if (man === "") { totals.manualBlank++; continue; } // auditor left it blank
          const bot = norm(r.score);
          byItem[r.item] ??= { stricter: 0, softer: 0, agree: 0 };
          if (bot === "") { nv++; continue; }
          if (bot === man) { a++; byItem[r.item].agree++; continue; }
          const manPass = man === "1" || man === "N/A";
          const botPass = bot === "1" || bot === "N/A";
          if (manPass && !botPass) {
            st++; byItem[r.item].stricter++;
            rows.push(`| ${r.item} | ${section} #${idx + 1} | ${man} | ${bot} | bot stricter | ${(r.explanation ?? "").slice(0, 80)} |`);
          } else if (!manPass && botPass) {
            so++; byItem[r.item].softer++;
            rows.push(`| ${r.item} | ${section} #${idx + 1} | ${man} | ${bot} | bot softer | ${(r.explanation ?? "").slice(0, 80)} |`);
          } else { a++; byItem[r.item].agree++; }
        }
      });
    }
    totals.agree += a; totals.stricter += st; totals.softer += so; totals.none += nv;
    const scored = a + st + so;
    const pct = scored ? ((a / scored) * 100).toFixed(1) : "—";

    lines.push(`## ${m.rep} (${m.team})`, "");
    lines.push(`${sampled} records · **${pct}% agreement** on ${scored} compared items · ${st} bot-stricter · ${so} bot-softer · ${nv} no verdict`, "");
    if (rows.length) {
      lines.push("| Item | Where | Auditor | Bot | Direction | Bot's note |", "|---|---|---|---|---|---|", ...rows, "");
    }
  }

  const scored = totals.agree + totals.stricter + totals.softer;
  lines.splice(6, 0,
    `**Overall: ${scored ? ((totals.agree / scored) * 100).toFixed(1) : "—"}% agreement** across ${scored} compared items — ` +
    `${totals.stricter} bot-stricter, ${totals.softer} bot-softer, ${totals.none} no verdict, ` +
    `${totals.manualBlank} left blank by the auditor.`, "");

  const worst = Object.entries(byItem)
    .map(([item, v]) => [item, v.stricter + v.softer, v.stricter, v.softer] as const)
    .filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]).slice(0, 15);
  if (worst.length) {
    lines.push("## Items that disagree most", "",
      "A rule that disagrees on many records is likelier to be wrong than the auditors.", "",
      "| Item | Criterion | Disagreements | Stricter | Softer |", "|---|---|---|---|---|");
    for (const [item, d, st, so] of worst) {
      const label = (adminMap as any).items[item]?.label ?? (bdMap as any).items[item]?.label ?? "";
      lines.push(`| ${item} | ${String(label).slice(0, 60)} | ${d} | ${st} | ${so} |`);
    }
  }

  const out = lines.join("\n") + "\n";
  await Deno.writeTextFile("docs/CRM_JAIL_REPLAY_RESULTS.md", out);
  console.log(out);
}

if (import.meta.main) await main();
