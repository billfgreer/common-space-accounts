// Registration Edge Function.
//
// Runs entirely server-side (service role key) so the Trade.gov API key and
// IP-geolocation lookups are never exposed to the browser. This is the ONLY
// way users are created in this app — there is no client-side supabase.auth.signUp().
//
// Flow:
//   1. Screen full name against the Trade.gov Consolidated Screening List (CSL).
//   2. Screen organization name against the CSL (skipped if blank).
//   3. Geolocate the caller's IP and check it against the OFAC comprehensive
//      embargo country list.
//   4. If ANY check hits, create the auth user but mark profile status =
//      'rejected' (permanent, non-overridable, no admin clear path).
//   5. Otherwise create the auth user with profile status = 'active'.
//
// Rejected/error responses are intentionally generic — we don't tell the
// caller *why* they were rejected, to avoid giving sanctioned actors
// feedback on how to evade screening.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CSL_API_KEY = Deno.env.get("TRADE_GOV_API_KEY") ?? "";
const CSL_ENDPOINT = "https://data.trade.gov/consolidated_screening_list/v1/search";

// OFAC comprehensive (full-embargo) sanctions countries only — not the
// broader sectoral-sanctions list. See project memory for the policy
// rationale (avoids blocking legitimate humanitarian/journalist users from
// countries under partial/sectoral sanctions, e.g. Russia, Belarus).
const SANCTIONED_COUNTRY_CODES = new Set(["CU", "IR", "KP", "SY"]);

interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  organization?: string;
  country: string;
}

interface CslResult {
  checked: boolean;
  query: string;
  hit: boolean;
  raw?: unknown;
  error?: string;
}

interface IpCheckResult {
  ip: string | null;
  country_code: string | null;
  hit: boolean;
  error?: string;
}

async function screenCsl(name: string): Promise<CslResult> {
  if (!name) return { checked: false, query: name, hit: false };
  try {
    const url = `${CSL_ENDPOINT}?api_key=${encodeURIComponent(CSL_API_KEY)}&q=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { checked: true, query: name, hit: false, error: `CSL HTTP ${res.status}` };
    }
    const data = await res.json();
    const total = data?.total ?? (Array.isArray(data?.results) ? data.results.length : 0);
    return { checked: true, query: name, hit: total > 0, raw: data };
  } catch (err) {
    return { checked: true, query: name, hit: false, error: String(err) };
  }
}

async function checkIpCountry(ip: string | null): Promise<IpCheckResult> {
  if (!ip) return { ip: null, country_code: null, hit: false, error: "no client ip" };
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (!res.ok) {
      return { ip, country_code: null, hit: false, error: `geo HTTP ${res.status}` };
    }
    const data = await res.json();
    const countryCode = (data?.country_code as string | undefined)?.toUpperCase() ?? null;
    return {
      ip,
      country_code: countryCode,
      hit: countryCode ? SANCTIONED_COUNTRY_CODES.has(countryCode) : false,
    };
  } catch (err) {
    return { ip, country_code: null, hit: false, error: String(err) };
  }
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  let payload: RegisterPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid request body" }), { status: 400 });
  }

  const { email, password, full_name, organization, country } = payload;
  if (!email || !password || !full_name || !country) {
    return new Response(JSON.stringify({ error: "missing required fields" }), { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const clientIp = getClientIp(req);

  const [nameResult, orgResult, ipResult] = await Promise.all([
    screenCsl(full_name),
    organization ? screenCsl(organization) : Promise.resolve({ checked: false, query: "", hit: false }),
    checkIpCountry(clientIp),
  ]);

  // Infra failure in a screening check (not a match) — fail closed, create nothing.
  if (nameResult.error || orgResult.error || ipResult.error) {
    return new Response(
      JSON.stringify({ error: "screening_unavailable" }),
      { status: 503 },
    );
  }

  const isRejected = nameResult.hit || orgResult.hit || ipResult.hit;

  const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // v1 defers email verification (see workflow doc)
  });

  if (createError || !userData?.user) {
    return new Response(
      JSON.stringify({ error: "registration_failed" }),
      { status: 400 },
    );
  }

  const { error: profileError } = await supabaseAdmin.from("profiles").insert({
    id: userData.user.id,
    email,
    full_name,
    organization: organization || null,
    country,
    role: "requester",
    status: isRejected ? "rejected" : "active",
    screening_log: {
      name_check: nameResult,
      org_check: orgResult,
      ip_check: ipResult,
      checked_at: new Date().toISOString(),
    },
  });

  if (profileError) {
    return new Response(JSON.stringify({ error: "registration_failed" }), { status: 500 });
  }

  if (isRejected) {
    // Generic response — no detail on which check hit.
    return new Response(JSON.stringify({ status: "rejected" }), { status: 200 });
  }

  return new Response(JSON.stringify({ status: "active" }), { status: 200 });
});
