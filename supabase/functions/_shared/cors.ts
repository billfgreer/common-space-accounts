// Shared CORS handling for all edge functions. The client (a browser app on
// a different origin than *.supabase.co) sends a preflight OPTIONS request
// before any POST that carries custom headers (Authorization, apikey,
// Content-Type). Without these headers every browser-originated call fails
// at the preflight stage, even though curl/server-to-server calls (which
// skip CORS entirely) appear to work fine.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Returns a 204 preflight response if this request is an OPTIONS request, else null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

/** Wraps Response.json-style construction with CORS headers merged in. */
export function corsJson(body: unknown, init?: ResponseInit): Response {
  const headers = { ...corsHeaders, "Content-Type": "application/json", ...(init?.headers ?? {}) };
  return new Response(JSON.stringify(body), { ...init, headers });
}
