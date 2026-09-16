// Copies a team template and writes ONLY the auditor-input cells.
//
// The template's own formulas produce section scores, the overall score, the
// compliance status and the jail decision. The bot never computes a
// percentage, so its output stays directly comparable to the manual baseline
// Aaron and Megan have been producing by hand.
//
// Cell rows come from template-map.*.json, generated from the live templates.
// Never hand-edit those maps — regenerate them if a template changes.

import adminMap from "./template-map.admissions.json" with { type: "json" };
import bdMap from "./template-map.bd.json" with { type: "json" };

export type Team = "admissions" | "bd";

interface TemplateMap {
  recordColumns: string[];
  explanationColumn: string;
  header: Record<string, string>;
  identity: { name: number[]; link: number[]; date: number[] };
  items: Record<string, { row: number }>;
  computedCells: string[];
}

const MAPS: Record<Team, TemplateMap> = {
  admissions: adminMap as TemplateMap,
  bd: bdMap as TemplateMap,
};

export const TEMPLATE_ID: Record<Team, string> = {
  admissions: "1V9YS4ML9X5UPOWGf-mTNIJYQmGliC8LhwqVKBPZkbds",
  bd: "1c5N_EUgwNoKyhJDBIWp-nrJiCh4QNPG3V5OM17gvDVo",
};

/** Section order must match the identity-row order in the template. */
export const SECTION_ORDER: Record<Team, string[]> = {
  admissions: ["Leads", "Contacts", "Deals"],
  bd: ["BusinessContacts", "Calls", "Companies", "Meetings"],
};

export function cellFor(team: Team, item: string, recordIndex: number): string {
  const row = MAPS[team].items[item]?.row;
  if (!row) throw new Error(`No template row for item ${item} on ${team}`);
  const col = MAPS[team].recordColumns[recordIndex];
  if (!col) throw new Error(`Record index ${recordIndex} out of range for ${team}`);
  return `${col}${row}`;
}

/** Section A items are scored once per cycle and live in the first record column. */
export function dailyCellFor(team: Team, item: string): string {
  return cellFor(team, item, 0);
}

export function explanationCellFor(team: Team, item: string): string {
  const row = MAPS[team].items[item]?.row;
  if (!row) throw new Error(`No template row for item ${item} on ${team}`);
  return `${MAPS[team].explanationColumn}${row}`;
}

/** The three identity cells (name, link, created) for one sampled record. */
export function identityCellsFor(
  team: Team,
  section: string,
  recordIndex: number,
): { name: string; link: string; date: string } {
  const idx = SECTION_ORDER[team].indexOf(section);
  if (idx < 0) throw new Error(`Unknown section ${section} for ${team}`);
  const map = MAPS[team];
  const col = map.recordColumns[recordIndex];
  if (!col) throw new Error(`Record index ${recordIndex} out of range`);
  return {
    name: `${col}${map.identity.name[idx]}`,
    link: `${col}${map.identity.link[idx]}`,
    date: `${col}${map.identity.date[idx]}`,
  };
}

export function headerCell(team: Team, key: string): string {
  const cell = MAPS[team].header[key];
  if (!cell) throw new Error(`No header cell for ${key} on ${team}`);
  return cell;
}

export function isComputedCell(team: Team, a1: string): boolean {
  return MAPS[team].computedCells.includes(a1);
}

function initials(fullName: string): string {
  return fullName.split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase()).join("");
}

/** Matches the naming already in use on both teams' existing scorecards. */
export function scorecardTitle(team: Team, fullName: string, windowLabel: string): string {
  return team === "admissions"
    ? `${initials(fullName)}: CRM Audit ${windowLabel}`
    : `BD CRM Jail Audit: ${fullName} ${windowLabel}`;
}

export interface CellWrite {
  a1: string;
  value: string | number;
}

export async function copyTemplate(
  token: string,
  team: Team,
  title: string,
  parentFolderId: string,
): Promise<{ id: string; url: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${TEMPLATE_ID[team]}/copy?supportsAllDrives=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: title, parents: [parentFolderId] }),
    },
  );
  if (!res.ok) throw new Error(`Drive copy failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { id: json.id, url: `https://docs.google.com/spreadsheets/d/${json.id}/edit` };
}

export async function writeCells(
  token: string,
  team: Team,
  sheetId: string,
  writes: CellWrite[],
): Promise<void> {
  // Hard failure, not a warning. Overwriting a formula silently breaks the
  // score for a rep whose discipline record depends on it.
  const offenders = writes.filter((w) => isComputedCell(team, w.a1));
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to overwrite computed cells: ${offenders.map((o) => o.a1).join(", ")}`,
    );
  }
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: writes.map((w) => ({ range: w.a1, values: [[w.value]] })),
      }),
    },
  );
  if (!res.ok) throw new Error(`Sheets batchUpdate failed: ${res.status} ${await res.text()}`);
}

/** Creates the per-rep folder under the team folder if it does not already exist. */
export async function ensureRepFolder(
  token: string,
  teamFolderId: string,
  repName: string,
): Promise<string> {
  const q = encodeURIComponent(
    `'${teamFolderId}' in parents and name = '${repName.replace(/'/g, "\\'")}' ` +
      `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!found.ok) throw new Error(`Drive lookup failed: ${found.status} ${await found.text()}`);
  const existing = (await found.json()).files ?? [];
  if (existing.length > 0) return existing[0].id;

  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: repName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [teamFolderId],
    }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}
