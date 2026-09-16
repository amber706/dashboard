// Pure matching helpers for backfill-gclid-to-zoho. No network / Deno APIs -> unit-testable.

export type PPCBundle = {
  gclid: string;
  call_id: string;
  phone_e164: string;
  received_at: string;
  keyword: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
};

export type CtmCallRow = {
  call_id: string;
  caller_number: string | null;
  received_at: string;
  raw_payload: any;
};

export type CtmIndexes = { byPhone: Map<string, PPCBundle>; byEmail: Map<string, PPCBundle> };

export function last10(phone: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export function emptyToNull(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function upsertFreshest(map: Map<string, PPCBundle>, key: string, b: PPCBundle) {
  const cur = map.get(key);
  if (!cur || new Date(b.received_at).getTime() > new Date(cur.received_at).getTime()) map.set(key, b);
}

export function buildCtmIndexes(calls: CtmCallRow[]): CtmIndexes {
  const byPhone = new Map<string, PPCBundle>();
  const byEmail = new Map<string, PPCBundle>();
  for (const c of calls) {
    const ga = c.raw_payload?.ga ?? {};
    const paid = c.raw_payload?.paid ?? {};
    const gclid = emptyToNull(ga.gclid);
    if (!gclid) continue;
    const b: PPCBundle = {
      gclid,
      call_id: c.call_id,
      phone_e164: c.caller_number ?? "",
      received_at: c.received_at,
      keyword: emptyToNull(paid.keyword),
      campaign_id: emptyToNull(paid.campaign) ?? emptyToNull(paid.campaign_id),
      ad_group_id: emptyToNull(paid.ad_group_id),
    };
    const p10 = last10(c.caller_number);
    if (p10) upsertFreshest(byPhone, p10, b);
    const email = normEmail(c.raw_payload?.email);
    if (email) upsertFreshest(byEmail, email, b);
  }
  return { byPhone, byEmail };
}

export type RecordIdentifiers = { phones10: string[]; emails: string[] };

export function gatherDealIdentifiers(
  deal: {
    Phone?: string | null; Phone_2?: string | null; Phone_3?: string | null; Phone_4?: string | null;
    Emergency_Contact_Phone_Number?: string | null; Email?: string | null;
  },
  linkedContact?: {
    Phone?: string | null; Mobile?: string | null; Home_Phone?: string | null;
    Other_Phone?: string | null; Emergency_Contact_Phone_Number?: string | null; Email?: string | null;
  } | null,
): RecordIdentifiers {
  const phones = new Set<string>();
  const emails = new Set<string>();
  const addP = (p?: string | null) => { const x = last10(p ?? null); if (x) phones.add(x); };
  const addE = (e?: string | null) => { const x = normEmail(e); if (x) emails.add(x); };
  addP(deal.Phone); addP(deal.Phone_2); addP(deal.Phone_3); addP(deal.Phone_4);
  addP(deal.Emergency_Contact_Phone_Number); addE(deal.Email);
  if (linkedContact) {
    addP(linkedContact.Phone); addP(linkedContact.Mobile); addP(linkedContact.Home_Phone);
    addP(linkedContact.Other_Phone); addP(linkedContact.Emergency_Contact_Phone_Number);
    addE(linkedContact.Email);
  }
  return { phones10: [...phones], emails: [...emails] };
}

export function matchByIdentifiers(
  ids: RecordIdentifiers,
  idx: CtmIndexes,
): { bundle: PPCBundle; via: "phone" | "email" } | null {
  let best: { bundle: PPCBundle; via: "phone" | "email" } | null = null;
  const consider = (b: PPCBundle | undefined, via: "phone" | "email") => {
    if (!b) return;
    if (!best || new Date(b.received_at).getTime() > new Date(best.bundle.received_at).getTime()) best = { bundle: b, via };
  };
  for (const p of ids.phones10) consider(idx.byPhone.get(p), "phone");
  for (const e of ids.emails) consider(idx.byEmail.get(e), "email");
  return best;
}
