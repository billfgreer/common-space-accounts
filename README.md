# common-space-accounts

Registration + authentication + authorization service for the Common Space tasking system (v1). Standalone Vite+React+TS frontend backed by Supabase (Auth + Postgres + Edge Functions). Will eventually feed verified accounts into Satellite Foresight.

## What this is (v1 scope)

- Email/password registration collecting full name, organization (optional), country.
- Server-side screening on every registration, run entirely inside a Supabase Edge Function:
  - Full name checked against the [Trade.gov Consolidated Screening List](https://www.trade.gov/consolidated-screening-list) (OFAC SDN + BIS Entity List, etc).
  - Organization name checked the same way (skipped if blank).
  - Caller's IP geolocated and checked against the OFAC comprehensive-embargo country list (Cuba, Iran, North Korea, Syria).
- Any hit → account is created but permanently `rejected`. This is **not** reviewable or overridable by an admin in v1 — it's a hard stop.
- No hit → account is `active` immediately, default role `requester`.
- Two roles: `admin`, `requester`. There is no admin UI yet — promoting a user to `admin` is a direct database edit.

Deferred to later iterations (see project memory / workflow doc): email verification, EU/UN sanctions coverage, periodic re-screening, password reset/MFA, sub-national region blocking, Satellite Foresight handoff.

### Post-login: tasking requests (governance-native v1)

Once logged in, an active user lands on a dashboard with a tasking-request form and their own request history. Every submission runs through a server-side governance gate (in the `submit-tasking-request` Edge Function) before being stored — this is the v1 translation of the governance framework into concrete mechanics:

| Governance concept | v1 mechanic |
|---|---|
| Membership-gated access | Only `profiles.status = active` can reach the screen |
| Participation ladder | Binary `profiles.trusted` flag (DB-set only, no UI yet) |
| Sensitivity classification | Requester self-classifies against an inline rubric: `routine` / `moderate` / `sensitive` |
| Community objections | AOI checked against an admin-curated `flagged_locations` table; any overlap forces review |
| Proportionate review triggers | `routine` + `trusted` + no objection → auto-approved; everything else → pending review |
| Decision-rights workflow | Only `role = admin` can approve/deny a pending request (`review-tasking-request` function) |
| Rationale logging | Required free-text rationale on submission, and a required reason on every admin decision |
| Data-lifecycle tracking | Retention choice (`standard_1yr` / `extended` / `delete_after_use`) recorded per request — not yet enforced by any automated job |

Deferred to later iterations: interactive map-based AOI drawing (v1 uses plain lat/lng/radius inputs), a dedicated reviewer role distinct from admin, a real community-objection submission channel (v1's flagged list is admin-curated, not actual community input), multi-tier participation ladder, automated data-lifecycle enforcement, and any Satellite Foresight data handoff.

## Setup

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com) (or run one locally with `npx supabase start`, requires Docker). You'll need:

- Project URL and anon key → frontend `.env`
- Project URL and **service role key** → Edge Function secret (never exposed to the browser)

### 2. Get a Trade.gov API key

Sign up for a free key at [data.trade.gov](https://data.trade.gov) for the Consolidated Screening List API.

### 3. Configure the frontend

```bash
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 4. Apply the database migration

```bash
npx supabase link --project-ref your-project-ref
npx supabase db push
```

This creates the `profiles` table with RLS enabled (users can only read their own row; all writes happen via the Edge Function's service role key).

### 5. Deploy the Edge Functions and set secrets

```bash
npx supabase secrets set TRADE_GOV_API_KEY=your-trade-gov-key
npx supabase functions deploy register
npx supabase functions deploy submit-tasking-request
npx supabase functions deploy review-tasking-request
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into Edge Functions by Supabase — no need to set them manually.

### 6. Promote an admin / trusted requester (manual, v1 only)

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
update public.profiles set trusted = true where email = 'someone@example.com';
```

### 7. Flag a location for the community-objection check (manual, v1 only)

```sql
insert into public.flagged_locations (center_lat, center_lng, radius_km, reason)
values (0, 0, 10, 'Example: active displacement camp, requires review');
```

## Notes

- IP geolocation uses [ipapi.co](https://ipapi.co) (no API key needed at low volume).
- Rejection responses are intentionally generic — the app never tells a caller *why* they were rejected, to avoid giving sanctioned actors feedback on how to evade screening.
