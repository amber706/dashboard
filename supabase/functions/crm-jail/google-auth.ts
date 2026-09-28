// Service-account auth for Drive + Sheets.
//
// Signs a JWT with the service account's private key and exchanges it for an
// access token. Drive and Sheets scopes only — no user impersonation, no
// domain-wide delegation. The bot can only touch what has been shared with
// crm-jail-bot@... explicitly.

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Mints an access token. Accepts the key explicitly so this is testable
 * against a local key file without reading env.
 */
export async function mintGoogleToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  // Google's JSON key escapes newlines; a shell-set secret may carry real ones.
  const key = await importKey(privateKeyPem.replace(/\\n/g, "\n"));
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`GOOGLE_AUTH_FAILED: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

export async function getGoogleAccessToken(): Promise<string> {
  const email = Deno.env.get("GOOGLE_SA_EMAIL");
  const key = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
  if (!email || !key) throw new Error("GOOGLE_AUTH_FAILED: GOOGLE_SA_* secrets not set");
  return await mintGoogleToken(email, key);
}
