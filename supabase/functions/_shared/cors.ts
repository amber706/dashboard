// Shared CORS helpers. Without these, browser fetches from the
// Vercel-hosted dashboard are blocked by the preflight OPTIONS check
// (the user sees "Failed to fetch" and the function never runs).
//
// Usage:
//   import { corsHeaders, handleCorsPreflight, withCors } from "../_shared/cors.ts";
//   Deno.serve((req) => {
//     const pre = handleCorsPreflight(req);
//     if (pre) return pre;
//     ...
//     return withCors(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
//   });

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-max-age": "86400",
};

/** Returns a 204 preflight response when the request is OPTIONS, else null. */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

/** Add CORS headers to an existing Response without copying its body. */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
