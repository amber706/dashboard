// zoho-grant-exchange — Phase 1B one-shot helper.
//
// Exchanges a Zoho OAuth grant code for a refresh token using the existing
// ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET env vars. Returns the refresh_token
// in the response body. After we capture the refresh token, this function
// can be deleted; it's not used by the daily sync pipeline.
//
// Usage:
//   POST { "code": "1000.xxxxxxxxxxxxx.xxxxxxxxxxxxx" }
//   (optional) { "code": "...", "redirect_uri": "https://..." }
//
// Defaults to the standard https://www.zoho.com redirect_uri when not
// specified; Zoho needs the same redirect_uri that was registered against
// the Self Client at grant-creation time.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405 });
  }

  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const accountsDomain = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ ok: false, error: "ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET not set" }), { status: 500 });
  }

  let body: { code?: string; redirect_uri?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "expected JSON body { code, redirect_uri? }" }), { status: 400 });
  }

  const code = body.code;
  const redirectUri = body.redirect_uri ?? "https://www.zoho.com";
  if (!code) {
    return new Response(JSON.stringify({ ok: false, error: "code is required" }), { status: 400 });
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text); } catch {}

  return new Response(JSON.stringify({
    ok: res.ok && typeof parsed.refresh_token === "string",
    http_status: res.status,
    response: parsed,
    note: typeof parsed.refresh_token === "string"
      ? "Copy the refresh_token value above and send it to your operator. The access_token will expire in ~1 hour; the refresh_token does not."
      : "Exchange failed. Common causes: grant code already used, grant code expired (>10 minutes), redirect_uri mismatch with what was registered on the Self Client.",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
