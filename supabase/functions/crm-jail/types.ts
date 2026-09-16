// Shared types for the CRM Jail audit bot.

/** What lands in a scoring cell. DEFER leaves the cell blank and flagged for the auditor. */
export type Score = 1 | 0 | "N/A" | "DEFER";

export interface ItemResult {
  /** Template item id, verbatim: "L3", "BC4", "CO18". */
  item: string;
  score: Score;
  /** Written to the Explanation column when the score is 0 or DEFER. */
  explanation?: string;
}

export interface ZohoRecord {
  id: string;
  [field: string]: unknown;
}

export interface ZohoNote {
  Note_Title?: string;
  Note_Content?: string;
  Created_Time?: string;
}

export interface RelatedMeeting {
  id: string;
  Start_DateTime?: string;
}

export interface RecordContext {
  /** The record being scored. */
  record: ZohoRecord;
  /** Notes attached to the record, newest first. */
  notes: ZohoNote[];
  /** Attachment filenames on the record. Deals only. */
  attachments: string[];
  /** Related meetings, for BC9/BC10. Business contacts only. */
  relatedMeetings: RelatedMeeting[];
  /** Raw Stage -> normalized category, from reporting.stage_mapping. */
  stageCategory: (raw: unknown) => string | null;
  /** Raw Source Category -> normalized, from reporting.source_category_mapping. */
  sourceCategory: (raw: unknown) => string | null;
  /** Audit window, for same-day and in-window checks. */
  window: { startISO: string; endISO: string };
  /** Verdicts from the notes judge, keyed by item id. Empty when judging is off. */
  notesJudgments: Record<string, { score: 1 | 0; reason: string }>;
}

export type Rule = (ctx: RecordContext) => Score | ItemResult;

export interface SampledRecord {
  record: ZohoRecord;
  /** Display name for the identity row. */
  name: string;
  /** Zoho deep link for the identity row. */
  url: string;
  /** Created_Time, formatted as the templates format it. */
  createdDisplay: string;
}
