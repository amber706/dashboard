// Shared types for the CRM Jail audit bot.

/** What lands in a scoring cell. DEFER leaves the cell blank and flagged for the auditor. */
export type Score = 1 | 0 | "N/A" | "DEFER";

export interface ItemResult {
  /** Template item id, verbatim: "L3", "BC4", "CO18". */
  item: string;
  score: Score;
  /** Written to the Explanation column when the score is 0 or DEFER. */
  explanation?: string;
  /**
   * Why a 0 happened, for helpers that know the shape of the failure but not
   * the item's template wording. Resolved into a sentence in buildWrites,
   * which is the only place that has both the item id and the label.
   */
  reasonKind?: "blank" | "notLinked";
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
  /**
   * True when the record's Description has been folded into `notes`. Meetings
   * only: reps used to write the agenda and next steps in the Event's
   * Description and have since moved to the Notes section, so both count. Only
   * used to word the explanation accurately when there is neither.
   */
  notesIncludeDescription?: boolean;
  /**
   * True when the notes fetch ERRORED, as opposed to the record genuinely
   * having none. The difference decides whether a language item scores 0 or
   * defers — a broken fetch must never be read as "the rep wrote no note".
   */
  notesUnavailable?: boolean;
  /** Attachment filenames on the record. Deals only. */
  attachments: string[];
  /** Related meetings, for BC9/BC10. Business contacts only. */
  relatedMeetings: RelatedMeeting[];
  /**
   * Related records that Zoho exposes as related LISTS rather than fields.
   * Several scorecard items read as field checks but are not:
   *   C8  "attached to the associated Deal" — Contacts has no Deal lookup
   *   CA9 / M9 "next call or meeting is scheduled" — no next-activity field
   *   C11 "Contact Owner is the BD Rep who owns the associated company"
   */
  relatedDealCount: number;
  /** Calls or Events linked to this record with a start time in the future. */
  futureActivityCount: number;
  /** Owner id of the Account this record links to, when there is one. */
  accountOwnerId: string | null;
  /** Module that a polymorphic What_Id points at, e.g. "Accounts" or "Deals". */
  whatIdModule: string | null;
  /**
   * Contact_Type of the contact this activity is linked to, e.g. "Business
   * Contact", "Lead", "Family/Friend". Null when there is no linked contact or
   * the lookup could not be resolved. CA6 turns on it: only a business contact
   * is expected to have a company behind them.
   */
  whoContactType: string | null;
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
