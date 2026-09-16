// Read-only Zoho access for the CRM Jail bot.
//
// This module never issues a write. The bot audits the CRM; it does not
// correct it.
//
// Field names in MODULE_SELECT are the verified ones from
// docs/CRM_JAIL_FIELD_MAP.md. A field missing from a select list arrives as
// null at scoring time and silently fails the rep on that line — so the
// select lists are pinned by tests.

// Env is read lazily, not at module load, so the pure query builders below
// stay importable and testable without granting env access.
const env = (k: string, fallback?: string): string | undefined =>
  Deno.env.get(k) ?? fallback;

const apiDomain = () => env("ZOHO_API_DOMAIN", "https://www.zohoapis.com")!;
const accountsDomain = () => env("ZOHO_ACCOUNTS_DOMAIN", "https://accounts.zoho.com")!;

const PAGE_SIZE = 200;

export type Team = "admissions" | "bd";

export function moduleForTeam(team: Team): string[] {
  return team === "admissions"
    ? ["Leads", "Contacts", "Deals"]
    : ["Contacts", "Calls", "Accounts", "Events"];
}

export const MODULE_SELECT: Record<string, string> = {
  Leads: [
    "id", "First_Name", "Last_Name", "Phone", "Email",
    "Emergency_Contact_Name", "Emergency_Contact_Phone_Number",
    "Contact_Type", "Lead_Status", "Owner", "How_Did_You_Hear_About_Us",
    "DUI_or_Treatment", "Level_of_Care_Requested", "Age_Group",
    "Lead_Score_Rating", "Generated_By", "Digital_Source", "Source_Category",
    "BD_Rep", "Business_Contact_Name", "Referring_Contact_Business_Contact",
    "Insurance_Type", "Private_Insurance_Company", "AHCCCS_Insurance_Provider",
    "DOB", "Member_ID", "Insurance_Policy_Type",
    "Created_Time", "Modified_Time",
  ].join(","),

  Contacts: [
    "id", "First_Name", "Last_Name", "Phone", "Email",
    "Emergency_Contact_Name", "Emergency_Contact_Phone_Number",
    "Contact_Type", "Owner", "Business_Contact_Role",
    "Account_Name", "Associated_Facility",
    "Created_Time", "Modified_Time",
  ].join(","),

  Deals: [
    "id", "Deal_Name", "Owner",
    "Emergency_Contact_Name", "Emergency_Contact_Phone_Number",
    "DUI_or_Treatment", "Level_of_Care_Requested", "Age_Group",
    "Source_Category", "BD_Rep", "Referring_Company", "Referring_Business_Contact",
    "Insurance_Type", "Insurance_Provider_New", "AHCCCS_Insurance_Provider",
    "DOB", "Member_ID", "Policy_Type", "VOB_Submitted_By",
    "Stage", "Admit_Date", "Closing_Date", "Admitted_Level_of_Care",
    "Referred_Out", "Outbound_Referral_BD_Rep", "Refer_Out_Type",
    "Admitted_at_Referred_Facility", "Refer_Out_Date",
    "Lost_Reasoning", "Close_Reasoning_DUI",
    "Created_Time", "Modified_Time",
  ].join(","),

  Accounts: [
    "id", "Account_Name", "Owner", "Website", "Main_Business_Phone", "Phone",
    "Address", "Billing_Street", "Billing_City", "Billing_State", "Billing_Code",
    "Business_Contact_Pipeline_Stage", "Niche", "Reciprocity",
    "Unattached_or_Attached", "Commerical_or_AHCCCS",
    "In_Network_Payers_Accepted", "OON_Preferred_Policies",
    "Level_of_Care", "States_Services_Are_Provided_In", "What_do_they_treat",
    "Date_of_Next_Scheduled_Contact",
    "Created_Time", "Modified_Time",
  ].join(","),

  // "'$se_module'" (single-quoted, verified against live COQL) returns the
  // module What_Id points at. CA6/M6 need it: "Associated Company" is only
  // satisfied when Related To resolves to Accounts, not to a Deal.
  Calls: [
    "id", "Subject", "Call_Start_Time", "Owner", "Who_Id", "What_Id", "'$se_module'",
    "Call_Purpose", "Call_Result", "Created_Time", "Modified_Time",
  ].join(","),

  Events: [
    "id", "Event_Title", "Start_DateTime", "End_DateTime", "Owner",
    "Who_Id", "What_Id", "'$se_module'", "Description", "Venue",
    "Created_Time", "Modified_Time",
  ].join(","),
};

