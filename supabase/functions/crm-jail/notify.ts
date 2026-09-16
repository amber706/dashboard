// Notifies Aaron and Megan that the week's scorecards are ready.
//
// No mail vendor and no DNS setup: the bot shares each scorecard with its
// auditor and lets Google send the notification. They need access to the sheet
// to review it anyway, so the share is not extra — it IS the notification.
//
// This also keeps PHI inside Google's boundary. Nothing about a client, and
// nothing about a rep, transits a third party.

export interface RepResult {
  rep: string;
  team?: string;
  score?: string;
  status: string;
  jail?: boolean;
  sheetId?: string;
  sheetUrl?: string;
  deferredCells?: number;
  auditorEmail?: string;
  error?: string;
  /** Diagnostic only — never shown to an auditor. */
  timings?: unknown;
}

export interface AuditWindowLabel {
  startISO: string;
  endISO: string;
  label: string;
}

/**
 * The note Google puts in the share email. Deliberately carries no client
 * data — just which rep, which window, and what the auditor still has to do.
 */
export function buildShareMessage(rep: string, w: AuditWindowLabel, deferredCells: number): string {
  const todo = deferredCells === 0
    ? "Every line the bot can check is scored."
    : deferredCells === 1
    ? "1 cell still needs you — it is highlighted and left blank."
    : `${deferredCells} cells still need you — they are highlighted and left blank.`;
  return `CRM Jail audit for ${rep}, ${w.label}.\n\n${todo}\n\n` +
    `The score is not final until you have reviewed it. Nothing has been sent to ${rep}.`;
}

/** Summary sheet rows. Employee-level facts only — no client names, no record ids. */
export function buildSummaryRows(w: AuditWindowLabel, results: RepResult[]): string[][] {
  const header = ["Rep", "Team", "Score", "Status", "Jail", "Cells needing you", "Scorecard"];
  const body = results.map((r) => [
    r.rep,
    r.team ?? "",
    r.score ?? "—",
    r.status,
    r.jail ? "Yes" : "No",
    String(r.deferredCells ?? 0),
    r.sheetUrl ?? r.error ?? "",
  ]);
  return [
    [`CRM Jail audits — ${w.label}`],
    [`Generated ${new Date().toISOString().slice(0, 10)}. Scores are not final until reviewed.`],
    [],
    header,
    ...body,
  ];
}

/** Shares a file and asks Google to email the recipient. */
export async function shareAndNotify(
  token: string,
  fileId: string,
  email: string,
  message: string,
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions` +
    `?sendNotificationEmail=true&emailMessage=${encodeURIComponent(message)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "writer", type: "user", emailAddress: email }),
  });
  // A failed share must not fail the run — the scorecard still exists and is
  // recorded in crm_jail_runs. It is surfaced, not swallowed silently.
  if (!res.ok) {
    throw new Error(`Share to ${email} failed: ${res.status} ${await res.text()}`);
  }
}

export interface NotifyDeps {
  createSummarySheet: (title: string, rows: string[][]) => Promise<{ id: string; url: string }>;
  share: (fileId: string, email: string, message: string) => Promise<void>;
}

const SUMMARY_RECIPIENTS = [
  "aaron@cornerstonehealingcenter.com",
  "megan@cornerstonehealingcenter.com",
];

/**
 * Shares each scorecard with the rep's own auditor, then builds one summary
 * sheet and shares that with both. Share failures are collected and returned
 * rather than thrown — one bad address must not hide the other eight results.
 */
export async function notifyAuditors(
  w: AuditWindowLabel,
  results: RepResult[],
  deps: NotifyDeps,
): Promise<{ summaryUrl: string | null; failures: string[] }> {
  const failures: string[] = [];

  for (const r of results) {
    if (!r.sheetId || !r.auditorEmail) continue;
    try {
      await deps.share(
        r.sheetId,
        r.auditorEmail,
        buildShareMessage(r.rep, w, r.deferredCells ?? 0),
      );
    } catch (e) {
      failures.push(`${r.rep}: ${String(e)}`);
    }
  }

  let summaryUrl: string | null = null;
  try {
    const summary = await deps.createSummarySheet(
      `CRM Jail Summary ${w.label}`,
      buildSummaryRows(w, results),
    );
    summaryUrl = summary.url;
    for (const to of SUMMARY_RECIPIENTS) {
      try {
        await deps.share(
          summary.id,
          to,
          `CRM Jail audits for ${w.label} are ready for review. ` +
            `${results.length} rep${results.length === 1 ? "" : "s"} audited. ` +
            `Nothing has been sent to any rep.`,
        );
      } catch (e) {
        failures.push(`summary -> ${to}: ${String(e)}`);
      }
    }
  } catch (e) {
    failures.push(`summary sheet: ${String(e)}`);
  }

  return { summaryUrl, failures };
}
