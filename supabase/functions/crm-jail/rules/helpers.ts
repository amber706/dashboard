// Shared predicates for the CRM Jail rule engine.
//
// Every one is pure, so the whole scoring surface is unit-testable without
// touching Zoho.

import type { ZohoNote } from "../types.ts";

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Zoho returns null, "", and [] for empty. A real 0 or false is a value. */
export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Proper case per template items L2 / C2 / D2 / BC2 / CO3: every alphabetic
 * word starts uppercase and is not wholly uppercase. Intra-word capitals are
 * allowed so "McGarry" and "O'Brien" pass.
 */
export function isProperCase(v: unknown): boolean {
  if (typeof v !== "string" || v.trim() === "") return false;
  const words = v.trim().split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length === 0) return false;
  return words.every((w) => {
    const letters = w.replace(/[^a-zA-Z]/g, "");
    if (letters.length === 0) return true;
    if (letters[0] !== letters[0].toUpperCase()) return false;
    if (letters.length > 1 && letters === letters.toUpperCase()) return false;
    return true;
  });
}

function phoenixDay(iso: string): string {
  return new Date(new Date(iso).getTime() - PHOENIX_OFFSET_MS).toISOString().slice(0, 10);
}

/** Same Phoenix calendar day. Used by L28, C13, D25, CA1, M1 and the daily items. */
export function loggedSameDay(occurredISO: string, loggedISO: string): boolean {
  if (!occurredISO || !loggedISO) return false;
  return phoenixDay(occurredISO) === phoenixDay(loggedISO);
}

/**
 * Was this call or meeting logged on the day it happened?
 *
 * Created_Time alone is the wrong test for anything booked ahead. Ben Coulter
 * booked "Lunch with Horizon integrated" on 9/22 for 10/1 11:00-12:00, then on
 * 10/1 updated the meeting at 1:51pm and wrote the meeting note at 1:59pm.
 * That is same-day logging, and comparing Start to Created_Time failed it —
 * as it failed every meeting or call booked in advance.
 *
 * The day it happened is the From day or the To day. The record was logged
 * that day if, on either of them, it was created, edited by its owner (a
 * machine re-stamp must not count — see buildWindowQuery), or had a note
 * written on it.
 */
export function loggedOnActivityDay(
  record: Record<string, unknown>,
  occurredFields: string[],
  notes: ZohoNote[] = [],
): boolean {
  const days = new Set(
    occurredFields.map((f) => String(record[f] ?? "")).filter(Boolean).map(phoenixDay),
  );
  if (days.size === 0) return false;
  const ownerId = (record.Owner as { id?: string } | null)?.id;
  const editorId = (record.Modified_By as { id?: string } | null)?.id;
  const evidence = [
    String(record.Created_Time ?? ""),
    ownerId && editorId === ownerId ? String(record.Modified_Time ?? "") : "",
    ...notes.map((n) => String(n.Created_Time ?? "")),
  ];
  return evidence.some((t) => t !== "" && days.has(phoenixDay(t)));
}

/** Inclusive of both ends, in Phoenix calendar days. */
export function inWindow(iso: string, w: { startISO: string; endISO: string }): boolean {
  if (!iso) return false;
  const d = phoenixDay(iso);
  return d >= w.startISO && d <= w.endISO;
}

export function noteText(notes: ZohoNote[]): string {
  return notes
    .map((n) => [n.Note_Title, n.Note_Content].filter(Boolean).join(" — "))
    .join("\n")
    .trim();
}

export function zohoUrl(module: string, id: string): string {
  return `https://crm.zoho.com/crm/cornerstone/tab/${module}/${id}`;
}

/** Zoho lookup fields arrive as { id, name }. A bare string is not a link. */
export function lookupPresent(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v) && "id" in (v as object);
}

/** Formats Created_Time the way the templates display it: "Fri, Sep 4, 2026, 10:27 AM". */
export function createdDisplay(iso: string): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() - PHOENIX_OFFSET_MS).toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
