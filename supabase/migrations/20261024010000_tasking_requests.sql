-- Tasking request workflow (v1, governance-native).
-- See README / project memory for the mapping from governance concepts to
-- these fields. Rows are written exclusively by the submit/review Edge
-- Functions (service role) — never directly by clients — so the governance
-- gate logic can't be bypassed by a crafted insert/update.

-- Participation ladder, rung 1: a binary trust flag. DB-set only in v1
-- (no admin UI for this yet) — a trusted requester's routine, non-objected
-- requests can auto-approve; everyone else always goes to review.
alter table public.profiles
  add column if not exists trusted boolean not null default false;

-- Community-objection source for v1: an admin-curated list of flagged
-- locations (not yet real community input — that's a later iteration).
-- Any tasking request whose AOI falls within radius_km of a flagged point
-- is forced to pending_review regardless of sensitivity/trust.
create table if not exists public.flagged_locations (
  id uuid primary key default gen_random_uuid(),
  center_lat double precision not null,
  center_lng double precision not null,
  radius_km double precision not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.flagged_locations enable row level security;

-- Any authenticated user may read the flagged list (needed so the client
-- can't be the only thing enforcing it — Edge Function also checks server
-- side). No insert/update/delete policy: admins edit this table directly.
create policy "flagged_locations_select_all"
  on public.flagged_locations
  for select
  to authenticated
  using (true);

create table if not exists public.tasking_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,

  -- Simple point + radius AOI for v1 — no map-draw tool yet.
  center_lat double precision not null,
  center_lng double precision not null,
  radius_km double precision not null,

  rationale text not null,
  sensitivity text not null check (sensitivity in ('routine', 'moderate', 'sensitive')),
  data_lifecycle text not null check (data_lifecycle in ('standard_1yr', 'extended', 'delete_after_use')),

  review_status text not null check (review_status in ('auto_approved', 'pending_review', 'approved', 'objected', 'denied')),
  objection_flag boolean not null default false,
  objection_reason text,

  decision_reason text,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),

  created_at timestamptz not null default now()
);

alter table public.tasking_requests enable row level security;

-- Requesters see only their own requests.
create policy "tasking_requests_select_own"
  on public.tasking_requests
  for select
  using (auth.uid() = requester_id);

-- Admins see all requests (subquery hits the caller's own profiles row,
-- which the profiles_select_own policy already permits).
create policy "tasking_requests_select_admin"
  on public.tasking_requests
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- No insert/update/delete policies for regular users: all writes go through
-- the submit-tasking-request and review-tasking-request Edge Functions
-- (service role), which compute/verify the governance gate server-side.
