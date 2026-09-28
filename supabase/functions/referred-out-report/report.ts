// Pure shaping for the daily Referred Out - Coming Back report. No I/O here,
// so the grouping and the email text are testable without Zoho or Google.

export interface ComingBackDeal {
  id: string;
  client: string;
  facility: string | null;
  referOutDate: string | null; // YYYY-MM-DD
  referOutType: string | null;
  pipeline: string | null;
  bdRep: string | null;
  owner: string | null;
  admittedAtFacility: string | null;
}

/** Raw COQL row → deal. Lookup subfields arrive as dotted keys. */
export function toDeal(r: Record<string, unknown>): ComingBackDeal {
  const s = (k: string) => {
    const v = r[k];
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  const owner = [s("Owner.first_name"), s("Owner.last_name")].filter(Boolean).join(" ");
  return {
    id: String(r.id),
    client: s("Deal_Name") ?? "(no name)",
    facility: s("Referred_Out.Account_Name"),
    referOutDate: s("Refer_Out_Date"),
    referOutType: s("Refer_Out_Type"),
    pipeline: s("Pipeline"),
    bdRep: s("Outbound_Referral_BD_Rep"),
    owner: owner || null,
    admittedAtFacility: s("Admitted_at_Referred_Facility"),
  };
}

// A deal parked in the stage without a facility is itself something to fix,
// so it gets its own group instead of disappearing.
export const NO_FACILITY = "(No facility set)";

export interface FacilityGroup {
  facility: string;
  deals: ComingBackDeal[];
}

/** Largest group first; newest refer-out first within a group. */
export function groupByFacility(deals: ComingBackDeal[]): FacilityGroup[] {
  const map = new Map<string, ComingBackDeal[]>();
  for (const d of deals) {
    const k = d.facility ?? NO_FACILITY;
    map.set(k, [...(map.get(k) ?? []), d]);
  }
  const groups = [...map.entries()].map(([facility, ds]) => ({
    facility,
    deals: ds.sort((a, b) => (b.referOutDate ?? "").localeCompare(a.referOutDate ?? "")),
  }));
  return groups.sort((a, b) =>
    b.deals.length - a.deals.length || a.facility.localeCompare(b.facility)
  );
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}

/**
 * "New" means referred out yesterday or today. The report goes out in the
 * morning, so yesterday's refer-outs are the ones nobody has seen yet.
 */
export function isNew(d: ComingBackDeal, todayISO: string): boolean {
  return d.referOutDate !== null && daysBetween(d.referOutDate, todayISO) <= 1;
}

export function dayLabel(dateISO: string): string {
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

const zohoUrl = (id: string) => `https://crm.zoho.com/crm/cornerstone/tab/Potentials/${id}`;

export const DETAIL_HEADER = [
  "Facility", "Client", "New", "Refer Out Date", "Days Out", "Refer Out Type",
  "Pipeline", "BD Rep", "Deal Owner", "Admitted at Facility", "Zoho",
];

/**
 * Summary by facility on top, then one flat detail table. Facility repeats on
 * every detail row rather than appearing once per group: blank cells would
 * break the filter and sort that people reach for first in a sheet.
 */
export function buildRows(todayISO: string, groups: FacilityGroup[]): string[][] {
  const total = groups.reduce((n, g) => n + g.deals.length, 0);
  const newCount = groups.reduce((n, g) => n + g.deals.filter((d) => isNew(d, todayISO)).length, 0);
  const rows: string[][] = [
    [`Referred Out - Coming Back — ${dayLabel(todayISO)}`],
    [`${total} active · ${newCount} new since yesterday · live from Zoho at send time`],
    [],
    ["Facility", "Clients", "New"],
    ...groups.map((g) => [
      g.facility,
      String(g.deals.length),
      String(g.deals.filter((d) => isNew(d, todayISO)).length || ""),
    ]),
    [],
    DETAIL_HEADER,
  ];
  for (const g of groups) {
    for (const d of g.deals) {
      rows.push([
        g.facility,
        d.client,
        isNew(d, todayISO) ? "NEW" : "",
        d.referOutDate ?? "",
        d.referOutDate ? String(daysBetween(d.referOutDate, todayISO)) : "",
        d.referOutType ?? "",
        d.pipeline ?? "",
        d.bdRep ?? "",
        d.owner ?? "",
        d.admittedAtFacility ?? "",
        zohoUrl(d.id),
      ]);
    }
  }
  return rows;
}

// Drive truncates a long emailMessage, so the email carries the facility
// counts and the new names only. The full list lives in the sheet.
const MAX_NEW_IN_EMAIL = 15;

export function buildMessage(todayISO: string, groups: FacilityGroup[]): string {
  const total = groups.reduce((n, g) => n + g.deals.length, 0);
  const fresh = groups.flatMap((g) =>
    g.deals.filter((d) => isNew(d, todayISO)).map((d) => `• ${d.client} → ${g.facility}`)
  );
  const lines = [
    `Referred Out - Coming Back, ${dayLabel(todayISO)}: ${total} active.`,
    "",
    fresh.length === 0
      ? "No new refer-outs since yesterday."
      : `New since yesterday (${fresh.length}):`,
    ...fresh.slice(0, MAX_NEW_IN_EMAIL),
    ...(fresh.length > MAX_NEW_IN_EMAIL ? [`…and ${fresh.length - MAX_NEW_IN_EMAIL} more in the sheet.`] : []),
    "",
    "By facility:",
    ...groups.map((g) => `• ${g.facility}: ${g.deals.length}`),
  ];
  return lines.join("\n");
}