export async function getZohoAccessToken(): Promise<string> {
  const clientId = env("ZOHO_CLIENT_ID");
  const clientSecret = env("ZOHO_CLIENT_SECRET");
  const refreshToken = env("ZOHO_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("ZOHO_AUTH_FAILED: secrets not set");
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${accountsDomain()}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`ZOHO_AUTH_FAILED: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

/**
 * Records the rep created OR touched inside the window. Both matter: the
 * template samples "everything the rep created or modified in the audit
 * window", which is why Kenny's sample included a company created in 2022.
 */
export function buildWindowQuery(
  module: string,
  selectFields: string,
  ownerId: string,
  bounds: { from: string; toExclusive: string },
  offset: number,
): string {
  return `select ${selectFields} from ${module} ` +
    `where Owner = '${ownerId}' ` +
    `and ((Created_Time >= '${bounds.from}' and Created_Time < '${bounds.toExclusive}') ` +
    `or (Modified_Time >= '${bounds.from}' and Modified_Time < '${bounds.toExclusive}')) ` +
    `limit ${PAGE_SIZE} offset ${offset}`;
}

export async function coql(token: string, query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${apiDomain()}/crm/v6/coql`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ select_query: query }),
  });
  if (res.status === 204) return [];
  // Surfaced so the orchestrator can abort the whole run rather than emit
  // scorecards that look complete but are empty.
  if (res.status === 401) throw new Error("ZOHO_AUTH_FAILED");
  if (!res.ok) throw new Error(`COQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.data ?? []) as Record<string, unknown>[];
}

/** Pages until a short page comes back. Errors are thrown, never swallowed. */
export async function fetchWindow(
  token: string,
  module: string,
  ownerId: string,
  bounds: { from: string; toExclusive: string },
): Promise<Record<string, unknown>[]> {
  const select = MODULE_SELECT[module];
  if (!select) throw new Error(`No select list defined for module ${module}`);
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await coql(token, buildWindowQuery(module, select, ownerId, bounds, offset));
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Fields to request per related list. The v6 related-records API REQUIRES a
 * `fields` parameter — without it the call 400s. Omitting it made every Notes
 * fetch fail silently, which read as "this record has no notes" and would have
 * failed every rep on every language item.
 */
const RELATED_FIELDS: Record<string, string> = {
  Notes: "id,Note_Title,Note_Content,Created_Time",
  Attachments: "id,File_Name,Created_Time",
  Events: "id,Event_Title,Start_DateTime,Created_Time",
  Calls: "id,Subject,Call_Start_Time,Created_Time",
  Tasks: "id,Subject,Due_Date,Status,Created_Time",
  Deals: "id,Deal_Name,Stage,Created_Time",
};

export async function fetchRelated(
  token: string,
  module: string,
  recordId: string,
  related: string,
): Promise<Record<string, unknown>[]> {
  const fields = RELATED_FIELDS[related];
  if (!fields) throw new Error(`No field list defined for related list ${related}`);
  const res = await fetch(
    `${apiDomain()}/crm/v6/${module}/${recordId}/${related}?per_page=100&fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
  );
  if (res.status === 204) return [];
  if (res.status === 401) throw new Error("ZOHO_AUTH_FAILED");
  if (!res.ok) throw new Error(`Related ${related} ${res.status}: ${await res.text()}`);
  return ((await res.json()).data ?? []) as Record<string, unknown>[];
}

/**
 * What_Id on Calls and Events is polymorphic. Zoho returns the target module
 * in the `$se_module` pseudo-field, which is how CA6 / M6 tell a Company link
 * from a Deal link.
 */
export function whatIdModuleOf(record: Record<string, unknown>): string | null {
  const m = record["$se_module"];
  return typeof m === "string" && m.length > 0 ? m : null;
}
